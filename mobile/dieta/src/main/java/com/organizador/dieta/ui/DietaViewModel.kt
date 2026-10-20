package com.organizador.dieta.ui

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.organizador.dieta.DietaApplication
import com.organizador.dieta.data.Agendador
import com.organizador.dieta.data.Alimento
import com.organizador.dieta.data.ApiException
import com.organizador.dieta.data.Calculos
import com.organizador.dieta.data.Datas
import com.organizador.dieta.data.Foto
import com.organizador.dieta.data.Json
import com.organizador.dieta.data.Metas
import com.organizador.dieta.data.Perfil
import com.organizador.dieta.data.objetos
import com.organizador.dieta.data.optStringOrNull
import java.io.File
import java.time.LocalDate
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

data class DiaProg(val data: LocalDate, val nivel: Int)
data class ConquistaUi(val codigo: String, val nome: String, val descricao: String, val em: String?)
data class Progresso(
    val xpTotal: Int, val nivel: Int, val xpNoNivel: Int, val xpParaProximo: Int,
    val sequencia: Int, val sequenciaMeta: Int, val melhorSequencia: Int, val diasRegistrados: Int,
    val conquistas: List<ConquistaUi>, val desafio: String, val desafioFeito: Int, val desafioAlvo: Int, val dias: List<DiaProg>,
) {
    companion object {
        fun de(json: String): Progresso? = runCatching {
            val j = JSONObject(json)
            val d = j.getJSONObject("desafio")
            Progresso(
                j.getInt("xpTotal"), j.getInt("nivel"), j.getInt("xpNoNivel"), j.getInt("xpParaProximo"),
                j.getInt("sequenciaRegistro"), j.getInt("sequenciaMeta"), j.getInt("melhorSequencia"), j.getInt("diasRegistrados"),
                j.getJSONArray("conquistas").objetos().map { ConquistaUi(it.getString("codigo"), it.getString("nome"), it.getString("descricao"), it.optStringOrNull("em")) },
                d.getString("descricao"), d.getInt("feito"), d.getInt("alvo"),
                j.getJSONArray("dias").objetos().map { x ->
                    val reg = x.getInt("registros")
                    val nivel = if (reg == 0) 0 else 1 + listOf("kcalNaMeta", "proteinaNaMeta", "aguaNaMeta").count { x.getBoolean(it) }
                    DiaProg(LocalDate.parse(x.getString("data")), nivel)
                },
            )
        }.getOrNull()
    }
}

data class Link(val id: String, val titulo: String, val escopos: List<String>, val url: String, val expiraEm: String?, val revogado: Boolean)

@OptIn(ExperimentalCoroutinesApi::class)
class DietaViewModel(app: Application) : AndroidViewModel(app) {
    private val a = app as DietaApplication
    val repo = a.repo
    private val db = a.db
    private val prefs = a.prefs

