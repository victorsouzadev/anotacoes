package com.organizador.dieta.widget

import android.content.Context
import androidx.compose.ui.unit.dp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.provideContent
import androidx.glance.layout.Alignment
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.width
import androidx.compose.ui.unit.sp
import androidx.glance.action.clickable
import androidx.glance.LocalSize
import androidx.glance.layout.padding
import com.organizador.dieta.DietaApplication
import com.organizador.dieta.data.Datas

private val mlKey = ActionParameters.Key<Int>("ml")

/** Água do dia com botões que registram direto, sem abrir o app. */
class AguaWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val d = Widgets.dados(context)
        val abrir = Widgets.abrir(context, "hoje")
        provideContent {
            val alto = LocalSize.current.height >= 150.dp
            val pct = 100 * d.aguaMl / d.metas.aguaMl.coerceAtLeast(1)
            Folha {
                Row(GlanceModifier.fillMaxWidth().clickable(actionStartActivity(abrir)), verticalAlignment = Alignment.CenterVertically) {
                    Titulo("Água", GlanceModifier.defaultWeight())
                    Rotulo("$pct% da meta", tamanho = 11.sp)
                }
                Row(verticalAlignment = Alignment.Bottom) {
                    Numero(fmtMl(d.aguaMl), tamanho = if (alto) 38.sp else 26.sp)
                    Rotulo(" de ${fmtMl(d.metas.aguaMl)}", GlanceModifier.padding(bottom = if (alto) 7.dp else 4.dp))
                }
                Spacer(GlanceModifier.height(4.dp))
                Barra(d.aguaMl.toFloat() / d.metas.aguaMl.coerceAtLeast(1), altura = if (alto) 8.dp else 6.dp)
                // Os botões descem para a base e crescem com o widget: o espaço vira área de toque.
                Spacer(GlanceModifier.defaultWeight())
                Row(GlanceModifier.fillMaxWidth()) {
                    listOf(200, 300, 500).forEachIndexed { i, ml ->
                        if (i > 0) Spacer(GlanceModifier.width(6.dp))
                        Pilula("+$ml ml", actionRunCallback<BeberAgua>(actionParametersOf(mlKey to ml)), GlanceModifier.defaultWeight(),
                            principal = ml == 300, vertical = if (alto) 14.dp else 8.dp)
                    }
                }
            }
        }
    }
}


class BeberAgua : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val ml = parameters[mlKey] ?: return
        // Repo.beberAgua pede sync e redesenha os widgets.
        (context.applicationContext as DietaApplication).repo.beberAgua(Datas.hoje(), ml)
    }
}

class AguaWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = AguaWidget()
}
