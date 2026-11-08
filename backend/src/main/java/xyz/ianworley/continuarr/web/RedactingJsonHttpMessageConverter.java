package xyz.ianworley.continuarr.web;

import java.io.IOException;
import java.util.Map;

import org.jspecify.annotations.Nullable;
import org.springframework.core.ResolvableType;
import org.springframework.http.HttpInputMessage;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.http.converter.json.JacksonJsonHttpMessageConverter;
import tools.jackson.databind.json.JsonMapper;

/**
 * Jackson's parse errors quote the input they reject, such as an unquoted password, and Spring logs
 * that message at WARN and DEBUG. So a parse error leaves here with a fixed message and without
 * Jackson's exception.
 *
 * <p>Written in Java because {@code read} is declared non-null but returns null for a JSON
 * {@code null} body, which Spring answers with 400. A Kotlin override adds a null check that turns
 * that into a 500.
 */
final class RedactingJsonHttpMessageConverter extends JacksonJsonHttpMessageConverter {

	private static final String UNREADABLE_JSON_MESSAGE = "JSON parse error";

	RedactingJsonHttpMessageConverter(JsonMapper jsonMapper) {
		super(jsonMapper);
	}

	@Override
	public Object read(ResolvableType type, HttpInputMessage inputMessage, @Nullable Map<String, Object> hints)
			throws IOException {
		try {
			return super.read(type, inputMessage, hints);
		}
		catch (HttpMessageNotReadableException _) {
			throw new HttpMessageNotReadableException(UNREADABLE_JSON_MESSAGE, inputMessage);
		}
	}
}
