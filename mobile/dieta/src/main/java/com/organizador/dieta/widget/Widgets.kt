package com.organizador.dieta.widget

import android.content.Context
import android.content.Intent
import androidx.compose.ui.graphics.Color
import androidx.glance.appwidget.updateAll
import androidx.glance.color.ColorProvider
import com.organizador.dieta.DietaApplication
import com.organizador.dieta.MainActivity
import com.organizador.dieta.data.Calculos
import com.organizador.dieta.data.Datas
import com.organizador.dieta.data.Metas
import com.organizador.dieta.data.PlanoItem
import com.organizador.dieta.data.REFEICOES
import com.organizador.dieta.data.Totais
import com.organizador.dieta.ui.GrafiteCores
import com.organizador.dieta.ui.Progresso
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.time.LocalTime

/** Tokens do Grafite para os widgets: dia e noite seguem o tema do aparelho (o launcher decide, não o app). */
object CoresWidget {
    private val d = GrafiteCores.Dia
    private val n = GrafiteCores.Noite
    private fun par(dia: Color, noite: Color) = ColorProvider(day = dia, night = noite)
    val papel = par(d.papel, n.papel)
    val folha = par(d.folha, n.folha)
    val grafite = par(d.grafite, n.grafite)
    val grafiteSuave = par(d.grafiteSuave, n.grafiteSuave)
    val linha = par(d.linha, n.linha)
    val nanquim = par(d.nanquim, n.nanquim)
    val nanquimTinta = par(d.nanquimTinta, n.nanquimTinta)
    val sobreNanquim = par(d.sobreNanquim, n.sobreNanquim)
    val atencao = par(d.atencao, n.atencao)
}

/** Uma opção do plano para a refeição, com o total já calculado. */
data class OpcaoWidget(val numero: Int, val itens: List<PlanoItem>, val kcal: Double, val proteina: Double)

/** Próxima refeição sem registro hoje, a partir do horário atual, e as opções do plano para ela. */
data class ProximaRefeicao(val codigo: String, val nome: String, val opcoes: List<OpcaoWidget>)

/** Tudo o que os widgets mostram, lido do banco local (funciona sem internet). */
data class DadosWidget(
    val metas: Metas,
    val totais: Totais,
    val aguaMl: Int,
    val proxima: ProximaRefeicao?,
    val tudoRegistrado: Boolean,
    val progresso: Progresso?,
)

object Widgets {
    private val escopo = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    /** Redesenha todos os widgets; chamado a cada gravação local e depois de cada sincronização. */
    fun atualizar(context: Context) {
        val app = context.applicationContext
        escopo.launch {
            runCatching {
                ResumoWidget().updateAll(app)
                AguaWidget().updateAll(app)
                PlanoWidget().updateAll(app)
                AtalhosWidget().updateAll(app)
                SequenciaWidget().updateAll(app)
            }
        }
    }

    /** Refeição "da vez" pelo relógio: é por ela que o widget do plano e o atalho de foto começam. */
    fun refeicaoDoHorario(agora: LocalTime = LocalTime.now()): String = when (agora.hour) {
        in 0..9 -> "cafe"
        in 10..14 -> "almoco"
        in 15..17 -> "lanche"
        in 18..20 -> "jantar"
        else -> "ceia"
    }

    /** Abre o app num destino: hoje, plano, progresso, adicionar/{refeicao} ou foto/{refeicao}. */
    fun abrir(context: Context, rota: String): Intent =
        Intent(context, MainActivity::class.java).putExtra(MainActivity.EXTRA_ABRIR, rota)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)

    /** Itens do plano de hoje para uma refeição: os do dia da semana têm prioridade sobre "todos os dias". */
    fun planoDoDia(plano: List<PlanoItem>, refeicao: String): List<PlanoItem> {
        val ds = Datas.diaSemana(Datas.hoje())
        return plano.filter { it.refeicao == refeicao && it.diaSemana == ds }
            .ifEmpty { plano.filter { it.refeicao == refeicao && it.diaSemana == -1 } }
    }

    suspend fun dados(context: Context): DadosWidget {
        val app = context.applicationContext as DietaApplication
        val db = app.db
        val hoje = Datas.hoje().toString()
        val metas = Calculos.vigentes(app.prefs.perfil.value, db.pesos().ultimo()?.kg)
        val registros = db.registros().doDiaLista(hoje)
        val totais = registros.fold(Totais()) { t, r -> t + r }
        val feitas = registros.map { it.refeicao }.toSet()
        val plano = db.plano().ativos()

        val inicio = REFEICOES.indexOfFirst { it.first == refeicaoDoHorario() }.coerceAtLeast(0)
        val pendentes = REFEICOES.drop(inicio).filter { it.first !in feitas }
        val escolhida = pendentes.firstOrNull { planoDoDia(plano, it.first).isNotEmpty() } ?: pendentes.firstOrNull()
        val proxima = escolhida?.let { (cod, nome) ->
            val opcoes = planoDoDia(plano, cod).groupBy { it.opcao }.toSortedMap().map { (n, itens) ->
                var kcal = 0.0
                var prot = 0.0
                itens.forEach { p ->
                    p.alimentoId?.let { db.alimentos().porId(it) }?.let { a ->
                        val t = Calculos.porcao(a, p.quantidadeG)
                        kcal += t.kcal; prot += t.proteina
                    }
                }
                OpcaoWidget(n, itens, kcal, prot)
            }
            ProximaRefeicao(cod, nome, opcoes)
        }
        return DadosWidget(metas, totais, db.agua().totalDoDia(hoje), proxima, pendentes.isEmpty(),
            app.prefs.progresso.value?.let(Progresso::de))
    }
}
