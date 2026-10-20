package com.casa.app

import android.app.Application
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch
import org.json.JSONObject

class CasaViewModel(app: Application) : AndroidViewModel(app) {
    private val prefs = app.getSharedPreferences("casa", Context.MODE_PRIVATE)
    val api = Api(
        prefs.getString("servidor", null)?.takeIf { it != "http://191.252.177.244:8095" } ?: BuildConfig.SERVIDOR,
        prefs.getString("token", null),
    )

    var estado by mutableStateOf<Estado?>(null); private set
    var carregando by mutableStateOf(false); private set
    var erro by mutableStateOf<String?>(null)
    val logado get() = api.token != null

    init { if (logado) atualizar() }

    private fun executa(bloco: suspend () -> JSONObject?) = viewModelScope.launch {
        carregando = true; erro = null
        try {
            val r = bloco()
            if (r != null) { if (r.optBoolean("saiu")) sair() else if (r.has("casa")) estado = r.paraEstado() }
        } catch (e: ApiErro) {
            erro = e.message; if (e.status == 401) sair()
        } catch (e: Exception) {
            erro = "Sem conexão com o servidor (${e.javaClass.simpleName})"
        } finally { carregando = false }
    }

    private suspend fun guardaToken(servidor: String, r: JSONObject): JSONObject {
        api.servidor = servidor; api.token = r.getString("token")
        prefs.edit().putString("servidor", servidor).putString("token", api.token).apply()
        Lembretes.agendar(getApplication())
        return api.chamar("GET", "/api/estado")
    }

    fun criar(servidor: String, casa: String, nome: String) = executa {
        api.servidor = servidor
        guardaToken(servidor, api.chamar("POST", "/api/casas", JSONObject().put("nome", casa).put("membroNome", nome)))
    }
    fun entrar(servidor: String, codigo: String, nome: String) = executa {
        api.servidor = servidor
        guardaToken(servidor, api.chamar("POST", "/api/entrar", JSONObject().put("codigo", codigo).put("nome", nome)))
    }
    fun sair() { api.token = null; estado = null; prefs.edit().remove("token").apply(); Lembretes.agendar(getApplication()) }

    fun atualizar() = executa { api.chamar("GET", "/api/estado") }
    fun concluir(a: Atribuicao) = executa { api.chamar("POST", "/api/atribuicoes/${a.id}/${if (a.feito) "desfazer" else "concluir"}") }
    fun assumir(a: Atribuicao) = executa { api.chamar("POST", "/api/atribuicoes/${a.id}/assumir") }
    fun redistribuir() = executa { api.chamar("POST", "/api/distribuir") }
    fun modo(m: String) = executa { api.chamar("PUT", "/api/casa", JSONObject().put("modo", m)) }

    fun salvarTarefa(id: Int?, nome: String, pontos: Int, vezes: Int, fixoId: Int?) = executa {
        val b = JSONObject().put("nome", nome).put("pontos", pontos).put("vezes", vezes).put("fixoId", fixoId ?: JSONObject.NULL)
        if (id == null) api.chamar("POST", "/api/tarefas", b) else api.chamar("PUT", "/api/tarefas/$id", b)
    }
    fun removerTarefa(id: Int) = executa { api.chamar("DELETE", "/api/tarefas/$id") }
    fun preferencia(tarefaId: Int, nivel: Int) = executa { api.chamar("PUT", "/api/preferencias", JSONObject().put("$tarefaId", nivel)) }

    fun salvarMembro(m: Membro, peso: Double, ausenteAte: String?) = executa {
        api.chamar("PUT", "/api/membros/${m.id}", JSONObject().put("peso", peso).put("ausenteAte", ausenteAte ?: ""))
    }
    fun removerMembro(id: Int) = executa { api.chamar("DELETE", "/api/membros/$id") }
}
