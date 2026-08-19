package com.organizador.app.domain.model

enum class ThemeMode {
    SYSTEM,
    LIGHT,
    DARK,
}

enum class AccentTheme(val colorHex: String) {
    TEAL("#3ED9C3"),
    BLUE("#5B8DEF"),
    VIOLET("#B389F9"),
    CORAL("#FF8066"),
    GREEN("#4CD97B"),
}
