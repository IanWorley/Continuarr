package xyz.ianworley.continuarr.jellyfin.internal

import com.fasterxml.jackson.annotation.Nulls
import org.slf4j.LoggerFactory
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.context.event.EventListener
import org.springframework.core.ParameterizedTypeReference
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.HttpStatusCode
import org.springframework.http.InvalidMediaTypeException
import org.springframework.http.client.JdkClientHttpRequestFactory
import org.springframework.http.converter.json.JacksonJsonHttpMessageConverter
import org.springframework.web.client.ResourceAccessException
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestClientException
import tools.jackson.databind.json.JsonMapper
import xyz.ianworley.continuarr.server.ActiveSession
import xyz.ianworley.continuarr.server.MediaServer
import xyz.ianworley.continuarr.server.MediaServerException
import xyz.ianworley.continuarr.server.ServerAccount
import xyz.ianworley.continuarr.server.ServerAccountId
import xyz.ianworley.continuarr.server.ServerItem
import xyz.ianworley.continuarr.server.ServerKind
import xyz.ianworley.continuarr.server.ServerLibrary
import xyz.ianworley.continuarr.server.ServerLibraryId
import xyz.ianworley.continuarr.server.UserItemState
import java.io.CharConversionException
import java.io.IOException
import java.net.http.HttpClient
import java.nio.charset.CharacterCodingException
import java.time.Duration

private const val CONNECT_TIMEOUT_SECONDS = 5L
private const val READ_TIMEOUT_SECONDS = 30L
private val JELLYFIN_CONNECT_TIMEOUT: Duration = Duration.ofSeconds(CONNECT_TIMEOUT_SECONDS)

// JdkClientHttpRequestFactory applies it to the whole response, body included, not to each read.
private val JELLYFIN_READ_TIMEOUT: Duration = Duration.ofSeconds(READ_TIMEOUT_SECONDS)

private const val USERS_PATH = "/Users"
private const val VIRTUAL_FOLDERS_PATH = "/Library/VirtualFolders"
private const val SYSTEM_INFO_PATH = "/System/Info"

private val AUTH_FAILURE_STATUSES = setOf<HttpStatusCode>(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)

// Jackson leaves a null element in a Kotlin List<UserDto>, where it would surface later as a NullPointerException.
private val JSON_REJECTING_NULL_ELEMENTS =
	JacksonJsonHttpMessageConverter(JsonMapper.builder().changeDefaultNullHandling { it.withContentNulls(Nulls.FAIL) })

private const val JDK_HTTP_LOG_PROPERTY = "jdk.httpclient.HttpClient.log"
private val JDK_HTTP_LOG_HEADER_LEVELS = setOf("headers", "all")
private const val JDK_HTTP_LOG_SEPARATOR = ','

private val log = LoggerFactory.getLogger(JellyfinMediaServer::class.java)

// Decoding errors are IOExceptions too, but they mean the whole body arrived and can't be read as text.
private fun Throwable.isLostConnection(): Boolean =
	this is IOException && this !is CharConversionException && this !is CharacterCodingException

/**
 * Every request goes through [get], so each method throws only [MediaServerException]. The adapter adds no
 * retries of its own, so the pollers decide when to try again. The JDK client may still replay an idempotent
 * GET once when a connection drops.
 */
