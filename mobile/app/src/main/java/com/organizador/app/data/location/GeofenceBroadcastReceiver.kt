package com.organizador.app.data.location

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent
import com.organizador.app.data.local.AppDatabase
import com.organizador.app.data.reminder.NotificationHelper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class GeofenceBroadcastReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val geofencingEvent = GeofencingEvent.fromIntent(intent) ?: return
        if (geofencingEvent.hasError() || geofencingEvent.geofenceTransition != Geofence.GEOFENCE_TRANSITION_ENTER) return

        val taskIds = geofencingEvent.triggeringGeofences
            ?.mapNotNull { it.requestId.toLongOrNull() }
            ?.takeIf { it.isNotEmpty() }
            ?: return

        val appContext = context.applicationContext
        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val taskDao = AppDatabase.getInstance(appContext).taskDao()
                taskIds.forEach { taskId ->
                    val task = taskDao.getTaskOnce(taskId) ?: return@forEach
                    if (task.isCompleted || task.deletedAt != null) return@forEach
                    NotificationHelper.showLocationReminder(appContext, taskId, task.title, task.locationLabel)
                }
            } finally {
                pendingResult.finish()
            }
        }
    }
}