    val dia = MutableStateFlow(Datas.hoje())
    private fun <T> st(f: kotlinx.coroutines.flow.Flow<T>, inicial: T): StateFlow<T> = f.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), inicial)

    val registrosDia = st(dia.flatMapLatest { db.registros().doDia(it.toString()) }, emptyList())
    val aguaDia = st(dia.flatMapLatest { db.agua().doDia(it.toString()) }, emptyList())
    val fotosDia = st(dia.flatMapLatest { db.fotos().refeicoesDoDia(it.toString()) }, emptyList())
    val alimentos = st(db.alimentos().todos(), emptyList())
    val meusAlimentos = st(db.alimentos().meus(), emptyList())
    val recentes = st(db.registros().recentes(), emptyList())
    val pesos = st(db.pesos().todos(), emptyList())
    val plano = st(db.plano().todos(), emptyList())
    val fotosRefeicao = st(db.fotos().doTipo("refeicao"), emptyList())
    val fotosCorpo = st(db.fotos().doTipo("corpo"), emptyList())
    val semana = st(db.registros().periodo(Datas.hoje().minusDays(6).toString(), Datas.hoje().toString()), emptyList())

    val perfil: StateFlow<Perfil> = prefs.perfil
    val metas: StateFlow<Metas> = st(combine(prefs.perfil, pesos) { p, ps -> Calculos.vigentes(p, ps.lastOrNull()?.kg) }, Calculos.PADRAO)
    val sugestao: StateFlow<Metas> = st(combine(prefs.perfil, pesos) { p, ps -> Calculos.sugerir(p, ps.lastOrNull()?.kg) }, Calculos.PADRAO)
    val progresso: StateFlow<Progresso?> = st(prefs.progresso.map { it?.let(Progresso::de) }, prefs.progresso.value?.let(Progresso::de))
    val email = prefs.email
    val ultimoSync = prefs.ultimoSync

    /** Mensagem curta para o snackbar (erro de sync, código não encontrado…). */
    val aviso = MutableStateFlow<String?>(null)
    val sincronizando = MutableStateFlow(false)
    val links = MutableStateFlow<List<Link>>(emptyList())

    init {
        viewModelScope.launch {
            repo.garantirTaco()
            if (a.api.logado) sincronizar(silencioso = true)
        }
    }

    fun avisar(msg: String) { aviso.value = msg }

    fun sincronizar(silencioso: Boolean = false) = viewModelScope.launch {
        if (!a.api.logado) { if (!silencioso) avisar("Entre com a conta do hub em Mais → Conta para sincronizar."); return@launch }
        sincronizando.value = true
        try {
            a.sincronizador.sincronizar()
            if (!silencioso) avisar("Sincronizado.")
        } catch (e: Exception) {
            if (!silencioso) avisar(e.message ?: "Sem conexão com o servidor.")
            Agendador.syncAgora(getApplication())
        } finally {
            sincronizando.value = false
        }
    }

    fun entrar(servidor: String, email: String, senha: String, criarConta: Boolean, aoEntrar: () -> Unit) = viewModelScope.launch {
        try {
            prefs.servidor = servidor
            a.api.entrar(email, senha, criarConta)
            prefs.limparMarcas()
            aoEntrar()
            sincronizar()
        } catch (e: Exception) {
            avisar(e.message ?: "Não foi possível entrar.")
        }
    }

    fun sair() = viewModelScope.launch { a.api.sair() }
    val servidor: String get() = prefs.servidor
    var lembretes: Boolean
        get() = prefs.lembretesAtivos
        set(v) { prefs.lembretesAtivos = v }

    fun lancar(bloco: suspend () -> Unit) = viewModelScope.launch {
        try { bloco() } catch (e: Exception) { avisar(e.message ?: "Algo deu errado.") }
    }

    /** Código de barras: alimento próprio já salvo, senão o servidor consulta a Open Food Facts. */
    fun buscarCodigo(codigo: String, achou: (Alimento) -> Unit) = lancar {
        db.alimentos().porCodigo(codigo)?.let { achou(it); return@lancar }
        if (!a.api.logado) { avisar("Para buscar pelo código, entre com a conta do hub. Ou cadastre o alimento."); return@lancar }
        try {
            val al = Json.alimento(a.api.chamar("GET", "/api/dieta/alimentos/codigo/$codigo") as JSONObject)
            db.alimentos().salvar(al)
            achou(al)
        } catch (e: ApiException) {
            avisar(if (e.status == 404) "Produto $codigo não encontrado. Cadastre manualmente." else e.message ?: "Falha na busca.")
        }
    }

    fun foto(uri: Uri, data: LocalDate, tipo: String, rotulo: String?, depois: suspend (Foto) -> Unit = {}) = lancar {
        depois(repo.guardarFoto(uri, data, tipo, rotulo))
    }

    // ---------- Compartilhamento (online) ----------
    fun carregarLinks() = lancar {
        if (!a.api.logado) return@lancar
        links.value = (a.api.chamar("GET", "/api/dieta/compartilhamentos") as JSONArray).objetos().map(::link)
    }

    fun criarLink(titulo: String, escopos: List<String>, dias: Int?, pronto: (Link) -> Unit) = lancar {
        if (!a.api.logado) { avisar("Entre com a conta do hub para criar links."); return@lancar }
        sincronizar(silencioso = true).join()
        val corpo = JSONObject().put("titulo", titulo).put("escopos", JSONArray(escopos)).put("diasValidade", dias ?: JSONObject.NULL)
        val l = link(a.api.chamar("POST", "/api/dieta/compartilhamentos", corpo) as JSONObject)
        links.value = listOf(l) + links.value
        pronto(l)
    }

    fun revogar(l: Link) = lancar {
        a.api.chamar("DELETE", "/api/dieta/compartilhamentos/${l.id}")
        carregarLinks()
    }

    private fun link(j: JSONObject): Link {
        val esc = j.getJSONArray("escopos")
        return Link(j.getString("id"), j.getString("titulo"), (0 until esc.length()).map { esc.getString(it) }, j.getString("url"),
            j.optStringOrNull("expiraEm"), j.optStringOrNull("revogadoEm") != null)
    }

    /** Baixa o CSV do período para compartilhar (nutricionista, planilha). */
    fun exportar(dias: Long, pronto: (File) -> Unit) = lancar {
        if (!a.api.logado) { avisar("Entre com a conta do hub para exportar."); return@lancar }
        sincronizar(silencioso = true).join()
        val fim = Datas.hoje()
        val arq = File(getApplication<Application>().cacheDir, "compartilhar/dieta-$fim.csv")
        a.api.baixar("/api/dieta/export.csv?inicio=${fim.minusDays(dias)}&fim=$fim", arq)
        pronto(arq)
    }
}
