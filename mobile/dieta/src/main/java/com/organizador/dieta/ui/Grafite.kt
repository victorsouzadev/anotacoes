package com.organizador.dieta.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.organizador.dieta.R

// Identidade visual Grafite: valores da skill aplicar-grafite (.claude/skills/aplicar-grafite/SKILL.md).

/** Tokens de um tema (dia ou noite). */
data class GrafiteTokens(
    val papel: Color,
    val folha: Color,
    val grafite: Color,
    val grafiteSuave: Color,
    val linha: Color,
    val nanquim: Color,
    val nanquimEscuro: Color,
    val nanquimTinta: Color,
    val sobreNanquim: Color,
    val positivo: Color,
    val negativo: Color,
    val atencao: Color,
    /** Cor da ferramenta Tarefas: só no ponto do símbolo. */
    val tarefas: Color,
)

object GrafiteCores {
    val Dia = GrafiteTokens(
        papel = Color(0xFFF4F5F2), folha = Color(0xFFFFFFFF), grafite = Color(0xFF1E2523), grafiteSuave = Color(0xFF5E6865),
        linha = Color(0xFFDFE3DF), nanquim = Color(0xFF2E5E5A), nanquimEscuro = Color(0xFF224744), nanquimTinta = Color(0xFFE2ECEA),
        sobreNanquim = Color(0xFFFFFFFF), positivo = Color(0xFF2F7D4F), negativo = Color(0xFFB3403A), atencao = Color(0xFF9A5D0C),
        tarefas = Color(0xFF8A5F17),
    )
    val Noite = GrafiteTokens(
        papel = Color(0xFF121514), folha = Color(0xFF1A1E1D), grafite = Color(0xFFE6EAE7), grafiteSuave = Color(0xFF9AA4A0),
        linha = Color(0xFF2A302E), nanquim = Color(0xFF7FB5AE), nanquimEscuro = Color(0xFFA3CDC7), nanquimTinta = Color(0xFF1F3331),
        sobreNanquim = Color(0xFF121514), positivo = Color(0xFF6FCF97), negativo = Color(0xFFF08A84), atencao = Color(0xFFF0B860),
        tarefas = Color(0xFFD6AE62),
    )
}

val LocalGrafite = staticCompositionLocalOf { GrafiteCores.Dia }

/** Tokens do tema atual, para o que o ColorScheme do Material não cobre (estados, linha, nanquim-tinta). */
val grafite: GrafiteTokens
    @Composable @ReadOnlyComposable get() = LocalGrafite.current

@OptIn(ExperimentalTextApi::class)
private fun variavel(id: Int, peso: Int) =
    Font(id, FontWeight(peso), variationSettings = FontVariation.Settings(FontVariation.weight(peso)))

private val Newsreader = FontFamily(variavel(R.font.newsreader, 500))
private val Figtree = FontFamily(variavel(R.font.figtree, 400), variavel(R.font.figtree, 500), variavel(R.font.figtree, 600))
private val PlexMono = FontFamily(Font(R.font.ibm_plex_mono_medium, FontWeight.Medium))

private fun ts(f: FontFamily, peso: Int, tam: Int, linha: Int) =
    TextStyle(fontFamily = f, fontWeight = FontWeight(peso), fontSize = tam.sp, lineHeight = linha.sp)

/** Newsreader só nos títulos grandes; Figtree na interface. */
private val Tipografia = Typography(
    displaySmall = ts(Newsreader, 500, 36, 40),
    headlineLarge = ts(Newsreader, 500, 36, 40),
    headlineMedium = ts(Newsreader, 500, 26, 32),
    // Títulos de diálogo (headlineSmall) e da barra de topo (titleLarge) em Figtree: em Newsreader 26 eles quebravam
    // em duas linhas com a fonte do sistema grande ("Adicionar ao / jantar").
    headlineSmall = ts(Figtree, 600, 18, 24),
    titleLarge = ts(Figtree, 600, 18, 24),
    titleMedium = ts(Figtree, 600, 17, 24),
    titleSmall = ts(Figtree, 600, 17, 24),
    bodyLarge = ts(Figtree, 400, 15, 23),
    bodyMedium = ts(Figtree, 400, 15, 23),
    bodySmall = ts(Figtree, 500, 13, 18),
    labelLarge = ts(Figtree, 500, 13, 18),
    labelMedium = ts(Figtree, 500, 13, 18),
    labelSmall = ts(Figtree, 500, 12, 16).copy(letterSpacing = 0.06.em),
)

/** IBM Plex Mono 500 15/22, para valores, datas e medidas. */
val EstiloValor = ts(PlexMono, 500, 15, 22)

private val Formas = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(6.dp),
    medium = RoundedCornerShape(10.dp),
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(16.dp),
)

/** Segue o modo do sistema, sem cor dinâmica. */
@Composable
fun DietaTema(content: @Composable () -> Unit) {
    val t = if (isSystemInDarkTheme()) GrafiteCores.Noite else GrafiteCores.Dia
    val base = if (t == GrafiteCores.Noite) darkColorScheme() else lightColorScheme()
    val cores = base.copy(
        background = t.papel, onBackground = t.grafite,
        surface = t.folha, onSurface = t.grafite,
        surfaceVariant = t.folha, onSurfaceVariant = t.grafiteSuave,
        surfaceContainer = t.papel, surfaceContainerLow = t.folha, surfaceContainerHigh = t.folha,
        surfaceContainerHighest = t.folha, surfaceContainerLowest = t.folha, surfaceTint = t.folha,
        outline = t.linha, outlineVariant = t.linha,
        primary = t.nanquim, onPrimary = t.sobreNanquim,
        primaryContainer = t.nanquimTinta, onPrimaryContainer = t.grafite,
        secondary = t.nanquim, onSecondary = t.sobreNanquim,
        secondaryContainer = t.nanquimTinta, onSecondaryContainer = t.grafite,
        tertiary = t.nanquim, onTertiary = t.sobreNanquim,
        error = t.negativo, onError = t.sobreNanquim,
    )
    androidx.compose.runtime.CompositionLocalProvider(LocalGrafite provides t) {
        MaterialTheme(colorScheme = cores, typography = Tipografia, shapes = Formas, content = content)
    }
}
