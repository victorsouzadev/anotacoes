package com.organizador.app.domain.location

import com.organizador.app.data.local.entity.Task

/**
 * Abstraction over "notify the user on entering a task's location radius", so
 * [com.organizador.app.data.repository.TaskRepository] doesn't need to know about geofencing
 * directly, mirroring [com.organizador.app.domain.reminder.TaskReminderScheduler] for time-based
 * reminders.
 */
interface LocationReminderScheduler {
    /** Registers (or re-registers) a geofence for [task] if it has a location set and isn't completed; otherwise cancels any existing one. */
    fun schedule(task: Task)

    fun cancel(taskId: Long)
}
