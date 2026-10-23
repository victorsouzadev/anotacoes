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
            Folha {
                Row(GlanceModifier.fillMaxWidth()) {
                    adicionar.forEachIndexed { i, (cod, nome, intent) ->
                        if (i > 0) Spacer(GlanceModifier.width(6.dp))
                        Pilula(nome, actionStartActivity(intent), GlanceModifier.defaultWeight(), principal = cod == agora)
                    }
                }
                Spacer(GlanceModifier.height(6.dp))
                Pilula("Foto do prato (IA)", actionStartActivity(foto), GlanceModifier.fillMaxWidth())
            }
        }
    }
}

class AtalhosWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = AtalhosWidget()
}
