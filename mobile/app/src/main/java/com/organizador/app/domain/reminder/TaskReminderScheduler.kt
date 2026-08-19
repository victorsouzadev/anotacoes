package com.organizador.app.domain.reminder

import com.organizador.app.data.local.entity.Task

/**
 * Abstraction over "notify the user around a task's due date", so [com.organizador.app.data.repository.TaskRepository]
 * doesn't need to know about AlarmManager/notifications directly (and tests can use a no-op implementation).
 */
interface TaskReminderScheduler {
    /** Schedules (or re-schedules) a reminder for [task] if it has a future due date and isn't completed; otherwise cancels any existing one. */
    fun schedule(task: Task)

    fun cancel(taskId: Long)

    /** Re-notifies about [taskId]/[title] at [triggerAtMillis] without touching the task's actual due date, used by the notification's "snooze" action. */
    fun snooze(taskId: Long, title: String, triggerAtMillis: Long)
}
