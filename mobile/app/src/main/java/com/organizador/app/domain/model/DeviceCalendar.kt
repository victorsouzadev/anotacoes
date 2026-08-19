package com.organizador.app.domain.model

/** A calendar available on the device (Google Calendar, Samsung Calendar, etc.), as listed by CalendarContract. */
data class DeviceCalendar(
    val id: Long,
    val displayName: String,
    val accountName: String,
    val color: Int,
)
