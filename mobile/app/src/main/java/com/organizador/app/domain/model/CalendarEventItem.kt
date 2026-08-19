package com.organizador.app.domain.model

/** A read-only view of a device calendar event/instance, for display alongside tasks (e.g. on the Today screen). */
data class CalendarEventItem(
    val id: Long,
    val calendarId: Long,
    val title: String,
    val startMillis: Long,
    val endMillis: Long,
    val allDay: Boolean,
    val calendarColor: Int,
)
