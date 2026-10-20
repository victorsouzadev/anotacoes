package com.casa.app

import android.content.Context
import android.os.Build
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

/**
 * Envia erros e travamentos do app para o servidor (POST /api/logs).
 * Os registros ficam numa fila local e saem quando houver conexão, então
 * uma falha de rede ou um travamento não se perdem.
 */
object Registro {
    private const val MAX_FILA = 50
    private val escopo = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var app: Context
    private val prefs get() = app.getSharedPreferences("casa_logs", Context.MODE_PRIVATE)

    @Synchronized
    fun iniciar(c: Context) {
        // Chamado pela Activity e pelo alarme; o tratador de travamento só pode ser instalado uma vez.
        if (::app.isInitialized) return enviarPendentes()
        app = c.applicationContext
        val anterior = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { t, e ->
            // O processo vai morrer: grava já (commit síncrono) e manda na próxima abertura.
            enfileirar("erro", "travamento", e, sincrono = true, extra = "thread ${t.name}")
            anterior?.uncaughtException(t, e)
        }
        enviarPendentes()
    }

    fun erro(evento: String, e: Throwable, extra: String? = null) = registrar("erro", evento, e, extra)
    fun aviso(evento: String, e: Throwable, extra: String? = null) = registrar("aviso", evento, e, extra)

    private fun registrar(nivel: String, evento: String, e: Throwable, extra: String?) {
        if (!::app.isInitialized) return
        Log.w("Casa", "$evento: ${e.message}", e)
        enfileirar(nivel, evento, e, sincrono = false, extra = extra)
        enviarPendentes()
    }

    @Synchronized
    private fun enfileirar(nivel: String, evento: String, e: Throwable, sincrono: Boolean, extra: String?) {
        if (!::app.isInitialized) return
        val fila = JSONArray(prefs.getString("fila", "[]"))
        fila.put(JSONObject()
            .put("nivel", nivel).put("evento", evento)
            .put("mensagem", listOfNotNull("${e.javaClass.simpleName}: ${e.message}", extra).joinToString(" — "))
            .put("pilha", e.stackTraceToString().take(6000))
            .put("aparelho", "${Build.MANUFACTURER} ${Build.MODEL}").put("android", Build.VERSION.RELEASE)
            .put("quando", Instant.now().toString()))
        val ultimos = JSONArray().apply { for (i in maxOf(0, fila.length() - MAX_FILA) until fila.length()) put(fila.get(i)) }
        prefs.edit().putString("fila", ultimos.toString()).let { if (sincrono) it.commit() else it.apply() }
    }

    @Synchronized
    private fun retirar(): JSONArray {
        val fila = JSONArray(prefs.getString("fila", "[]"))
        if (fila.length() > 0) prefs.edit().putString("fila", "[]").commit()
        return fila
    }

    fun enviarPendentes() {
        if (!::app.isInitialized) return
        escopo.launch {
            val fila = retirar()
            if (fila.length() == 0) return@launch
            val p = app.getSharedPreferences("casa", Context.MODE_PRIVATE)
            val api = Api(p.getString("servidor", null) ?: BuildConfig.SERVIDOR, p.getString("token", null))
            try {
                for (i in 0 until fila.length() step 20) {
                    val lote = JSONArray().apply { for (j in i until minOf(i + 20, fila.length())) put(fila.get(j)) }
                    api.chamar("POST", "/api/logs", JSONObject().put("logs", lote))
                }
            } catch (e: Exception) {
                // Sem rede: devolve para a fila e tenta de novo na próxima vez.
                synchronized(this@Registro) {
                    val atual = JSONArray(prefs.getString("fila", "[]"))
                    val junto = JSONArray().apply { for (k in 0 until fila.length()) put(fila.get(k)); for (k in 0 until atual.length()) put(atual.get(k)) }
                    val ultimos = JSONArray().apply { for (k in maxOf(0, junto.length() - MAX_FILA) until junto.length()) put(junto.get(k)) }
                    prefs.edit().putString("fila", ultimos.toString()).apply()
                }
            }
        }
    }
}
