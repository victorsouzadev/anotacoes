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
import androidx.compose.ui.graphics.asImageBitmap

class CasaViewModel(app: Application) : AndroidViewModel(app) {
    private val prefs = app.getSharedPreferences("casa", Context.MODE_PRIVATE)
    val api = Api(
        prefs.getString("servidor", null)?.takeIf { it != "http://191.252.177.244:8095" } ?: BuildConfig.SERVIDOR,
        prefs.getString("token", null),
    )

    var estado by mutableStateOf<Estado?>(null); private set
    /** "sistema", "claro" ou "escuro". */
    var tema by mutableStateOf(prefs.getString("tema", "sistema") ?: "sistema"); private set
    fun escolherTema(t: String) { tema = t; prefs.edit().putString("tema", t).apply() }
    /** Tarefa aberta no detalhe (comentários, não feita). */
    var detalhe by mutableStateOf<Int?>(null)
    var painelAberto by mutableStateOf(false)
    /** Último comentário dos outros nas minhas tarefas que eu já vi. */
    var vistoComentario by mutableStateOf(prefs.getInt("visto_comentario", 0)); private set
    fun marcarComentariosVistos() {
        val ultimo = estado?.comentarios?.maxOfOrNull { it.id } ?: return
        if (ultimo > vistoComentario) { vistoComentario = ultimo; prefs.edit().putInt("visto_comentario", ultimo).apply() }
    }
    var carregando by mutableStateOf(false); private set
    var erro by mutableStateOf<String?>(null)
    // Precisa ser estado do Compose: a tela inicial escolhe entre boas-vindas e app por este valor.
    var logado by mutableStateOf(api.token != null); private set

    init { if (logado) atualizar() }

    private fun executa(bloco: suspend () -> JSONObject?) = viewModelScope.launch {
        carregando = true; erro = null
        try {
            val r = bloco()
            if (r != null) { if (r.optBoolean("saiu")) sair() else if (r.has("casa")) estado = r.paraEstado().also { sincronizarAgenda(it) } }
        } catch (e: ApiErro) {
            erro = e.message; if (e.status == 401) sair()
            if (e.status >= 500) Registro.erro("erro_api", e)
        } catch (e: java.io.IOException) {
            erro = "Sem conexão com o servidor (${e.javaClass.simpleName})"
            Registro.aviso("sem_conexao", e)
        } catch (e: Exception) {
            // Falha do próprio app (ex.: resposta que não conseguiu interpretar): mostra e registra.
            erro = "Erro no app: ${e.javaClass.simpleName}"
            Registro.erro("erro_app", e)
        } finally { carregando = false }
    }

    private suspend fun guardaToken(servidor: String, r: JSONObject): JSONObject {
        api.servidor = servidor; api.token = r.getString("token"); logado = true
        prefs.edit().putString("servidor", servidor).putString("token", api.token).apply()
        Lembretes.agendar(getApplication())
        return api.chamar("GET", "/api/estado")
    }

    fun criar(servidor: String, casa: String, nome: String) = if (carregando) null else executa {
        api.servidor = servidor
        guardaToken(servidor, api.chamar("POST", "/api/casas", JSONObject().put("nome", casa).put("membroNome", nome)))
    }
    fun entrar(servidor: String, codigo: String, nome: String) = if (carregando) null else executa {
        api.servidor = servidor
        guardaToken(servidor, api.chamar("POST", "/api/entrar", JSONObject().put("codigo", codigo).put("nome", nome)))
    }
    fun sair() { api.token = null; logado = false; estado = null; prefs.edit().remove("token").apply(); Lembretes.agendar(getApplication()) }

    fun atualizar() = executa { api.chamar("GET", "/api/estado") }
    fun concluir(a: Atribuicao) = executa { api.chamar("POST", "/api/atribuicoes/${a.id}/${if (a.feito) "desfazer" else "concluir"}") }
    fun assumir(a: Atribuicao) = executa { api.chamar("POST", "/api/atribuicoes/${a.id}/assumir") }
    fun redistribuir() = executa { api.chamar("POST", "/api/distribuir") }
    fun modo(m: String) = executa { api.chamar("PUT", "/api/casa", JSONObject().put("modo", m)) }

