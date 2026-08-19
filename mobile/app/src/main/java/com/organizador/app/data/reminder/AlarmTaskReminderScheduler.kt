package com.organizador.app.data.reminder

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import com.organizador.app.data.local.entity.Task
import com.organizador.app.domain.reminder.TaskReminderScheduler

/**
 * Schedules a one-shot [AlarmManager] alarm at a task's due date/time, delivered to
 * [TaskReminderReceiver]. Falls back to an inexact alarm when exact-alarm scheduling isn't
 * permitted (Android 12+ requires the user to grant it separately from other runtime permissions).
 */
class AlarmTaskReminderScheduler(
    private val context: Context,
) : TaskReminderScheduler {

    private val alarmManager: AlarmManager
        get() = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    override fun schedule(task: Task) {
        val dueDate = task.dueDate
        if (task.isCompleted || dueDate == null) {
            cancel(task.id)
            return
        }

        val now = System.currentTimeMillis()
        if (dueDate <= now) {
            // The due instant can slip into the past between the user picking it (minute precision)
            // and the save actually completing — that's not a stale overdue task being re-saved, it's
            // the reminder the user just set. The edit screen in particular can take several minutes
            // to work through (date, then time, then category/subtasks, then save), so the tolerance
            // needs real headroom, not just a few seconds of dialog latency. Fire it almost immediately
            // instead of silently dropping it. Anything older than the tolerance is a genuinely past
            // due date (e.g. editing an old task without touching its date) and should stay unscheduled.
            if (now - dueDate <= RECENTLY_PASSED_TOLERANCE_MILLIS) {
                scheduleAlarm(task.id, task.title, now + IMMEDIATE_FIRE_DELAY_MILLIS)
            } else {
                cancel(task.id)
            }
            return
        }
        scheduleAlarm(task.id, task.title, dueDate)
    }

    override fun snooze(taskId: Long, title: String, triggerAtMillis: Long) {
        scheduleAlarm(taskId, title, triggerAtMillis)
    }

    private fun scheduleAlarm(taskId: Long, title: String, triggerAtMillis: Long) {
        val pendingIntent = buildPendingIntent(taskId, title, PendingIntent.FLAG_UPDATE_CURRENT) ?: return

        val canScheduleExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()
        try {
            if (canScheduleExact) {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pendingIntent)
            } else {
                alarmManager.set(AlarmManager.RTC_WAKEUP, triggerAtMillis, pendingIntent)
            }
        } catch (e: SecurityException) {
            // Permission revoked between the check and the call (OEM-specific); degrade instead of crashing.
            alarmManager.set(AlarmManager.RTC_WAKEUP, triggerAtMillis, pendingIntent)
        }
    }

    override fun cancel(taskId: Long) {
        val pendingIntent = buildPendingIntent(taskId, title = "", flags = PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_UPDATE_CURRENT)
        pendingIntent?.let {
            alarmManager.cancel(it)
            it.cancel()
        }
    }

    private fun buildPendingIntent(taskId: Long, title: String, flags: Int): PendingIntent? {
        val intent = Intent(context, TaskReminderReceiver::class.java).apply {
            putExtra(TaskReminderReceiver.EXTRA_TASK_ID, taskId)
            putExtra(TaskReminderReceiver.EXTRA_TASK_TITLE, title)
        }
        return PendingIntent.getBroadcast(context, taskId.toInt(), intent, flags or PendingIntent.FLAG_IMMUTABLE)
    }

    private companion object {
        const val RECENTLY_PASSED_TOLERANCE_MILLIS = 15 * 60 * 1000L
        const val IMMEDIATE_FIRE_DELAY_MILLIS = 2_000L
    }
}