class JellyfinMediaServer(
	properties: JellyfinProperties,
	readTimeout: Duration = JELLYFIN_READ_TIMEOUT,
) : MediaServer {

	// The JDK client never follows redirects, so the Authorization header can't reach another host.
	private val restClient: RestClient = RestClient.builder()
		.baseUrl(properties.baseUrl)
		.defaultHeader(HttpHeaders.AUTHORIZATION, properties.apiKey.authorizationHeader())
		.requestFactory(
			JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(JELLYFIN_CONNECT_TIMEOUT).build())
				.apply { setReadTimeout(readTimeout) },
		)
		.configureMessageConverters { it.withJsonConverter(JSON_REJECTING_NULL_ELEMENTS) }
		.build()

	override val kind: ServerKind = ServerKind.JELLYFIN

	/** Disabled users are included and flagged; Phase 3 decides what to do with them. */
	override fun accounts(): List<ServerAccount> = get<List<UserDto>>(USERS_PATH).map { it.toServerAccount() }

	override fun libraries(): List<ServerLibrary> = get<List<VirtualFolderDto>>(VIRTUAL_FOLDERS_PATH).mapNotNull { folder ->
		folder.toServerLibraryOrNull().also {
			if (it == null) log.info("Skipping Jellyfin library {} with collection type {}", folder.name, folder.collectionType)
		}
	}

	override fun items(library: ServerLibraryId): Sequence<ServerItem> = TODO("#17")

	override fun userStates(account: ServerAccountId, library: ServerLibraryId): Sequence<UserItemState> = TODO("#18")

	override fun activeSessions(): List<ActiveSession> = TODO("#19")

	/** A failure is logged, not thrown, so Continuarr starts while Jellyfin is down. */
	@EventListener(ApplicationReadyEvent::class)
	fun logServerInfo() {
		try {
			val info = get<SystemInfoDto>(SYSTEM_INFO_PATH)
			log.info("Connected to Jellyfin server {}, version {}", info.serverName, info.version)
		} catch (e: MediaServerException) {
			log.warn("Jellyfin connection check failed: {}", e.message)
		}
	}

	/** No client can hide headers from the JDK's own wire log, so this warns instead. */
	@EventListener(ApplicationReadyEvent::class)
	fun warnIfJdkLogsHeaders() {
		val levels = System.getProperty(JDK_HTTP_LOG_PROPERTY).orEmpty().split(JDK_HTTP_LOG_SEPARATOR).map { it.trim().lowercase() }
		if (levels.any { it in JDK_HTTP_LOG_HEADER_LEVELS }) {
			log.warn("-D{} logs request headers, so the JDK will log the Jellyfin API key", JDK_HTTP_LOG_PROPERTY)
		}
	}

	// exchange() hands over the status before any decoding, and never builds a RestClientResponseException,
	// whose message would carry the response body.
	private inline fun <reified T : Any> get(path: String): T {
		val bodyType = object : ParameterizedTypeReference<T>() {}
		return try {
			restClient.get().uri(path).exchange { _, response ->
				val status = response.statusCode
				if (status in AUTH_FAILURE_STATUSES) {
					throw MediaServerException.Unauthorized("Jellyfin rejected the API key with ${status.value()} for GET $path")
				}
				if (!status.is2xxSuccessful) {
					throw MediaServerException.UnexpectedResponse("Jellyfin answered GET $path with ${status.value()}")
				}
				val body = try {
					response.bodyTo(bodyType)
				} catch (e: RestClientException) {
					// A body stream that fails mid-read arrives wrapped like a body that doesn't parse, with the
					// IOException under Spring's and Jackson's exceptions.
					if (generateSequence<Throwable>(e) { it.cause }.any { it.isLostConnection() }) {
						throw MediaServerException.Unreachable("Lost Jellyfin while reading GET $path", e)
					}
					throw MediaServerException.UnexpectedResponse("Jellyfin answered GET $path with ${status.value()} and a body that doesn't parse", e)
				} catch (e: InvalidMediaTypeException) {
					throw MediaServerException.UnexpectedResponse("Jellyfin answered GET $path with ${status.value()} and a Content-Type that doesn't parse", e)
				}
				body ?: throw MediaServerException.UnexpectedResponse("Jellyfin answered GET $path with ${status.value()} and an empty body")
			}
		} catch (e: ResourceAccessException) {
			throw MediaServerException.Unreachable("Can't reach Jellyfin for GET $path", e)
		}
	}
}
