package com.organizador.app.ui.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import com.organizador.app.domain.model.AccentTheme
import com.organizador.app.domain.model.ThemeMode
import android.graphics.Color as AndroidColor

@Composable
fun OrganizadorTheme(
    themeMode: ThemeMode = ThemeMode.DARK,
    accentTheme: AccentTheme = AccentTheme.TEAL,
    useDynamicColor: Boolean = false,
    content: @Composable () -> Unit,
) {
    val isDark = when (themeMode) {
        ThemeMode.SYSTEM -> isSystemInDarkTheme()
        ThemeMode.LIGHT -> false
        ThemeMode.DARK -> true
    }

    val palette = if (isDark) darkPalette else lightPalette
    val dynamicColorAvailable = useDynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S

    val colorScheme: ColorScheme
    if (dynamicColorAvailable) {
        val context = LocalContext.current
        colorScheme = if (isDark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        // Keeps the plain top-level color properties (Background, Surface, ...) that most screens
        // already read in sync with the resolved theme; see the comment on activePalette in Color.kt.
        SideEffect {
            applyActivePalette(
                ThemePalette(
                    background = colorScheme.background,
                    surface = colorScheme.surface,
                    surfaceVariant = colorScheme.surfaceVariant,
                    outline = colorScheme.outline,
                    onBackground = colorScheme.onBackground,
                    onSurfaceSecondary = colorScheme.onSurfaceVariant,
                    accent = colorScheme.primary,
                ),
            )
        }
    } else {
        SideEffect { applyActivePalette(isDark, accentTheme.colorHex) }
        val accentColor = runCatching { Color(AndroidColor.parseColor(accentTheme.colorHex)) }.getOrDefault(palette.accent)
        colorScheme = if (isDark) {
            darkColorScheme(
                primary = accentColor,
                onPrimary = palette.background,
                secondary = accentColor,
                onSecondary = palette.background,
                background = palette.background,
                onBackground = palette.onBackground,
                surface = palette.surface,
                onSurface = palette.onBackground,
                surfaceVariant = palette.surfaceVariant,
                onSurfaceVariant = palette.onSurfaceSecondary,
                outline = palette.outline,
                error = PriorityHigh,
                onError = palette.background,
            )
        } else {
            lightColorScheme(
                primary = accentColor,
                onPrimary = palette.surface,
                secondary = accentColor,
                onSecondary = palette.surface,
                background = palette.background,
                onBackground = palette.onBackground,
                surface = palette.surface,
                onSurface = palette.onBackground,
                surfaceVariant = palette.surfaceVariant,
                onSurfaceVariant = palette.onSurfaceSecondary,
                outline = palette.outline,
                error = PriorityHigh,
                onError = palette.surface,
            )
        }
    }

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as? Activity)?.window ?: return@SideEffect
            val insetsController = WindowCompat.getInsetsController(window, view)
            insetsController.isAppearanceLightStatusBars = !isDark
            insetsController.isAppearanceLightNavigationBars = !isDark
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = AppTypography,
        content = content,
    )
}
