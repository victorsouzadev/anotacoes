package com.organizador.dieta.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject

/** Perfil para as metas. Meta zerada = usar a sugestão (mesma regra do backend). */
data class Perfil(
    val alturaCm: Double = 0.0,
    val nascimento: String? = null,
    val sexo: String = "M",
    val atividade: Double = 1.375,
    val objetivo: String = "manter",
    val metaKcal: Int = 0,
    val metaProteinaG: Int = 0,
    val metaCarboG: Int = 0,
    val metaGorduraG: Int = 0,
    val metaAguaMl: Int = 0,
    val updatedAt: Long = 0,
) {
    fun json(): JSONObject = JSONObject()
        .put("alturaCm", alturaCm).put("nascimento", nascimento ?: JSONObject.NULL).put("sexo", sexo)
        .put("atividade", atividade).put("objetivo", objetivo).put("metaKcal", metaKcal)
        .put("metaProteinaG", metaProteinaG).put("metaCarboG", metaCarboG).put("metaGorduraG", metaGorduraG)
        .put("metaAguaMl", metaAguaMl).put("updatedAt", Datas.iso(updatedAt))

    companion object {
        fun de(j: JSONObject) = Perfil(
            alturaCm = j.optDouble("alturaCm", 0.0),
            nascimento = j.optStringOrNull("nascimento"),
            sexo = j.optString("sexo", "M"),
            atividade = j.optDouble("atividade", 1.375),
            objetivo = j.optString("objetivo", "manter"),
            metaKcal = j.optInt("metaKcal"),
            metaProteinaG = j.optInt("metaProteinaG"),
            metaCarboG = j.optInt("metaCarboG"),
            metaGorduraG = j.optInt("metaGorduraG"),
            metaAguaMl = j.optInt("metaAguaMl"),
            updatedAt = j.optStringOrNull("updatedAt")?.let(Datas::epoch) ?: 0,
        )
    }
}

/** Sessão do hub, endereço do servidor, perfil, cache do progresso e marcas do sync. Criptografado no aparelho. */
class Prefs(context: Context) {
    private val prefs = EncryptedSharedPreferences.create(
        context.applicationContext,
        "dieta_prefs",
        MasterKey.Builder(context.applicationContext).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    var servidor: String
        get() = prefs.getString("servidor", null)?.takeIf { it.isNotBlank() } ?: SERVIDOR_PADRAO
        set(v) = prefs.edit().putString("servidor", v.trim().trimEnd('/')).apply()

    private val _email = MutableStateFlow(prefs.getString("email", null))
    val email: StateFlow<String?> = _email.asStateFlow()

    val accessToken: String? get() = prefs.getString("access", null)
    val refreshToken: String? get() = prefs.getString("refresh", null)

    fun salvarSessao(access: String, refresh: String, email: String) {
        prefs.edit().putString("access", access).putString("refresh", refresh).putString("email", email).apply()
        _email.value = email
    }

    fun limparSessao() {
        prefs.edit().remove("access").remove("refresh").remove("email").apply()
        _email.value = null
    }

    private val _perfil = MutableStateFlow(prefs.getString("perfil", null)?.let { Perfil.de(JSONObject(it)) } ?: Perfil())
    val perfil: StateFlow<Perfil> = _perfil.asStateFlow()
    var perfilSujo: Boolean
        get() = prefs.getBoolean("perfil_sujo", false)
        set(v) = prefs.edit().putBoolean("perfil_sujo", v).apply()

    fun salvarPerfil(p: Perfil, sujo: Boolean) {
        prefs.edit().putString("perfil", p.json().toString()).putBoolean("perfil_sujo", sujo).apply()
        _perfil.value = p
    }

    /** Último /api/dieta/progresso recebido (JSON), para a tela funcionar offline. */
    private val _progresso = MutableStateFlow(prefs.getString("progresso", null))
    val progresso: StateFlow<String?> = _progresso.asStateFlow()
    fun salvarProgresso(json: String) {
        prefs.edit().putString("progresso", json).apply()
        _progresso.value = json
    }

    /** Conquistas já vistas, para avisar só das novas. */
    var conquistasVistas: Set<String>
        get() = prefs.getStringSet("conquistas_vistas", emptySet()) ?: emptySet()
        set(v) = prefs.edit().putStringSet("conquistas_vistas", v).apply()
    var nivelVisto: Int
        get() = prefs.getInt("nivel_visto", 0)
        set(v) = prefs.edit().putInt("nivel_visto", v).apply()

    /** Maior updatedAt já recebido por coleção (ISO), usado no ?desde= do próximo sync. */
    fun marca(colecao: String): String? = prefs.getString("marca_$colecao", null)
    fun salvarMarca(colecao: String, iso: String) = prefs.edit().putString("marca_$colecao", iso).apply()
    fun limparMarcas() = prefs.edit().apply { prefs.all.keys.filter { it.startsWith("marca_") }.forEach(::remove) }.apply()

    private val _ultimoSync = MutableStateFlow(prefs.getLong("ultimo_sync", 0))
    val ultimoSync: StateFlow<Long> = _ultimoSync.asStateFlow()
    fun marcarSync() {
        val agora = System.currentTimeMillis()
        prefs.edit().putLong("ultimo_sync", agora).apply()
        _ultimoSync.value = agora
    }

    /** Conversa do chat da Dieta (JSON [{papel, texto}]): fica só no aparelho, como o chat das Finanças no navegador. */
    var chat: String?
        get() = prefs.getString("chat", null)
        set(v) = prefs.edit().putString("chat", v).apply()

    var lembretesAtivos: Boolean
        get() = prefs.getBoolean("lembretes", true)
        set(v) = prefs.edit().putBoolean("lembretes", v).apply()

    companion object {
        const val SERVIDOR_PADRAO = "https://cerebro.vsitefy.com.br"
    }
}

fun JSONObject.optStringOrNull(nome: String): String? = if (isNull(nome) || !has(nome)) null else optString(nome)
