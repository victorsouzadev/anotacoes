package com.organizador.app.data.repository

import android.content.Context
import com.organizador.app.data.calendar.DeviceCalendarSync
import com.organizador.app.data.local.AppDatabase
import com.organizador.app.data.local.SettingsStore
import com.organizador.app.data.location.GeofenceLocationReminderScheduler
import com.organizador.app.data.reminder.AlarmTaskReminderScheduler
import com.organizador.app.widget.GlanceWidgetRefresher

/**
 * Builds a [TaskRepository] wired exactly like [com.organizador.app.di.AppContainer], for call sites
 * that run outside the DI graph and only have a [Context] (broadcast receivers, services, widgets).
 */
fun buildTaskRepository(context: Context): TaskRepository {
    val database = AppDatabase.getInstance(context)
    val settingsStore = SettingsStore(context)
    return TaskRepository(
        database.taskDao(),
        database.categoryDao(),
        database.taskCategoryCrossRefDao(),
        database.subtaskDao(),
        AlarmTaskReminderScheduler(context),
        DeviceCalendarSync(context, settingsStore),
        GlanceWidgetRefresher(context),
        GeofenceLocationReminderScheduler(context),
    )
}