    fun salvarTarefa(id: Int?, nome: String, pontos: Int, vezes: Int, fixoId: Int?, condicaoId: Int?, horario: String?, duracao: Int) = executa {
        val b = JSONObject().put("nome", nome).put("pontos", pontos).put("vezes", vezes).put("fixoId", fixoId ?: JSONObject.NULL)
            .put("condicaoId", condicaoId ?: JSONObject.NULL).put("horario", horario ?: "").put("duracao", duracao)
        if (id == null) api.chamar("POST", "/api/tarefas", b) else api.chamar("PUT", "/api/tarefas/$id", b)
    }
    fun removerTarefa(id: Int) = executa { api.chamar("DELETE", "/api/tarefas/$id") }
    fun preferencia(tarefaId: Int, nivel: Int) = executa { api.chamar("PUT", "/api/preferencias", JSONObject().put("$tarefaId", nivel)) }

    fun salvarMembro(m: Membro, peso: Double, ausenteAte: String?, disponibilidade: List<Double>) = executa {
        api.chamar("PUT", "/api/membros/${m.id}", JSONObject().put("peso", peso).put("ausenteAte", ausenteAte ?: "")
            .put("disponibilidade", org.json.JSONArray(disponibilidade)))
    }

    fun salvarRegra(id: Int?, nome: String, tipo: String, referencia: String?, dias: List<Int>) = executa {
        val b = JSONObject().put("nome", nome).put("tipo", tipo).put("dias", org.json.JSONArray(dias))
        if (referencia != null) b.put("referencia", referencia)
        if (id == null) api.chamar("POST", "/api/condicoes", b) else api.chamar("PUT", "/api/condicoes/$id", b)
    }
    fun removerRegra(id: Int) = executa { api.chamar("DELETE", "/api/condicoes/$id") }

    fun naoFeita(a: Atribuicao, motivo: String) = executa { api.chamar("POST", "/api/atribuicoes/${a.id}/nao-feita", JSONObject().put("motivo", motivo)) }
    fun reabrir(a: Atribuicao) = executa { api.chamar("POST", "/api/atribuicoes/${a.id}/reabrir") }
    fun comentar(a: Atribuicao, texto: String) = executa { api.chamar("POST", "/api/atribuicoes/${a.id}/comentarios", JSONObject().put("texto", texto)) }
    fun apagarComentario(id: Int) = executa { api.chamar("DELETE", "/api/comentarios/$id") }

    // Fotos: reduzida no celular (Fotos.kt) e enviada; "concluir" já marca a tarefa como feita.
    val fotos = androidx.compose.runtime.mutableStateMapOf<Int, androidx.compose.ui.graphics.ImageBitmap>()
    fun enviarFoto(a: Atribuicao, uri: android.net.Uri, concluir: Boolean) = executa {
        val jpeg = Fotos.reduzir(getApplication(), uri)
        val r = JSONObject(String(api.bytes("PUT", "/api/atribuicoes/${a.id}/foto", jpeg)))
        fotos.remove(a.id)
        if (concluir && !a.feito) api.chamar("POST", "/api/atribuicoes/${a.id}/concluir") else r
    }
    fun removerFoto(a: Atribuicao) = executa { fotos.remove(a.id); JSONObject(String(api.bytes("DELETE", "/api/atribuicoes/${a.id}/foto"))) }
    fun carregarFoto(a: Atribuicao) {
        if (!a.foto || fotos.containsKey(a.id)) return
        viewModelScope.launch {
            runCatching {
                val b = api.bytes("GET", "/api/atribuicoes/${a.id}/foto")
                android.graphics.BitmapFactory.decodeByteArray(b, 0, b.size)?.let { bm -> fotos[a.id] = bm.asImageBitmap() }
            }.onFailure { Registro.aviso("foto_carregar", it) }
        }
    }

    fun gerarPainel() = executa { api.chamar("POST", "/api/painel") }
    fun desligarPainel() = executa { api.chamar("DELETE", "/api/painel") }
    fun desconectarAparelhos() = executa { api.chamar("DELETE", "/api/painel/sessoes") }
    fun conectarTv(codigo: String) = executa { api.chamar("POST", "/api/tv", JSONObject().put("codigo", codigo)) }

    // Agenda: link .ics (servidor) e sincronização com a agenda do celular (Agenda.kt).
    fun gerarLinkAgenda() = executa { api.chamar("POST", "/api/agenda") }
    fun desligarLinkAgenda() = executa { api.chamar("DELETE", "/api/agenda") }
    fun sincronizarAgenda(e: Estado? = estado) {
        if (e == null) return
        viewModelScope.launch(kotlinx.coroutines.Dispatchers.IO) { Agenda.sincronizar(getApplication(), e) }
    }
    fun removerMembro(id: Int) = executa { api.chamar("DELETE", "/api/membros/$id") }
}
