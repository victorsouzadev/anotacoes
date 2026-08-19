package com.organizador.app.data.calendar

import android.Manifest
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CalendarContract
import androidx.core.content.ContextCompat
import com.organizador.app.domain.model.CalendarEventItem
import com.organizador.app.domain.model.DeviceCalendar
import java.util.TimeZone

/**
 * Thin wrapper over the device's Calendar Provider (CalendarContract) — the on-device calendar app's
 * own data (Google Calendar, Samsung Calendar, etc.), reached via ContentResolver rather than any
 * cloud API. Every operation requires READ_CALENDAR/WRITE_CALENDAR at runtime; callers must check
 * [hasPermission] first, since a denied permission makes ContentResolver calls fail silently or throw.
 */
object CalendarProvider {

    fun hasPermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_CALENDAR) == PackageManager.PERMISSION_GRANTED

    fun listCalendars(context: Context): List<DeviceCalendar> {
        if (!hasPermission(context)) return emptyList()
        val projection = arrayOf(
            CalendarContract.Calendars._ID,
            CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,
            CalendarContract.Calendars.ACCOUNT_NAME,
            CalendarContract.Calendars.CALENDAR_COLOR,
        )
        val calendars = mutableListOf<DeviceCalendar>()
        context.contentResolver.query(CalendarContract.Calendars.CONTENT_URI, projection, null, null, null)?.use { cursor ->
            while (cursor.moveToNext()) {
                calendars += DeviceCalendar(
                    id = cursor.getLong(0),
                    displayName = cursor.getString(1) ?: "",
                    accountName = cursor.getString(2) ?: "",
                    color = cursor.getInt(3),
                )
            }
        }
        return calendars
    }

    /** Creates [existingEventId]'s event if it's still present, otherwise inserts a new one. Returns the resulting event id, or null without permission. */
    fun upsertEvent(
        context: Context,
        calendarId: Long,
        existingEventId: Long?,
        title: String,
        description: String?,
        startMillis: Long,
        endMillis: Long,
    ): Long? {
        if (!hasPermission(context)) return null
        val values = ContentValues().apply {
            put(CalendarContract.Events.CALENDAR_ID, calendarId)
            put(CalendarContract.Events.TITLE, title)
            put(CalendarContract.Events.DESCRIPTION, description)
            put(CalendarContract.Events.DTSTART, startMillis)
            put(CalendarContract.Events.DTEND, endMillis)
            put(CalendarContract.Events.EVENT_TIMEZONE, TimeZone.getDefault().id)
        }
        return if (existingEventId != null && eventExists(context, existingEventId)) {
            val uri = ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, existingEventId)
            context.contentResolver.update(uri, values, null, null)
            existingEventId
        } else {
            context.contentResolver.insert(CalendarContract.Events.CONTENT_URI, values)?.lastPathSegment?.toLongOrNull()
        }
    }

    fun deleteEvent(context: Context, eventId: Long): Boolean {
        if (!hasPermission(context)) return false
        val uri = ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, eventId)
        return context.contentResolver.delete(uri, null, null) > 0
    }

    /** Events (including expanded recurring instances) that overlap [startMillis, endMillis). */
    fun eventsForRange(context: Context, startMillis: Long, endMillis: Long): List<CalendarEventItem> {
        if (!hasPermission(context)) return emptyList()
        val projection = arrayOf(
            CalendarContract.Instances.EVENT_ID,
            CalendarContract.Instances.CALENDAR_ID,
            CalendarContract.Instances.TITLE,
            CalendarContract.Instances.BEGIN,
            CalendarContract.Instances.END,
            CalendarContract.Instances.ALL_DAY,
            CalendarContract.Instances.CALENDAR_COLOR,
        )
        val uri = CalendarContract.Instances.CONTENT_URI.buildUpon().apply {
            ContentUris.appendId(this, startMillis)
            ContentUris.appendId(this, endMillis)
        }.build()

        val events = mutableListOf<CalendarEventItem>()
        context.contentResolver.query(uri, projection, null, null, "${CalendarContract.Instances.BEGIN} ASC")?.use { cursor ->
            while (cursor.moveToNext()) {
                events += CalendarEventItem(
                    id = cursor.getLong(0),
                    calendarId = cursor.getLong(1),
                    title = cursor.getString(2) ?: "",
                    startMillis = cursor.getLong(3),
                    endMillis = cursor.getLong(4),
                    allDay = cursor.getInt(5) != 0,
                    calendarColor = cursor.getInt(6),
                )
            }
        }
        return events
    }

    private fun eventExists(context: Context, eventId: Long): Boolean {
        val uri = ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, eventId)
        context.contentResolver.query(uri, arrayOf(CalendarContract.Events._ID), null, null, null)?.use {
            return it.moveToFirst()
        }
        return false
    }
}
