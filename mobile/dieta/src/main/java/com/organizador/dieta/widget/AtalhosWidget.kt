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
import androidx.compose.ui.unit.sp
import androidx.glance.LocalSize
import androidx.glance.layout.Alignment
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.width

private val CURTOS = listOf("cafe" to "Café", "almoco" to "Almoço", "lanche" to "Lanche", "jantar" to "Jantar")

/** Atalhos: abre "adicionar" já na refeição; "Foto do prato" abre a câmera e manda para a IA reconhecer. */
class AtalhosWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val agora = Widgets.refeicaoDoHorario()
        val adicionar = CURTOS.map { (cod, nome) -> Triple(cod, nome, Widgets.abrir(context, "adicionar/$cod")) }
        val foto = Widgets.abrir(context, "foto/$agora")
        provideContent {
            // 4x1 (baixo): uma linha só com as refeições e a foto; mais alto: duas linhas com botões maiores.
            val tam = LocalSize.current
            val baixo = tam.height < 100.dp
            val texto = if (tam.width < 260.dp) 12.sp else 13.sp
            Folha {
                Row(GlanceModifier.fillMaxWidth().defaultWeight(), verticalAlignment = Alignment.CenterVertically) {
                    adicionar.forEachIndexed { i, (cod, nome, intent) ->
                        if (i > 0) Spacer(GlanceModifier.width(5.dp))
                        Pilula(nome, actionStartActivity(intent), GlanceModifier.defaultWeight(), principal = cod == agora,
                            tamanho = texto, vertical = if (baixo) 8.dp else 12.dp)
                    }
                    if (baixo) {
                        Spacer(GlanceModifier.width(5.dp))
                        Pilula("Foto", actionStartActivity(foto), GlanceModifier.defaultWeight(), tamanho = texto, vertical = 8.dp)
                    }
                }
                if (!baixo) {
                    Spacer(GlanceModifier.height(6.dp))
                    Pilula("Foto do prato (IA)", actionStartActivity(foto), GlanceModifier.fillMaxWidth(), tamanho = texto, vertical = 12.dp)
                }
            }
        }
    }
}


class AtalhosWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = AtalhosWidget()
}
