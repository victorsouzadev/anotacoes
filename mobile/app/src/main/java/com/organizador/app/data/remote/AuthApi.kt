package com.organizador.app.data.remote

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

data class AuthSession(val accessToken: String, val refreshToken: String, val email: String)

class AuthApiException(message: String) : IOException(message)

/**
 * Cliente HTTP simples para as rotas /api/auth/... do backend do hub — mesmo contrato usado pelo login do
 * frontend web (e-mail/senha, JWT de acesso de curta duração + refresh token rotativo).
 */
class AuthApi(private val baseUrlProvider: () -> String) {

    suspend fun register(email: String, password: String): AuthSession =
        post("/api/auth/register", JSONObject().put("email", email).put("password", password))

    suspend fun login(email: String, password: String): AuthSession =
        post("/api/auth/login", JSONObject().put("email", email).put("password", password))

    suspend fun refresh(refreshToken: String): AuthSession =
        post("/api/auth/refresh", JSONObject().put("refreshToken", refreshToken))

    suspend fun logout(refreshToken: String) {
        runCatching { post("/api/auth/logout", JSONObject().put("refreshToken", refreshToken)) }
    }

    private suspend fun post(path: String, body: JSONObject): AuthSession = withContext(Dispatchers.IO) {
        val connection = URL(baseUrlProvider() + path).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.connectTimeout = 15_000
            connection.readTimeout = 20_000
            connection.setRequestProperty("content-type", "application/json")
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }

            val responseCode = connection.responseCode
            val stream = if (responseCode in 200..299) connection.inputStream else connection.errorStream
            val responseBody = stream?.bufferedReader()?.use { it.readText() }.orEmpty()

            if (responseCode !in 200..299) {
                val message = runCatching { JSONObject(responseBody).optString("error") }.getOrNull()
                throw AuthApiException(message?.takeIf { it.isNotBlank() } ?: "Falha de autenticação ($responseCode).")
            }

            val json = JSONObject(responseBody)
            val user = json.getJSONObject("user")
            AuthSession(
                accessToken = json.getString("accessToken"),
                refreshToken = json.getString("refreshToken"),
                email = user.getString("email"),
            )
        } finally {
            connection.disconnect()
        }
    }
}
