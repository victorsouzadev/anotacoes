package com.casa.app

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class ApiErro(msg: String, val status: Int) : Exception(msg)

/** Cliente mínimo da API do servidor (casa/server). */
class Api(var servidor: String, var token: String?) {
    suspend fun chamar(metodo: String, caminho: String, corpo: JSONObject? = null): JSONObject = withContext(Dispatchers.IO) {
        val c = URL(servidor.trimEnd('/') + caminho).openConnection() as HttpURLConnection
        try {
            c.requestMethod = metodo
            c.connectTimeout = 10_000; c.readTimeout = 15_000
            c.setRequestProperty("Content-Type", "application/json")
            token?.let { c.setRequestProperty("Authorization", "Bearer $it") }
            if (corpo != null) { c.doOutput = true; c.outputStream.use { it.write(corpo.toString().toByteArray()) } }
            val s = c.responseCode
            val txt = (if (s < 400) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: "{}"
            val j = JSONObject(txt)
            if (s >= 400) throw ApiErro(j.optString("erro", "Erro $s"), s)
            j
        } finally { c.disconnect() }
    }
}

data class Membro(val id: Int, val nome: String, val peso: Double, val ausenteAte: String?, val admin: Boolean)
data class Tarefa(val id: Int, val nome: String, val pontos: Int, val vezes: Int, val fixoId: Int?)
data class Atribuicao(val id: Int, val tarefaId: Int, val tarefa: String, val membroId: Int?, val dia: String, val pontos: Int, val feito: Boolean)
data class Placar(val membroId: Int, val nome: String, val feitos: Int, val previstos: Int, val saldo: Double)
data class Estado(
    val euId: Int, val euAdmin: Boolean, val casaNome: String, val codigo: String, val modo: String,
    val semana: String, val hoje: String, val membros: List<Membro>, val tarefas: List<Tarefa>,
    val atribuicoes: List<Atribuicao>, val placar: List<Placar>, val preferencias: Map<Int, Int>,
)

private inline fun <T> JSONArray.mapa(f: (JSONObject) -> T) = (0 until length()).map { f(getJSONObject(it)) }
private fun JSONObject.intOuNull(k: String) = if (isNull(k)) null else getInt(k)
private fun JSONObject.strOuNull(k: String) = if (isNull(k)) null else getString(k)

fun JSONObject.paraEstado(): Estado {
    val eu = getJSONObject("eu"); val casa = getJSONObject("casa")
    return Estado(
        euId = eu.getInt("id"), euAdmin = eu.getBoolean("admin"),
        casaNome = casa.getString("nome"), codigo = casa.getString("codigo"), modo = casa.getString("modo"),
        semana = getString("semana"), hoje = getString("hoje"),
        membros = getJSONArray("membros").mapa { Membro(it.getInt("id"), it.getString("nome"), it.getDouble("peso"), it.strOuNull("ausente_ate"), it.getInt("admin") == 1) },
        tarefas = getJSONArray("tarefas").mapa { Tarefa(it.getInt("id"), it.getString("nome"), it.getInt("pontos"), it.getInt("vezes"), it.intOuNull("fixo_id")) },
        atribuicoes = getJSONArray("atribuicoes").mapa {
            Atribuicao(it.getInt("id"), it.getInt("tarefa_id"), it.getString("tarefa"), it.intOuNull("membro_id"), it.getString("dia"), it.getInt("pontos"), !it.isNull("feito_em"))
        },
        placar = getJSONArray("placar").mapa { Placar(it.getInt("membroId"), it.getString("nome"), it.getInt("feitos"), it.getInt("previstos"), it.getDouble("saldo")) },
        preferencias = getJSONArray("preferencias").mapa { it.getInt("tarefa_id") to it.getInt("nivel") }.toMap(),
    )
}
