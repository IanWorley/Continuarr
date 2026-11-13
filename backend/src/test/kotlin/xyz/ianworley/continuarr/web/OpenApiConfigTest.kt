package xyz.ianworley.continuarr.web

import io.swagger.v3.oas.models.Components
import io.swagger.v3.oas.models.OpenAPI
import io.swagger.v3.oas.models.media.ObjectSchema
import io.swagger.v3.oas.models.media.Schema
import io.swagger.v3.oas.models.media.StringSchema
import kotlin.test.Test
import kotlin.test.assertEquals

private const val SCHEMA_NAME = "Response"
private const val NULLABLE_FIELD = "source"
private const val REQUIRED_FIELD = "state"
private val VALUES = listOf("A", "B")

private fun enumProperty(vararg types: String): Schema<*> = StringSchema().apply {
	this.types = types.toSet()
	VALUES.forEach(::addEnumItem)
}

class OpenApiConfigTest {

	@Test
	fun `a nullable enum allows null, and a required enum doesn't`() {
		val response = ObjectSchema()
			.addProperty(NULLABLE_FIELD, enumProperty("string", "null"))
			.addProperty(REQUIRED_FIELD, enumProperty("string"))
		val openApi = OpenAPI().components(Components().addSchemas(SCHEMA_NAME, response))

		OpenApiConfig().nullableEnumsAllowNull().customise(openApi)

		assertEquals(VALUES + null, response.properties.getValue(NULLABLE_FIELD).enum)
		assertEquals(VALUES, response.properties.getValue(REQUIRED_FIELD).enum)
	}
}
