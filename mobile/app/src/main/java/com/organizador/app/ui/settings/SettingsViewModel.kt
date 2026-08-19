package com.organizador.app.ui.settings

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.organizador.app.data.backup.BackupRepository
import com.organizador.app.data.local.SettingsStore
import com.organizador.app.data.repository.AuthRepository
import com.organizador.app.data.sync.TasksSyncRepository
import com.organizador.app.domain.model.AccentTheme
import com.organizador.app.domain.model.ThemeMode
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class AuthMode { LOGIN, REGISTER }

data class SettingsUiState(
    val apiKeyInput: String = "",
    val hasApiKey: Boolean = false,
    val modelInput: String = "",
    val isExporting: Boolean = false,
    val isImporting: Boolean = false,
    val backupMessage: String? = null,
    val backupError: Boolean = false,
    val serverUrlInput: String = "",
    val authMode: AuthMode = AuthMode.LOGIN,
    val emailInput: String = "",
    val passwordInput: String = "",
    val authLoading: Boolean = false,
    val authError: String? = null,
    val isSyncing: Boolean = false,
    val syncMessage: String? = null,
    val syncError: Boolean = false,
)

class SettingsViewModel(
    private val settingsStore: SettingsStore,
    private val backupRepository: BackupRepository,
    private val authRepository: AuthRepository,
    private val tasksSyncRepository: TasksSyncRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(
        SettingsUiState(
            hasApiKey = settingsStore.getApiKey() != null,
            modelInput = settingsStore.getModel(),
            serverUrlInput = settingsStore.getServerBaseUrl(),
        ),
    )
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    val isLoggedIn: StateFlow<Boolean> = authRepository.isLoggedIn
    val accountEmail: StateFlow<String?> = authRepository.accountEmail
    val lastSyncedAt: StateFlow<Long?> = settingsStore.lastSyncedAt

    val themeMode: StateFlow<ThemeMode> = settingsStore.themeMode
    val accentTheme: StateFlow<AccentTheme> = settingsStore.accentTheme
    val useDynamicColor: StateFlow<Boolean> = settingsStore.useDynamicColor
    val calendarSyncEnabled: StateFlow<Boolean> = settingsStore.calendarSyncEnabled
    val selectedCalendarId: StateFlow<Long?> = settingsStore.selectedCalendarId
    val visibleCalendarIds: StateFlow<Set<Long>?> = settingsStore.visibleCalendarIds

    fun onThemeModeSelected(mode: ThemeMode) = settingsStore.setThemeMode(mode)

    fun onAccentThemeSelected(accent: AccentTheme) = settingsStore.setAccentTheme(accent)

    fun onUseDynamicColorToggled(enabled: Boolean) = settingsStore.setUseDynamicColor(enabled)

    fun onCalendarSyncToggled(enabled: Boolean) = settingsStore.setCalendarSyncEnabled(enabled)

    fun onCalendarSelected(calendarId: Long) = settingsStore.setSelectedCalendarId(calendarId)

    fun onVisibleCalendarsChanged(calendarIds: Set<Long>) = settingsStore.setVisibleCalendarIds(calendarIds)

    fun onShowAllCalendars() = settingsStore.setVisibleCalendarIds(null)

    fun onApiKeyInputChanged(value: String) {
        _uiState.update { it.copy(apiKeyInput = value) }
    }

    fun onSaveApiKey() {
        val value = _uiState.value.apiKeyInput.trim()
        if (value.isBlank()) return
        settingsStore.setApiKey(value)
        _uiState.update { it.copy(apiKeyInput = "", hasApiKey = true) }
    }

    fun onClearApiKey() {
        settingsStore.clearApiKey()
        _uiState.update { it.copy(apiKeyInput = "", hasApiKey = false) }
    }

    fun onModelInputChanged(value: String) {
        _uiState.update { it.copy(modelInput = value) }
    }

    fun onSaveModel() {
        val resolved = _uiState.value.modelInput.trim().ifBlank { SettingsStore.DEFAULT_MODEL }
        settingsStore.setModel(resolved)
        _uiState.update { it.copy(modelInput = resolved) }
    }

    fun onPickSuggestedModel(model: String) {
        settingsStore.setModel(model)
        _uiState.update { it.copy(modelInput = model) }
    }

    fun onExportTo(uri: Uri) {
        _uiState.update { it.copy(isExporting = true, backupMessage = null) }
        viewModelScope.launch {
            val result = backupRepository.exportToUri(uri)
            _uiState.update {
                it.copy(
                    isExporting = false,
                    backupMessage = if (result.isSuccess) EXPORT_SUCCESS else result.exceptionOrNull()?.message,
                    backupError = result.isFailure,
                )
            }
        }
    }

    fun onImportFrom(uri: Uri) {
        _uiState.update { it.copy(isImporting = true, backupMessage = null) }
        viewModelScope.launch {
            val result = backupRepository.importFromUri(uri)
            _uiState.update {
                it.copy(
                    isImporting = false,
                    backupMessage = if (result.isSuccess) IMPORT_SUCCESS else result.exceptionOrNull()?.message,
                    backupError = result.isFailure,
                )
            }
        }
    }

    fun onServerUrlChanged(value: String) {
        _uiState.update { it.copy(serverUrlInput = value) }
    }

    fun onSaveServerUrl() {
        val value = _uiState.value.serverUrlInput.trim()
        if (value.isBlank()) return
        settingsStore.setServerBaseUrl(value)
        _uiState.update { it.copy(serverUrlInput = settingsStore.getServerBaseUrl()) }
    }

    fun onAuthModeToggled() {
        _uiState.update {
            it.copy(authMode = if (it.authMode == AuthMode.LOGIN) AuthMode.REGISTER else AuthMode.LOGIN, authError = null)
        }
    }

    fun onEmailChanged(value: String) {
        _uiState.update { it.copy(emailInput = value, authError = null) }
    }

    fun onPasswordChanged(value: String) {
        _uiState.update { it.copy(passwordInput = value, authError = null) }
    }

    fun onSubmitAuth() {
        val state = _uiState.value
        val email = state.emailInput.trim()
        val password = state.passwordInput
        if (email.isBlank() || password.isBlank() || state.authLoading) return

        onSaveServerUrl()
        _uiState.update { it.copy(authLoading = true, authError = null) }
        viewModelScope.launch {
            val result = runCatching {
                if (state.authMode == AuthMode.LOGIN) authRepository.login(email, password) else authRepository.register(email, password)
            }
            _uiState.update {
                it.copy(
                    authLoading = false,
                    authError = result.exceptionOrNull()?.message,
                    emailInput = if (result.isSuccess) "" else it.emailInput,
                    passwordInput = if (result.isSuccess) "" else it.passwordInput,
                )
            }
            if (result.isSuccess) onSyncNow()
        }
    }

    fun onLogout() {
        viewModelScope.launch { authRepository.logout() }
    }

    fun onSyncNow() {
        if (_uiState.value.isSyncing) return
        _uiState.update { it.copy(isSyncing = true, syncMessage = null) }
        viewModelScope.launch {
            val result = tasksSyncRepository.sync()
            if (result.isSuccess) settingsStore.setLastSyncedAt(System.currentTimeMillis())
            _uiState.update {
                it.copy(
                    isSyncing = false,
                    syncMessage = if (result.isSuccess) SYNC_SUCCESS else result.exceptionOrNull()?.message ?: "Falha ao sincronizar.",
                    syncError = result.isFailure,
                )
            }
        }
    }

    private companion object {
        const val EXPORT_SUCCESS = "__export_success__"
        const val IMPORT_SUCCESS = "__import_success__"
        const val SYNC_SUCCESS = "__sync_success__"
    }
}
