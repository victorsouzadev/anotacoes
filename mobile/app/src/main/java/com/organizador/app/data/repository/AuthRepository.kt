package com.organizador.app.data.repository

import com.organizador.app.data.local.SettingsStore
import com.organizador.app.data.remote.AuthApi
import kotlinx.coroutines.flow.StateFlow

/** Login/registro/logout contra o backend do hub, e renovação de sessão pro TasksSyncRepository usar. */
class AuthRepository(
    private val authApi: AuthApi,
    private val settingsStore: SettingsStore,
) {
    val isLoggedIn: StateFlow<Boolean> = settingsStore.isLoggedIn
    val accountEmail: StateFlow<String?> = settingsStore.accountEmail

    suspend fun register(email: String, password: String) {
        val session = authApi.register(email, password)
        settingsStore.saveSession(session.accessToken, session.refreshToken, session.email)
    }

    suspend fun login(email: String, password: String) {
        val session = authApi.login(email, password)
        settingsStore.saveSession(session.accessToken, session.refreshToken, session.email)
    }

    suspend fun logout() {
        settingsStore.getRefreshToken()?.let { authApi.logout(it) }
        settingsStore.clearSession()
    }

    fun currentAccessToken(): String? = settingsStore.getAccessToken()

    /**
     * Troca o refresh token atual por um par novo (o backend rotaciona a cada uso). Retorna o
     * novo access token, ou null se a sessão não pôde ser renovada — nesse caso ela já foi limpa
     * localmente, e o usuário precisa logar de novo.
     */
    suspend fun refreshAccessToken(): String? {
        val refreshToken = settingsStore.getRefreshToken() ?: return null
        return try {
            val session = authApi.refresh(refreshToken)
            settingsStore.saveSession(session.accessToken, session.refreshToken, session.email)
            session.accessToken
        } catch (e: Exception) {
            settingsStore.clearSession()
            null
        }
    }
}
