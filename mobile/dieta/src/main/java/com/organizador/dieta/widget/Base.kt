package com.organizador.dieta.widget

import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceModifier
import androidx.glance.action.Action
import androidx.glance.action.clickable
import androidx.glance.appwidget.LinearProgressIndicator
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.cornerRadius
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.ColumnScope
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.text.FontFamily
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider

// Peças comuns dos widgets, no visual Grafite: folha com borda de linha, títulos serifados, valores em mono.

@Composable
fun Folha(acao: Action? = null, conteudo: @Composable ColumnScope.() -> Unit) {
    // A borda de 1 px é o fundo "linha" com a folha 1 dp para dentro (Glance não tem border).
    Box(GlanceModifier.fillMaxSize().appWidgetBackground().cornerRadius(14.dp).background(CoresWidget.linha).padding(1.dp)) {
        var m = GlanceModifier.fillMaxSize().cornerRadius(13.dp).background(CoresWidget.folha).padding(horizontal = 12.dp, vertical = 10.dp)
        if (acao != null) m = m.clickable(acao)
        Column(m, content = conteudo)
    }
}

@Composable
fun Rotulo(texto: String, modifier: GlanceModifier = GlanceModifier, cor: ColorProvider = CoresWidget.grafiteSuave, tamanho: TextUnit = 12.sp) =
    Text(texto, modifier, style = TextStyle(color = cor, fontSize = tamanho), maxLines = 1)

@Composable
fun Titulo(texto: String, modifier: GlanceModifier = GlanceModifier, tamanho: TextUnit = 15.sp) =
    Text(texto, modifier, style = TextStyle(color = CoresWidget.grafite, fontSize = tamanho, fontWeight = FontWeight.Medium), maxLines = 1)

/** Número grande em serifa (como os títulos Newsreader do app). */
@Composable
fun Numero(texto: String, cor: ColorProvider = CoresWidget.grafite, tamanho: TextUnit = 26.sp) =
    Text(texto, style = TextStyle(color = cor, fontSize = tamanho, fontFamily = FontFamily.Serif), maxLines = 1)

/** Valor em mono (como o IBM Plex Mono do app). */
@Composable
fun Valor(texto: String, modifier: GlanceModifier = GlanceModifier, cor: ColorProvider = CoresWidget.grafite, tamanho: TextUnit = 12.sp) =
    Text(texto, modifier, style = TextStyle(color = cor, fontSize = tamanho, fontFamily = FontFamily.Monospace), maxLines = 1)

@Composable
fun Barra(fracao: Float, destaque: Boolean = true, altura: Dp = 6.dp) = LinearProgressIndicator(
    progress = fracao.coerceIn(0f, 1f),
    modifier = GlanceModifier.fillMaxWidth().height(altura).cornerRadius(3.dp),
    color = if (fracao > 1.1f) CoresWidget.atencao else if (destaque) CoresWidget.grafite else CoresWidget.grafiteSuave,
    backgroundColor = CoresWidget.linha,
)

/** Botão em pílula. [principal] = nanquim (a ação única do widget); os outros em tinta clara. */
@Composable
fun Pilula(texto: String, acao: Action, modifier: GlanceModifier = GlanceModifier, principal: Boolean = false) {
    Box(
        modifier.cornerRadius(16.dp).background(if (principal) CoresWidget.nanquim else CoresWidget.nanquimTinta)
            .clickable(acao).padding(horizontal = 10.dp, vertical = 7.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(texto, style = TextStyle(color = if (principal) CoresWidget.sobreNanquim else CoresWidget.grafite, fontSize = 13.sp,
            fontWeight = FontWeight.Medium), maxLines = 1)
    }
}

fun fmtMl(ml: Int): String = if (ml >= 1000) "%.1f L".format(java.util.Locale("pt", "BR"), ml / 1000.0) else "$ml ml"
