package com.organizador.app.ui.theme

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import android.graphics.Color as AndroidColor

internal data class ThemePalette(
    val background: Color,
    val surface: Color,
    val surfaceVariant: Color,
    val outline: Color,
    val onBackground: Color,
    val onSurfaceSecondary: Color,
    val accent: Color,
)

internal val darkPalette = ThemePalette(
    background = Color(0xFF0E1116),
    surface = Color(0xFF181C23),
    surfaceVariant = Color(0xFF20252E),
    outline = Color(0xFF2A2F3A),
    onBackground = Color(0xFFEDEFF3),
    onSurfaceSecondary = Color(0xFF8A93A3),
    accent = Color(0xFF3ED9C3),
)

internal val lightPalette = ThemePalette(
    background = Color(0xFFF6F7F9),
    surface = Color(0xFFFFFFFF),
    surfaceVariant = Color(0xFFEEF0F3),
    outline = Color(0xFFDCE0E5),
    onBackground = Color(0xFF1A1D24),
    onSurfaceSecondary = Color(0xFF667085),
    accent = Color(0xFF3ED9C3),
)

/** Semantic priority colors stay fixed across themes/accents so they read consistently everywhere. */
val PriorityHigh = Color(0xFFFF6161)
val PriorityMedium = Color(0xFFF2B84B)
val PriorityLow = Color(0xFF6E7BFF)

/**
 * Most screens in this app read [Background]/[Surface]/etc. as plain top-level properties rather
 * than through `MaterialTheme.colorScheme` (a pattern set before multiple themes existed). Rather
 * than rewiring every screen to consume a CompositionLocal, this single piece of Compose state is
 * updated by [OrganizadorTheme] whenever the active theme changes; every composable that reads one
 * of the properties below during composition is automatically recomposed when it does.
 */
private var activePalette by mutableStateOf(darkPalette)

internal fun applyActivePalette(isDark: Boolean, accentHex: String) {
    val base = if (isDark) darkPalette else lightPalette
    val accentColor = runCatching { Color(AndroidColor.parseColor(accentHex)) }.getOrDefault(base.accent)
    val next = base.copy(accent = accentColor)
    if (next != activePalette) activePalette = next
}

/** Same role as the [String]-accent overload above, but for Material You: the palette comes straight from the dynamic color scheme instead of a fixed accent hex. */
internal fun applyActivePalette(palette: ThemePalette) {
    if (palette != activePalette) activePalette = palette
}

val Background: Color get() = activePalette.background
val Surface: Color get() = activePalette.surface
val SurfaceVariant: Color get() = activePalette.surfaceVariant
val Outline: Color get() = activePalette.outline
val OnBackground: Color get() = activePalette.onBackground
val OnSurfaceSecondary: Color get() = activePalette.onSurfaceSecondary
val Accent: Color get() = activePalette.accent
