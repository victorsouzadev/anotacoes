package com.organizador.dieta.widget

import android.content.Context
import androidx.compose.ui.unit.dp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.provideContent
import androidx.glance.layout.Alignment
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt

/** Resumo do dia: kcal restantes, barra de calorias, proteína e água. Toque abre a tela Hoje. */
class ResumoWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val d = Widgets.dados(context)
        val abrir = Widgets.abrir(context, "hoje")
        provideContent {
            Folha(actionStartActivity(abrir)) {
                val restante = d.metas.kcal - d.totais.kcal
                Rotulo("Hoje")
                Row(verticalAlignment = Alignment.Bottom) {
                    Numero("${kotlin.math.abs(restante).roundToInt()}", if (restante >= 0) CoresWidget.grafite else CoresWidget.atencao)
                    Rotulo(if (restante >= 0) " kcal restantes" else " kcal acima", GlanceModifier.padding(bottom = 4.dp))
                }
                Spacer(GlanceModifier.height(4.dp))
                Barra((d.totais.kcal / d.metas.kcal.coerceAtLeast(1)).toFloat())
                Spacer(GlanceModifier.height(6.dp))
                Row(GlanceModifier.fillMaxWidth()) {
                    Rotulo("Proteína ", tamanho = 11.sp)
                    Valor("${d.totais.proteina.roundToInt()}/${d.metas.proteinaG} g", GlanceModifier.defaultWeight(), tamanho = 11.sp)
                    Rotulo("Água ", tamanho = 11.sp)
                    Valor("${fmtMl(d.aguaMl)}/${fmtMl(d.metas.aguaMl)}", tamanho = 11.sp)
                }
            }
        }
    }
}

class ResumoWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = ResumoWidget()
}
