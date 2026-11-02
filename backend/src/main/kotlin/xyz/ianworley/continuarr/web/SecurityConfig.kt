package xyz.ianworley.continuarr.web

import jakarta.servlet.DispatcherType
import jakarta.servlet.http.HttpServletResponse
import org.springframework.boot.health.actuate.endpoint.HealthEndpoint
import org.springframework.boot.security.autoconfigure.actuate.web.servlet.EndpointRequest
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.HttpMethod
import org.springframework.http.HttpStatus
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.annotation.web.invoke
import org.springframework.security.core.userdetails.User as SecurityUser
import org.springframework.security.core.userdetails.UserDetailsService
import org.springframework.security.core.userdetails.UsernameNotFoundException
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.authentication.AuthenticationEntryPointFailureHandler
import org.springframework.security.web.authentication.AuthenticationSuccessHandler
import org.springframework.security.web.authentication.HttpStatusEntryPoint
import org.springframework.security.web.authentication.logout.HttpStatusReturningLogoutSuccessHandler
import org.springframework.security.web.util.matcher.DispatcherTypeRequestMatcher

const val LOGIN_PATH = "/api/login"
const val LOGOUT_PATH = "/api/logout"

// Form login with a session cookie, answered with status codes instead of redirects so the SPA
// can drive it with fetch.
@Configuration
class SecurityConfig {

	@Bean
	fun passwordEncoder(): PasswordEncoder = BCryptPasswordEncoder()

	@Bean
	fun userDetailsService(users: UserRepository) = UserDetailsService { username ->
		val user = users.findByUsername(username) ?: throw UsernameNotFoundException("Unknown user")
		SecurityUser.withUsername(user.username).password(user.passwordHash).build()
	}

	@Bean
	fun securityFilterChain(http: HttpSecurity): SecurityFilterChain {
		// The Kotlin DSL has no spa() as of Spring Security 7.1, and configuring csrf inside
		// http { } would replace it; see docs/plan.md#security.
		http.csrf { it.spa() }
		http {
			authorizeHttpRequests {
				authorize(EndpointRequest.to(HealthEndpoint::class.java), permitAll)
				authorize(CSRF_PATH, permitAll)
				authorize(SETUP_PATH, permitAll)
				// The frontend must load before login so it can show the login and setup pages.
				authorize(SpaRouteMatcher, permitAll)
				authorize(HttpMethod.GET, SPA_INDEX_PATH, permitAll)
				authorize(HttpMethod.GET, SPA_ASSETS_PATH, permitAll)
				// Lets Boot's error page send statuses like 400 as-is instead of turning them into 401s.
				authorize(DispatcherTypeRequestMatcher(DispatcherType.ERROR), permitAll)
				authorize(anyRequest, authenticated)
			}
			formLogin {
				loginProcessingUrl = LOGIN_PATH
				authenticationSuccessHandler = AuthenticationSuccessHandler { _, response, _ ->
					response.status = HttpServletResponse.SC_NO_CONTENT
				}
				authenticationFailureHandler = AuthenticationEntryPointFailureHandler(HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED))
			}
			logout {
				logoutUrl = LOGOUT_PATH
				logoutSuccessHandler = HttpStatusReturningLogoutSuccessHandler(HttpStatus.NO_CONTENT)
			}
			exceptionHandling {
				authenticationEntryPoint = HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED)
			}
		}
		return http.build()
	}
}
