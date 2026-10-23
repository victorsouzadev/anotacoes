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
import androidx.glance.LocalSize
import kotlin.math.abs
import kotlin.math.roundToInt

/** Resumo do dia: kcal restantes, barra de calorias, proteína e água. Toque abre a tela Hoje. */
class ResumoWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val d = Widgets.dados(context)
        val abrir = Widgets.abrir(context, "hoje")
        provideContent {
            // Alto: números maiores e as quatro metas; baixo: kcal e uma linha com proteína e água.
            val alto = LocalSize.current.height >= 150.dp
            val m = d.metas
            val t = d.totais
            Folha(actionStartActivity(abrir)) {
                val restante = m.kcal - t.kcal
                Row(GlanceModifier.fillMaxWidth()) {
                    Rotulo("Hoje", GlanceModifier.defaultWeight())
                    Valor("${t.kcal.roundToInt()} de ${m.kcal} kcal", cor = CoresWidget.grafiteSuave, tamanho = 11.sp)
                }
                Row(verticalAlignment = Alignment.Bottom) {
                    Numero("${abs(restante).roundToInt()}", if (restante >= 0) CoresWidget.grafite else CoresWidget.atencao,
                        tamanho = if (alto) 40.sp else 28.sp)
                    Rotulo(if (restante >= 0) " kcal restantes" else " kcal acima", GlanceModifier.padding(bottom = if (alto) 7.dp else 4.dp))
                }
                Spacer(GlanceModifier.height(4.dp))
                Barra((t.kcal / m.kcal.coerceAtLeast(1)).toFloat(), altura = if (alto) 8.dp else 6.dp)
                Spacer(GlanceModifier.defaultWeight())
                fun f(v: Double, meta: Int) = (v / meta.coerceAtLeast(1)).toFloat()
                if (alto) {
                    LinhaMeta("Proteína", "${t.proteina.roundToInt()} / ${m.proteinaG} g", f(t.proteina, m.proteinaG))
                    Spacer(GlanceModifier.defaultWeight())
                    LinhaMeta("Carboidrato", "${t.carbo.roundToInt()} / ${m.carboG} g", f(t.carbo, m.carboG))
                    Spacer(GlanceModifier.defaultWeight())
                    LinhaMeta("Gordura", "${t.gordura.roundToInt()} / ${m.gorduraG} g", f(t.gordura, m.gorduraG))
                    Spacer(GlanceModifier.defaultWeight())
                    LinhaMeta("Água", "${fmtMl(d.aguaMl)} / ${fmtMl(m.aguaMl)}", d.aguaMl.toFloat() / m.aguaMl.coerceAtLeast(1))
                } else Row(GlanceModifier.fillMaxWidth()) {
                    Rotulo("Proteína ", tamanho = 11.sp)
                    Valor("${t.proteina.roundToInt()}/${m.proteinaG} g", GlanceModifier.defaultWeight(), tamanho = 11.sp)
                    Rotulo("Água ", tamanho = 11.sp)
                    Valor("${fmtMl(d.aguaMl)}/${fmtMl(m.aguaMl)}", tamanho = 11.sp)
                }
            }
        }
    }
}

class ResumoWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = ResumoWidget()
}
