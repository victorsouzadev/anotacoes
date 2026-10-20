package com.organizador.dieta.data

import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

class ApiException(val status: Int, message: String) : IOException(message)

/**
 * Cliente HTTP das rotas /api/auth e /api/dieta do hub, no mesmo estilo do app de Tarefas (HttpURLConnection +
 * org.json, sem dependências). Renova o access token sozinho num 401 e repete a chamada uma vez.
 */
class Api(private val prefs: Prefs) {

    val logado: Boolean get() = prefs.refreshToken != null

    suspend fun entrar(email: String, senha: String, criarConta: Boolean) {
        val r = enviar("POST", if (criarConta) "/api/auth/register" else "/api/auth/login",
            JSONObject().put("email", email.trim()).put("password", senha), null) as JSONObject
        guardarSessao(r)
    }

    suspend fun sair() {
        prefs.refreshToken?.let { rt -> runCatching { enviar("POST", "/api/auth/logout", JSONObject().put("refreshToken", rt), null) } }
        prefs.limparSessao()
    }

    /** GET/PUT/POST/DELETE autenticado. Devolve JSONObject, JSONArray ou null (204). */
    suspend fun chamar(metodo: String, caminho: String, corpo: Any? = null): Any? = autenticado { token -> enviar(metodo, caminho, corpo, token) }

    suspend fun enviarFoto(foto: Foto): JSONObject = autenticado { token ->
        withContext(Dispatchers.IO) {
            val limite = "----dieta" + UUID.randomUUID()
            val c = abrir("POST", "/api/dieta/fotos", token)
            c.setRequestProperty("content-type", "multipart/form-data; boundary=$limite")
            c.outputStream.buffered().use { out ->
                fun campo(nome: String, valor: String) =
                    out.write("--$limite\r\nContent-Disposition: form-data; name=\"$nome\"\r\n\r\n$valor\r\n".toByteArray())
                campo("id", foto.id)
                campo("data", foto.data)
                campo("tipo", foto.tipo)
                foto.rotulo?.let { campo("rotulo", it) }
                out.write("--$limite\r\nContent-Disposition: form-data; name=\"arquivo\"; filename=\"${foto.id}.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n".toByteArray())
                File(foto.caminho).inputStream().use { it.copyTo(out) }
                out.write("\r\n--$limite--\r\n".toByteArray())
            }
            ler(c) as JSONObject
        }
    }

    suspend fun baixar(caminho: String, destino: File) = autenticado { token ->
        withContext(Dispatchers.IO) {
            val c = abrir("GET", caminho, token)
            try {
                if (c.responseCode !in 200..299) throw ApiException(c.responseCode, "Falha ao baixar ($caminho).")
                destino.parentFile?.mkdirs()
                c.inputStream.use { i -> destino.outputStream().use { i.copyTo(it) } }
            } finally {
                c.disconnect()
            }
        }
    }

    private suspend fun <T> autenticado(bloco: suspend (String) -> T): T {
        val token = prefs.accessToken ?: throw ApiException(401, "Entre com a conta do hub para sincronizar.")
        return try {
            bloco(token)
        } catch (e: ApiException) {
            if (e.status != 401) throw e
            bloco(renovar() ?: throw ApiException(401, "Sessão expirada. Entre de novo."))
        }
    }

    private suspend fun renovar(): String? {
        val rt = prefs.refreshToken ?: return null
        return try {
            guardarSessao(enviar("POST", "/api/auth/refresh", JSONObject().put("refreshToken", rt), null) as JSONObject)
            prefs.accessToken
        } catch (e: ApiException) {
            if (e.status in 400..499) prefs.limparSessao()
            null
        }
    }

    private fun guardarSessao(r: JSONObject) =
        prefs.salvarSessao(r.getString("accessToken"), r.getString("refreshToken"), r.getJSONObject("user").getString("email"))

    private suspend fun enviar(metodo: String, caminho: String, corpo: Any?, token: String?): Any? = withContext(Dispatchers.IO) {
        val c = abrir(metodo, caminho, token)
        if (corpo != null) {
            c.doOutput = true
            c.setRequestProperty("content-type", "application/json")
            c.outputStream.use { it.write(corpo.toString().toByteArray(Charsets.UTF_8)) }
        }
        ler(c)
    }

    private fun abrir(metodo: String, caminho: String, token: String?): HttpURLConnection =
        (URL(prefs.servidor + caminho).openConnection() as HttpURLConnection).apply {
            requestMethod = metodo
            connectTimeout = 15_000
            readTimeout = 30_000
            if (metodo == "POST" && caminho == "/api/dieta/fotos") doOutput = true
            token?.let { setRequestProperty("authorization", "Bearer $it") }
        }

    private fun ler(c: HttpURLConnection): Any? {
        try {
            val status = c.responseCode
            val texto = (if (status in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (status !in 200..299) {
                val msg = runCatching { JSONObject(texto).optString("error") }.getOrNull()?.takeIf { it.isNotBlank() }
                throw ApiException(status, msg ?: "Erro do servidor ($status).")
            }
            return if (texto.isBlank()) null else JSONTokener(texto).nextValue()
        } finally {
            c.disconnect()
        }
    }
}

fun JSONArray.objetos(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }
