package com.organizador.app.data.local

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.organizador.app.domain.model.AccentTheme
import com.organizador.app.domain.model.ThemeMode
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Local-only, encrypted-at-rest storage for the user's OpenRouter API key, chosen model and display preferences. Never leaves the device except in the direct HTTPS call to OpenRouter. */
class SettingsStore(context: Context) {

    private val prefs = EncryptedSharedPreferences.create(
        context.applicationContext,
        PREFS_FILE_NAME,
        MasterKey.Builder(context.applicationContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun getApiKey(): String? = prefs.getString(KEY_OPENROUTER_API_KEY, null)?.takeIf { it.isNotBlank() }

    fun setApiKey(apiKey: String) {
        prefs.edit().putString(KEY_OPENROUTER_API_KEY, apiKey.trim()).apply()
    }

    fun clearApiKey() {
        prefs.edit().remove(KEY_OPENROUTER_API_KEY).apply()
    }

    fun getModel(): String = prefs.getString(KEY_OPENROUTER_MODEL, null)?.takeIf { it.isNotBlank() } ?: DEFAULT_MODEL

    fun setModel(model: String) {
        prefs.edit().putString(KEY_OPENROUTER_MODEL, model.trim()).apply()
    }

    // Exposed as StateFlow (rather than plain getters, like the fields above) because the active
    // theme must be observed live by the Compose tree at the app root, not just read once.
    private val _themeMode = MutableStateFlow(readThemeMode())
    val themeMode: StateFlow<ThemeMode> = _themeMode.asStateFlow()

    private val _accentTheme = MutableStateFlow(readAccentTheme())
    val accentTheme: StateFlow<AccentTheme> = _accentTheme.asStateFlow()

    fun setThemeMode(mode: ThemeMode) {
        prefs.edit().putString(KEY_THEME_MODE, mode.name).apply()
        _themeMode.value = mode
    }

    fun setAccentTheme(accent: AccentTheme) {
        prefs.edit().putString(KEY_ACCENT_THEME, accent.name).apply()
        _accentTheme.value = accent
    }

    private fun readThemeMode(): ThemeMode =
        prefs.getString(KEY_THEME_MODE, null)?.let { name -> runCatching { ThemeMode.valueOf(name) }.getOrNull() }
            ?: ThemeMode.DARK

    private fun readAccentTheme(): AccentTheme =
        prefs.getString(KEY_ACCENT_THEME, null)?.let { name -> runCatching { AccentTheme.valueOf(name) }.getOrNull() }
            ?: AccentTheme.TEAL

    // Only meaningful on Android 12+ (dynamicDarkColorScheme/dynamicLightColorScheme require it);
    // the setting can still be persisted on older versions, it's just ignored by Theme.kt.
    private val _useDynamicColor = MutableStateFlow(prefs.getBoolean(KEY_USE_DYNAMIC_COLOR, false))
    val useDynamicColor: StateFlow<Boolean> = _useDynamicColor.asStateFlow()

    fun setUseDynamicColor(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_USE_DYNAMIC_COLOR, enabled).apply()
        _useDynamicColor.value = enabled
    }

    // Same StateFlow reasoning as theme above: TodayViewModel needs to react live to the toggle
    // (e.g. right after the user grants calendar permission and flips it on in Settings).
    private val _calendarSyncEnabled = MutableStateFlow(prefs.getBoolean(KEY_CALENDAR_SYNC_ENABLED, false))
    val calendarSyncEnabled: StateFlow<Boolean> = _calendarSyncEnabled.asStateFlow()

    private val _selectedCalendarId = MutableStateFlow(
        prefs.getLong(KEY_SELECTED_CALENDAR_ID, -1L).takeIf { it >= 0 },
    )
    val selectedCalendarId: StateFlow<Long?> = _selectedCalendarId.asStateFlow()

    fun setCalendarSyncEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_CALENDAR_SYNC_ENABLED, enabled).apply()
        _calendarSyncEnabled.value = enabled
    }

    fun setSelectedCalendarId(calendarId: Long?) {
        prefs.edit().apply {
            if (calendarId != null) putLong(KEY_SELECTED_CALENDAR_ID, calendarId) else remove(KEY_SELECTED_CALENDAR_ID)
        }.apply()
        _selectedCalendarId.value = calendarId
    }

    // null = no filter set yet, show every calendar's events (the default); a set (even empty) means
    // the user picked an explicit subset of calendars to show on the Today screen.
    private val _visibleCalendarIds = MutableStateFlow(readVisibleCalendarIds())
    val visibleCalendarIds: StateFlow<Set<Long>?> = _visibleCalendarIds.asStateFlow()

    fun setVisibleCalendarIds(calendarIds: Set<Long>?) {
        prefs.edit().apply {
            if (calendarIds != null) putString(KEY_VISIBLE_CALENDAR_IDS, calendarIds.joinToString(",")) else remove(KEY_VISIBLE_CALENDAR_IDS)
        }.apply()
        _visibleCalendarIds.value = calendarIds
    }

    private fun readVisibleCalendarIds(): Set<Long>? {
        val raw = prefs.getString(KEY_VISIBLE_CALENDAR_IDS, null) ?: return null
        return raw.split(",").mapNotNull { it.toLongOrNull() }.toSet()
    }

    // --- Conta e sincronização com o hub (ferramenta "Tarefas" da versão web) ---
    // JWT igual ao usado pelo frontend web: access token de curta duração + refresh token
    // rotativo. Guardados aqui (mesmo storage criptografado do resto) em vez de num arquivo
    // separado, pra não duplicar a config de EncryptedSharedPreferences.

    fun getServerBaseUrl(): String =
        prefs.getString(KEY_SERVER_BASE_URL, null)?.takeIf { it.isNotBlank() } ?: DEFAULT_SERVER_BASE_URL

    fun setServerBaseUrl(url: String) {
        prefs.edit().putString(KEY_SERVER_BASE_URL, url.trim().trimEnd('/')).apply()
    }

    fun getAccessToken(): String? = prefs.getString(KEY_ACCESS_TOKEN, null)

    fun getRefreshToken(): String? = prefs.getString(KEY_REFRESH_TOKEN, null)

    private val _accountEmail = MutableStateFlow(prefs.getString(KEY_ACCOUNT_EMAIL, null))
    val accountEmail: StateFlow<String?> = _accountEmail.asStateFlow()

    private val _isLoggedIn = MutableStateFlow(getAccessToken() != null)
    val isLoggedIn: StateFlow<Boolean> = _isLoggedIn.asStateFlow()

    fun saveSession(accessToken: String, refreshToken: String, email: String) {
        prefs.edit()
            .putString(KEY_ACCESS_TOKEN, accessToken)
            .putString(KEY_REFRESH_TOKEN, refreshToken)
            .putString(KEY_ACCOUNT_EMAIL, email)
            .apply()
        _accountEmail.value = email
        _isLoggedIn.value = true
    }

    fun clearSession() {
        prefs.edit().remove(KEY_ACCESS_TOKEN).remove(KEY_REFRESH_TOKEN).remove(KEY_ACCOUNT_EMAIL).apply()
        _accountEmail.value = null
        _isLoggedIn.value = false
    }

    private val _lastSyncedAt = MutableStateFlow(prefs.getLong(KEY_LAST_SYNCED_AT, -1L).takeIf { it >= 0 })
    val lastSyncedAt: StateFlow<Long?> = _lastSyncedAt.asStateFlow()

    fun setLastSyncedAt(millis: Long) {
        prefs.edit().putLong(KEY_LAST_SYNCED_AT, millis).apply()
        _lastSyncedAt.value = millis
    }

    companion object {
        const val DEFAULT_MODEL = "anthropic/claude-haiku-4.5"

        // Mesma URL pública do hub documentada em DEPLOY.md — funciona pronto pra quem só quer
        // logar; pode ser trocado em Configurações (ex.: pra apontar pra um backend local em dev).
        const val DEFAULT_SERVER_BASE_URL = "http://191.252.177.244:8090"

        private const val PREFS_FILE_NAME = "organizador_secure_prefs"
        private const val KEY_OPENROUTER_API_KEY = "openrouter_api_key"
        private const val KEY_OPENROUTER_MODEL = "openrouter_model"
        private const val KEY_THEME_MODE = "theme_mode"
        private const val KEY_ACCENT_THEME = "accent_theme"
        private const val KEY_USE_DYNAMIC_COLOR = "use_dynamic_color"
        private const val KEY_CALENDAR_SYNC_ENABLED = "calendar_sync_enabled"
        private const val KEY_SELECTED_CALENDAR_ID = "selected_calendar_id"
        private const val KEY_VISIBLE_CALENDAR_IDS = "visible_calendar_ids"
        private const val KEY_SERVER_BASE_URL = "sync_server_base_url"
        private const val KEY_ACCESS_TOKEN = "sync_access_token"
        private const val KEY_REFRESH_TOKEN = "sync_refresh_token"
        private const val KEY_ACCOUNT_EMAIL = "sync_account_email"
        private const val KEY_LAST_SYNCED_AT = "sync_last_synced_at"
    }
}
