package com.organizador.app.data.calendar

import android.content.Context
import com.organizador.app.data.local.SettingsStore
import com.organizador.app.data.local.entity.Task
import com.organizador.app.domain.calendar.CalendarSync

class DeviceCalendarSync(
    private val context: Context,
    private val settingsStore: SettingsStore,
) : CalendarSync {

    override suspend fun sync(task: Task): Long? {
        if (!settingsStore.calendarSyncEnabled.value) return null
        val calendarId = settingsStore.selectedCalendarId.value ?: return null
        val dueDate = task.dueDate ?: return null
        return CalendarProvider.upsertEvent(
            context = context,
            calendarId = calendarId,
            existingEventId = task.calendarEventId,
            title = task.title,
            description = task.description,
            startMillis = dueDate,
            endMillis = dueDate + EVENT_DURATION_MILLIS,
        )
    }

    override suspend fun remove(eventId: Long?) {
        if (eventId == null) return
        CalendarProvider.deleteEvent(context, eventId)
    }

    private companion object {
        const val EVENT_DURATION_MILLIS = 30 * 60 * 1000L
    }
}
