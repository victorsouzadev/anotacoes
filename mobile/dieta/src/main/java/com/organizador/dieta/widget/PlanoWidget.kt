package com.organizador.dieta.widget

import android.content.Context
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.LocalSize
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.glance.currentState
import androidx.glance.layout.Alignment
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.width
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import com.organizador.dieta.DietaApplication
import com.organizador.dieta.data.Datas
import kotlin.math.roundToInt

/** Qual opção o widget está mostrando (índice; volta ao começo quando passa da última). */
private val indiceKey = intPreferencesKey("opcao")
private val refeicaoKey = ActionParameters.Key<String>("refeicao")
private val opcaoKey = ActionParameters.Key<Int>("opcao")

/** Próxima refeição do plano: mostra uma opção por vez, "Registrar" lança a opção inteira no dia. */
class PlanoWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Exact
    override val stateDefinition = PreferencesGlanceStateDefinition

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val d = Widgets.dados(context)
        val abrirPlano = Widgets.abrir(context, "plano")
        val abrirHoje = Widgets.abrir(context, "hoje")
        provideContent {
            val p = d.proxima
            if (p == null || p.opcoes.isEmpty()) {
                Folha(actionStartActivity(if (p == null) abrirHoje else abrirPlano)) {
                    Rotulo("Plano alimentar")
                    Spacer(GlanceModifier.height(4.dp))
                    Titulo(
                        when {
                            d.tudoRegistrado || p == null -> "Tudo registrado por hoje"
                            else -> "Sem plano para ${p.nome.lowercase()}"
                        },
                    )
                    if (p != null) Rotulo("Toque para montar o plano com a IA", tamanho = 11.sp)
                }
                return@provideContent
            }
            val indice = (currentState<Preferences>()[indiceKey] ?: 0).mod(p.opcoes.size)
            val op = p.opcoes[indice]
            Folha {
                Row(GlanceModifier.fillMaxWidth().clickable(actionStartActivity(abrirPlano)), verticalAlignment = Alignment.CenterVertically) {
                    Titulo(p.nome, GlanceModifier.defaultWeight())
                    Valor("${op.kcal.roundToInt()} kcal · P ${op.proteina.roundToInt()} g", cor = CoresWidget.grafiteSuave, tamanho = 11.sp)
                }
                Rotulo(if (p.opcoes.size > 1) "Opção ${op.numero} de ${p.opcoes.size}" else "Opção ${op.numero}", tamanho = 11.sp)
                Spacer(GlanceModifier.height(4.dp))
                // Até 4 itens; o resto vira "+ N". Lista simples (Column): os launchers da Samsung falham com LazyColumn.
                // Quantos itens cabem: ~18 dp por linha além do cabeçalho e dos botões.
                val cabem = ((LocalSize.current.height.value - 110) / 18).toInt().coerceIn(2, 8)
                op.itens.take(cabem).forEach { item ->
                    Row(GlanceModifier.fillMaxWidth()) {
                        Text(item.nome, GlanceModifier.defaultWeight(), style = TextStyle(color = CoresWidget.grafite, fontSize = 12.sp), maxLines = 1)
                        Valor("${item.quantidadeG.roundToInt()} g", tamanho = 11.sp)
                    }
                }
                if (op.itens.size > cabem) Rotulo("+ ${op.itens.size - cabem} itens", tamanho = 11.sp)
                Spacer(GlanceModifier.defaultWeight())
                Row(GlanceModifier.fillMaxWidth()) {
                    Pilula("Registrar", actionRunCallback<RegistrarOpcao>(actionParametersOf(refeicaoKey to p.codigo, opcaoKey to op.numero)),
                        GlanceModifier.defaultWeight(), principal = true)
                    if (p.opcoes.size > 1) {
                        Spacer(GlanceModifier.width(6.dp))
                        Pilula("Outra opção", actionRunCallback<ProximaOpcao>(), GlanceModifier.defaultWeight())
                    }
                }
            }
        }
    }
}

class ProximaOpcao : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        updateAppWidgetState(context, glanceId) { it[indiceKey] = (it[indiceKey] ?: 0) + 1 }
        PlanoWidget().update(context, glanceId)
    }
}

class RegistrarOpcao : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val refeicao = parameters[refeicaoKey] ?: return
        val opcao = parameters[opcaoKey] ?: return
        val app = context.applicationContext as DietaApplication
        val itens = Widgets.planoDoDia(app.db.plano().ativos(), refeicao).filter { it.opcao == opcao }
        updateAppWidgetState(context, glanceId) { it[indiceKey] = 0 }
        // Repo.registrarOpcao pede sync e redesenha os widgets (a refeição sai da vez e entra a próxima).
        app.repo.registrarOpcao(Datas.hoje(), refeicao, itens)
    }
}

class PlanoWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = PlanoWidget()
}
