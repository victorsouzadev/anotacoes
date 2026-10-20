package com.casa.app

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.runBlocking
import java.util.Calendar

/**
 * Lembretes locais: de manhã, as tarefas do dia; à noite, o que ainda está pendente.
 * O alarme busca o estado no servidor na hora de disparar, então reflete trocas feitas no dia.
 */
object Lembretes {
    const val CANAL = "lembretes"
    private const val MANHA = 1
    private const val NOITE = 2

    private fun prefs(c: Context) = c.getSharedPreferences("casa", Context.MODE_PRIVATE)
    fun ativo(c: Context) = prefs(c).getBoolean("lembretes", true)
    fun horaManha(c: Context) = prefs(c).getInt("hora_manha", 8)
    fun horaNoite(c: Context) = prefs(c).getInt("hora_noite", 20)

    fun configurar(c: Context, ativo: Boolean, manha: Int, noite: Int) {
        prefs(c).edit().putBoolean("lembretes", ativo).putInt("hora_manha", manha).putInt("hora_noite", noite).apply()
        agendar(c)
    }

    fun agendar(c: Context) {
        val am = c.getSystemService(AlarmManager::class.java)
        for (tipo in listOf(MANHA, NOITE)) {
            val pi = intent(c, tipo)
            am.cancel(pi)
            if (!ativo(c) || prefs(c).getString("token", null) == null) continue
            val hora = if (tipo == MANHA) horaManha(c) else horaNoite(c)
            val quando = Calendar.getInstance().apply {
                set(Calendar.HOUR_OF_DAY, hora); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0)
                if (timeInMillis <= System.currentTimeMillis()) add(Calendar.DAY_OF_MONTH, 1)
            }
            // Janela de 10 min: não exige a permissão de alarme exato e ainda chega na hora.
            am.setWindow(AlarmManager.RTC_WAKEUP, quando.timeInMillis, 10 * 60_000L, pi)
        }
    }

    private fun intent(c: Context, tipo: Int) = PendingIntent.getBroadcast(
        c, tipo, Intent(c, AlarmeReceiver::class.java).putExtra("tipo", tipo),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    fun criarCanal(c: Context) {
        c.getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CANAL, "Lembretes de tarefas", NotificationManager.IMPORTANCE_DEFAULT)
        )
    }

    fun disparar(c: Context, tipo: Int) {
        val p = prefs(c)
        val token = p.getString("token", null) ?: return
        val e = runCatching {
            runBlocking { Api(p.getString("servidor", null) ?: BuildConfig.SERVIDOR, token).chamar("GET", "/api/estado").paraEstado() }
        }.onFailure { Registro.aviso("lembrete_falhou", it) }.getOrNull() ?: return
        val minhas = e.atribuicoes.filter { it.membroId == e.euId && !it.feito && it.dia <= e.hoje }
        if (minhas.isEmpty()) return
        val titulo = if (tipo == MANHA) "Hoje você tem ${minhas.size} tarefa${if (minhas.size > 1) "s" else ""}"
        else "Ainda falta${if (minhas.size > 1) "m" else ""} ${minhas.size} tarefa${if (minhas.size > 1) "s" else ""}"
        notificar(c, tipo, titulo, minhas.joinToString(" · ") { it.tarefa })
    }

    private fun notificar(c: Context, id: Int, titulo: String, texto: String) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        criarCanal(c)
        val abrir = PendingIntent.getActivity(c, 0, Intent(c, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        NotificationManagerCompat.from(c).notify(id, NotificationCompat.Builder(c, CANAL)
            .setSmallIcon(R.drawable.ic_notificacao)
            .setContentTitle(titulo).setContentText(texto)
            .setStyle(NotificationCompat.BigTextStyle().bigText(texto))
            .setContentIntent(abrir).setAutoCancel(true).build())
    }
}

class AlarmeReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        Registro.iniciar(c)
        val r = goAsync()
        Thread {
            try {
                if (i.action == Intent.ACTION_BOOT_COMPLETED || i.action == Intent.ACTION_MY_PACKAGE_REPLACED) Lembretes.agendar(c)
                else { Lembretes.disparar(c, i.getIntExtra("tipo", 1)); Lembretes.agendar(c) }
            } finally { r.finish() }
        }.start()
    }
}
