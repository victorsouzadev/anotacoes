package com.organizador.app.data.reminder

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.organizador.app.data.local.AppDatabase
import com.organizador.app.data.location.GeofenceLocationReminderScheduler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/** AlarmManager alarms and Play Services geofences are both wiped on reboot, so every pending (incomplete) task's reminder needs re-registering. */
class BootCompletedReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

        val appContext = context.applicationContext
        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val alarmScheduler = AlarmTaskReminderScheduler(appContext)
                val locationScheduler = GeofenceLocationReminderScheduler(appContext)
                val tasks = AppDatabase.getInstance(appContext).taskDao().getAllTasks().first()
                tasks.forEach { task ->
                    if (task.isCompleted) return@forEach
                    if (task.dueDate != null && task.dueDate > System.currentTimeMillis()) {
                        alarmScheduler.schedule(task)
                    }
                    if (task.locationLat != null) {
                        locationScheduler.schedule(task)
                    }
                }
            } finally {
                pendingResult.finish()
            }
        }
    }
}
