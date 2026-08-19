package com.organizador.app.ui.common

import androidx.compose.ui.graphics.Color
import com.organizador.app.ui.theme.Accent
import android.graphics.Color as AndroidColor

fun parseColorHexOrDefault(hex: String, default: Color = Accent): Color =
    runCatching { Color(AndroidColor.parseColor(hex)) }.getOrDefault(default)
