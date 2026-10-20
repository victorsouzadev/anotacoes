package com.casa.app

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/**
 * Identidade visual Grafite (skill aplicar-grafite). Um acento só, o nanquim; o resto é
 * papel/folha/grafite. Segue o modo do sistema (dia/noite).
 */
@Immutable
data class GrafiteCores(
    val papel: Color, val folha: Color, val grafite: Color, val grafiteSuave: Color, val linha: Color,
    val nanquim: Color, val nanquimEscuro: Color, val nanquimTinta: Color, val sobreNanquim: Color,
    val positivo: Color, val negativo: Color, val atencao: Color,
    // Cores de ferramenta: só ícone/marcador, nunca botão ou fundo grande.
    val notas: Color, val financas: Color, val tarefas: Color, val editor: Color, val cerebro: Color,
) {
    companion object {
        val Dia = GrafiteCores(
            papel = Color(0xFFF4F5F2), folha = Color(0xFFFFFFFF), grafite = Color(0xFF1E2523),
            grafiteSuave = Color(0xFF5E6865), linha = Color(0xFFDFE3DF),
            nanquim = Color(0xFF2E5E5A), nanquimEscuro = Color(0xFF224744), nanquimTinta = Color(0xFFE2ECEA),
            sobreNanquim = Color(0xFFFFFFFF),
            positivo = Color(0xFF2F7D4F), negativo = Color(0xFFB3403A), atencao = Color(0xFF9A5D0C),
            notas = Color(0xFF3D5A80), financas = Color(0xFF4F6B3A), tarefas = Color(0xFF8A5F17),
            editor = Color(0xFF9A4E4E), cerebro = Color(0xFF6A5A8C),
        )
        val Noite = GrafiteCores(
            papel = Color(0xFF121514), folha = Color(0xFF1A1E1D), grafite = Color(0xFFE6EAE7),
            grafiteSuave = Color(0xFF9AA4A0), linha = Color(0xFF2A302E),
            nanquim = Color(0xFF7FB5AE), nanquimEscuro = Color(0xFFA3CDC7), nanquimTinta = Color(0xFF1F3331),
            sobreNanquim = Color(0xFF121514),
            positivo = Color(0xFF6FCF97), negativo = Color(0xFFF08A84), atencao = Color(0xFFF0B860),
            notas = Color(0xFF8FAAD0), financas = Color(0xFF9DBF83), tarefas = Color(0xFFD6AE62),
            editor = Color(0xFFD99A9A), cerebro = Color(0xFFAD9FD6),
        )
    }
}

val LocalGrafite = staticCompositionLocalOf { GrafiteCores.Dia }

/** Atalho: `grafite.nanquim`, `grafite.linha`… dentro de qualquer composable. */
val grafite: GrafiteCores @Composable get() = LocalGrafite.current

// Mapeamento da skill para o Material 3. Os papéis que a skill não cita apontam para o token
// neutro equivalente, para nenhum componente puxar a paleta padrão (roxa) do Material.
private fun esquema(c: GrafiteCores, escuro: Boolean): ColorScheme {
    val base = if (escuro) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = c.nanquim, onPrimary = c.sobreNanquim,
        primaryContainer = c.nanquimTinta, onPrimaryContainer = c.grafite,
        inversePrimary = c.nanquimEscuro,
        secondary = c.grafiteSuave, onSecondary = c.folha,
        secondaryContainer = c.nanquimTinta, onSecondaryContainer = c.grafite,
        tertiary = c.grafiteSuave, onTertiary = c.folha,
        tertiaryContainer = c.nanquimTinta, onTertiaryContainer = c.grafite,
        background = c.papel, onBackground = c.grafite,
        surface = c.folha, onSurface = c.grafite,
        surfaceVariant = c.papel, onSurfaceVariant = c.grafiteSuave,
        surfaceTint = c.folha, // sem tom de nanquim na elevação
        surfaceBright = c.folha, surfaceDim = c.papel,
        surfaceContainerLowest = c.folha, surfaceContainerLow = c.folha, surfaceContainer = c.folha,
        surfaceContainerHigh = c.folha, surfaceContainerHighest = c.folha,
        inverseSurface = c.grafite, inverseOnSurface = c.papel,
        outline = c.linha, outlineVariant = c.linha,
        // errorContainer não pode repetir a cor de surface: o Material escolhe o texto de um fundo pela
        // primeira cor que bate (contentColorFor), e o cartão em folha sairia com texto negativo.
        error = c.negativo, onError = c.folha, errorContainer = c.papel, onErrorContainer = c.negativo,
    )
}

private val Newsreader = FontFamily(Font(R.font.newsreader_medium, FontWeight.Medium))
private val Figtree = FontFamily(
    Font(R.font.figtree_regular, FontWeight.Normal),
    Font(R.font.figtree_medium, FontWeight.Medium),
    Font(R.font.figtree_semibold, FontWeight.SemiBold),
)
private val PlexMono = FontFamily(Font(R.font.ibmplexmono_medium, FontWeight.Medium))

private val tituloGrande = TextStyle(fontFamily = Newsreader, fontWeight = FontWeight.Medium, fontSize = 36.sp, lineHeight = 40.sp)
private val tituloMedio = TextStyle(fontFamily = Newsreader, fontWeight = FontWeight.Medium, fontSize = 26.sp, lineHeight = 32.sp)
private val tituloCartao = TextStyle(fontFamily = Figtree, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, lineHeight = 24.sp)
private val corpo = TextStyle(fontFamily = Figtree, fontWeight = FontWeight.Normal, fontSize = 15.sp, lineHeight = 23.sp)
private val rotulo = TextStyle(fontFamily = Figtree, fontWeight = FontWeight.Medium, fontSize = 13.sp, lineHeight = 18.sp)
// Legenda: escrever o texto em caixa alta (.uppercase()) ao usar.
private val legenda = TextStyle(fontFamily = Figtree, fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 16.sp, letterSpacing = 0.06.em)

/** Valores, datas e medidas (pontos, código de convite). */
val EstiloValor = TextStyle(fontFamily = PlexMono, fontWeight = FontWeight.Medium, fontSize = 15.sp, lineHeight = 22.sp)

private val Tipos = Typography(
    displayLarge = tituloGrande, displayMedium = tituloGrande, displaySmall = tituloGrande,
    headlineLarge = tituloGrande, headlineMedium = tituloMedio, headlineSmall = tituloMedio,
    titleLarge = tituloMedio, titleMedium = tituloCartao, titleSmall = tituloCartao,
    bodyLarge = corpo, bodyMedium = corpo, bodySmall = rotulo,
    labelLarge = rotulo, labelMedium = rotulo, labelSmall = legenda,
)

/** Raios: 6 chips/checkbox, 10 botões/campos/cartões, 16 modais/blocos. */
val RaioBotao = RoundedCornerShape(10.dp)
private val Formas = Shapes(
    extraSmall = RoundedCornerShape(10.dp), // campos de texto
    small = RoundedCornerShape(6.dp),       // chips
    medium = RoundedCornerShape(10.dp),     // cartões
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(16.dp), // modais
)

@Composable
fun TemaGrafite(escuro: Boolean = isSystemInDarkTheme(), conteudo: @Composable () -> Unit) {
    val c = if (escuro) GrafiteCores.Noite else GrafiteCores.Dia
    CompositionLocalProvider(LocalGrafite provides c) {
        MaterialTheme(colorScheme = esquema(c, escuro), typography = Tipos, shapes = Formas, content = conteudo)
    }
}
