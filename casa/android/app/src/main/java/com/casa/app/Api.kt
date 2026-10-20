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
            c.setRequestProperty("X-App-Versao", BuildConfig.VERSION_NAME)
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

/** disponibilidade: segunda a domingo; 1 = livre, 0.4 = pouco, 0 = nada. */
data class Membro(val id: Int, val nome: String, val peso: Double, val ausenteAte: String?, val admin: Boolean, val disponibilidade: List<Double>)
/** horario: "HH:MM" de preferência (ou null); duracao em minutos, para a agenda. */
data class Tarefa(val id: Int, val nome: String, val pontos: Int, val vezes: Int, val fixoId: Int?, val condicaoId: Int?, val horario: String?, val duracao: Int)
/** Regra da casa. tipo "alternado": vale em [referencia] e a cada 2 dias; "semana": nos [dias] (0 = segunda). */
data class Condicao(val id: Int, val nome: String, val tipo: String, val referencia: String?, val dias: List<Int>)
/** naoFeita: motivo (pode ser "") quando alguém marcou como não feita; null = não marcada. */
data class Atribuicao(val id: Int, val tarefaId: Int, val tarefa: String, val membroId: Int?, val dia: String, val pontos: Int, val feito: Boolean,
    val horario: String? = null, val duracao: Int = 30, val naoFeita: String? = null, val naoFeitaPor: Int? = null, val comentarios: Int = 0)
/** tipo: "comentario" ou "nao_feita" (criado ao marcar/sinalizar como não feita). */
data class Comentario(val id: Int, val atribuicaoId: Int, val membroId: Int?, val tipo: String, val texto: String, val em: String)
/** url/codigo: link + código para PC/TV (null se desligado); tvs: TVs pareadas; enderecoTv: o endereço curto que a TV abre. */
data class Painel(val url: String?, val codigo: String?, val aparelhos: Int, val tvs: Int, val enderecoTv: String)
data class Placar(val membroId: Int, val nome: String, val feitos: Int, val previstos: Int, val saldo: Double)
data class Estado(
    val euId: Int, val euAdmin: Boolean, val agendaUrl: String?, val casaNome: String, val codigo: String, val modo: String,
    val semana: String, val hoje: String, val membros: List<Membro>, val tarefas: List<Tarefa>,
    val atribuicoes: List<Atribuicao>, val placar: List<Placar>, val preferencias: Map<Int, Int>,
    val condicoes: List<Condicao>, val condicoesDoDia: Map<String, List<Int>>,
    val comentarios: List<Comentario> = emptyList(), val painel: Painel? = null,
) {
    fun regrasDoDia(dia: String) = condicoesDoDia[dia].orEmpty().mapNotNull { id -> condicoes.find { it.id == id } }
}

private inline fun <T> JSONArray.mapa(f: (JSONObject) -> T) = (0 until length()).map { f(getJSONObject(it)) }
private fun JSONObject.intOuNull(k: String) = if (isNull(k)) null else getInt(k)
private fun JSONObject.strOuNull(k: String) = if (isNull(k)) null else getString(k)
private fun JSONObject.optIntOuNull(k: String) = if (!has(k) || isNull(k)) null else getInt(k)
private fun JSONObject.optStrOuNull(k: String) = if (!has(k) || isNull(k)) null else getString(k)

fun JSONObject.paraEstado(): Estado {
    val eu = getJSONObject("eu"); val casa = getJSONObject("casa")
    return Estado(
        euId = eu.getInt("id"), euAdmin = eu.getBoolean("admin"), agendaUrl = eu.optStrOuNull("agendaUrl"),
        casaNome = casa.getString("nome"), codigo = casa.getString("codigo"), modo = casa.getString("modo"),
        semana = getString("semana"), hoje = getString("hoje"),
        membros = getJSONArray("membros").mapa {
            val d = it.optJSONArray("disponibilidade")
            Membro(it.getInt("id"), it.getString("nome"), it.getDouble("peso"), it.strOuNull("ausente_ate"), it.getInt("admin") == 1,
                List(7) { i -> d?.optDouble(i, 1.0) ?: 1.0 })
        },
        tarefas = getJSONArray("tarefas").mapa {
            Tarefa(it.getInt("id"), it.getString("nome"), it.getInt("pontos"), it.getInt("vezes"), it.intOuNull("fixo_id"), it.optIntOuNull("condicao_id"),
                it.optStrOuNull("horario"), it.optInt("duracao", 30))
        },
        condicoes = optJSONArray("condicoes")?.mapa {
            val d = it.optJSONArray("dias")
            Condicao(it.getInt("id"), it.getString("nome"), it.getString("tipo"), it.strOuNull("referencia"), List(d?.length() ?: 0) { i -> d!!.getInt(i) })
        }.orEmpty(),
        condicoesDoDia = optJSONArray("diasCondicoes")?.mapa {
            val c = it.getJSONArray("condicoes"); it.getString("dia") to List(c.length()) { i -> c.getInt(i) }
        }.orEmpty().toMap(),
        atribuicoes = getJSONArray("atribuicoes").mapa {
            Atribuicao(it.getInt("id"), it.getInt("tarefa_id"), it.getString("tarefa"), it.intOuNull("membro_id"), it.getString("dia"), it.getInt("pontos"), !it.isNull("feito_em"),
                it.optStrOuNull("horario"), it.optInt("duracao", 30), it.optStrOuNull("nao_feita"), it.optIntOuNull("nao_feita_por"), it.optInt("comentarios", 0))
        },
        comentarios = optJSONArray("comentarios")?.mapa {
            Comentario(it.getInt("id"), it.getInt("atribuicao_id"), it.optIntOuNull("membro_id"), it.getString("tipo"), it.optString("texto"), it.getString("em"))
        }.orEmpty(),
        painel = optJSONObject("painel")?.let { Painel(it.optStrOuNull("url"), it.optStrOuNull("codigo"), it.optInt("aparelhos"), it.optInt("tvs"), it.optString("enderecoTv")) },
        placar = getJSONArray("placar").mapa { Placar(it.getInt("membroId"), it.getString("nome"), it.getInt("feitos"), it.getInt("previstos"), it.getDouble("saldo")) },
        preferencias = getJSONArray("preferencias").mapa { it.getInt("tarefa_id") to it.getInt("nivel") }.toMap(),
    )
}
