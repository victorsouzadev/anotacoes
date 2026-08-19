package com.organizador.app.domain.calendar

import com.organizador.app.data.local.entity.Task

/**
 * Abstraction over "mirror a task's due date as a device calendar event", so
 * [com.organizador.app.data.repository.TaskRepository] doesn't need to know about CalendarContract
 * directly (and tests can use a no-op implementation).
 */
interface CalendarSync {
    /** Creates or updates the calendar event for [task]'s due date. Returns the event id to persist
     * on the task row, or null when sync isn't applicable (disabled, no permission, no calendar chosen,
     * or the task has no due date). */
    suspend fun sync(task: Task): Long?

    /** Removes a previously created event, if any. No-op when [eventId] is null. */
    suspend fun remove(eventId: Long?)
}
