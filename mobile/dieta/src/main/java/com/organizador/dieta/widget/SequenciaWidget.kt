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
import androidx.glance.LocalSize
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
            val tam = LocalSize.current
            val alto = tam.height >= 150.dp
            Folha(actionStartActivity(abrir)) {
                if (p == null) {
                    Titulo("Progresso")
                    Rotulo("Abra o app para sincronizar", tamanho = 11.sp)
                    return@Folha
                }
                Row(verticalAlignment = Alignment.Bottom) {
                    Numero("${p.sequencia}", tamanho = if (alto) 38.sp else 26.sp)
                    Rotulo(if (p.sequencia == 1) " dia seguido" else " dias seguidos", GlanceModifier.padding(bottom = if (alto) 7.dp else 4.dp))
                }
                Spacer(GlanceModifier.defaultWeight())
                LinhaMeta("Nível ${p.nivel}", "${p.xpNoNivel}/${p.xpParaProximo} XP", p.xpNoNivel.toFloat() / p.xpParaProximo.coerceAtLeast(1), 11.sp)
                Spacer(GlanceModifier.defaultWeight())
                // A descrição do desafio pode ser longa: em widget alto ganha a linha toda, com o placar à parte.
                LinhaMeta(p.desafio, "${p.desafioFeito}/${p.desafioAlvo}", p.desafioFeito.toFloat() / p.desafioAlvo.coerceAtLeast(1), 11.sp)
                if (alto) {
                    Spacer(GlanceModifier.defaultWeight())
                    // Uma semana por quadradinho até 14 dias, conforme a largura.
                    val dias = if (tam.width >= 220.dp) 14 else 7
                    Rotulo("Últimos $dias dias", tamanho = 10.sp)
                    Spacer(GlanceModifier.height(3.dp))
                    Heatmap(p.dias.sortedBy { it.data }.takeLast(dias).map { it.nivel })
                }
            }
        }
    }
}


class SequenciaWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = SequenciaWidget()
}
