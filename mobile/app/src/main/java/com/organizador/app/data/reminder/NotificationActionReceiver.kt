package com.organizador.app.data.reminder

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat
import com.organizador.app.data.repository.buildTaskRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** Handles the "Concluir"/"Adiar" action buttons on a task reminder notification. */
class NotificationActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val taskId = intent.getLongExtra(EXTRA_TASK_ID, -1L)
        if (taskId < 0) return
        val title = intent.getStringExtra(EXTRA_TASK_TITLE).orEmpty()

        val appContext = context.applicationContext
        NotificationManagerCompat.from(appContext).cancel(taskId.toInt())

        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                when (intent.action) {
                    ACTION_COMPLETE_TASK -> {
                        buildTaskRepository(appContext).setCompleted(taskId, true)
                    }
                    ACTION_SNOOZE_TASK -> {
                        AlarmTaskReminderScheduler(appContext)
                            .snooze(taskId, title, System.currentTimeMillis() + SNOOZE_DURATION_MILLIS)
                    }
                }
            } finally {
                pendingResult.finish()
            }
        }
    }

    companion object {
        const val ACTION_COMPLETE_TASK = "com.organizador.app.action.COMPLETE_TASK"
        const val ACTION_SNOOZE_TASK = "com.organizador.app.action.SNOOZE_TASK"
        const val EXTRA_TASK_ID = "task_id"
        const val EXTRA_TASK_TITLE = "task_title"
        const val SNOOZE_DURATION_MILLIS = 60 * 60 * 1000L
    }
}
