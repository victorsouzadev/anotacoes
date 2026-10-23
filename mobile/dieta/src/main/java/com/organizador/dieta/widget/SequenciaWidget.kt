package com.organizador.dieta.widget

import android.content.Context
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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

/** Sequência de dias, nível com a barra de XP e o desafio da semana. Toque abre o Progresso. */
class SequenciaWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val p = Widgets.dados(context).progresso
        val abrir = Widgets.abrir(context, "progresso")
        provideContent {
            Folha(actionStartActivity(abrir)) {
                if (p == null) {
                    Titulo("Progresso")
                    Rotulo("Abra o app para sincronizar", tamanho = 11.sp)
                    return@Folha
                }
                Row(verticalAlignment = Alignment.Bottom) {
                    Numero("${p.sequencia}")
                    Rotulo(if (p.sequencia == 1) " dia seguido" else " dias seguidos", GlanceModifier.padding(bottom = 4.dp))
                }
                Row(GlanceModifier.fillMaxWidth()) {
                    Rotulo("Nível ${p.nivel}", GlanceModifier.defaultWeight(), cor = CoresWidget.grafite)
                    Valor("${p.xpNoNivel}/${p.xpParaProximo} XP", cor = CoresWidget.grafiteSuave, tamanho = 11.sp)
                }
                Spacer(GlanceModifier.height(3.dp))
                Barra(p.xpNoNivel.toFloat() / p.xpParaProximo.coerceAtLeast(1), destaque = false, altura = 4.dp)
                Spacer(GlanceModifier.height(6.dp))
                Row(GlanceModifier.fillMaxWidth()) {
                    Rotulo(p.desafio, GlanceModifier.defaultWeight(), tamanho = 11.sp)
                    Valor(" ${p.desafioFeito}/${p.desafioAlvo}", tamanho = 11.sp)
                }
            }
        }
    }
}

class SequenciaWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = SequenciaWidget()
}
