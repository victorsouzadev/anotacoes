package com.organizador.app.data.location

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices
import com.organizador.app.data.local.entity.Task
import com.organizador.app.domain.location.LocationReminderScheduler

/**
 * Registers a circular [Geofence] per task via Play Services' [GeofencingClient][com.google.android.gms.location.GeofencingClient],
 * delivered to [GeofenceBroadcastReceiver] on entry. Requires ACCESS_FINE_LOCATION (and, to fire
 * while the app isn't in the foreground, ACCESS_BACKGROUND_LOCATION) — both granted at the UI layer
 * before a location is ever attached to a task, but re-checked here defensively.
 */
class GeofenceLocationReminderScheduler(
    private val context: Context,
) : LocationReminderScheduler {

    private val geofencingClient by lazy { LocationServices.getGeofencingClient(context) }

    override fun schedule(task: Task) {
        val lat = task.locationLat
        val lng = task.locationLng
        val radius = task.locationRadiusMeters
        if (task.isCompleted || lat == null || lng == null || radius == null) {
            cancel(task.id)
            return
        }
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            return
        }

        val geofence = Geofence.Builder()
            .setRequestId(task.id.toString())
            .setCircularRegion(lat, lng, radius)
            .setExpirationDuration(Geofence.NEVER_EXPIRE)
            .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER)
            .build()
        val request = GeofencingRequest.Builder()
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER)
            .addGeofence(geofence)
            .build()

        try {
            geofencingClient.addGeofences(request, geofencePendingIntent())
        } catch (e: SecurityException) {
            // Permission revoked between the check and the call (OEM-specific); degrade instead of crashing.
        }
    }

    override fun cancel(taskId: Long) {
        geofencingClient.removeGeofences(listOf(taskId.toString()))
    }

    /**
     * One shared PendingIntent for every geofence: Play Services identifies which task(s) triggered
     * via [com.google.android.gms.location.GeofencingEvent.getTriggeringGeofences]' request ids, so
     * a single receiver handles all of them — this also avoids the request-code bookkeeping the
     * per-task alarm PendingIntents need.
     */
    private fun geofencePendingIntent(): PendingIntent {
        val intent = Intent(context, GeofenceBroadcastReceiver::class.java)
        // Play Services attaches the triggering-geofence data via a fillIn Intent when it fires this
        // PendingIntent, which needs FLAG_MUTABLE on Android 12+ (FLAG_IMMUTABLE blocks that merge).
        return PendingIntent.getBroadcast(context, GEOFENCE_REQUEST_CODE, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
    }

    private companion object {
        const val GEOFENCE_REQUEST_CODE = 9000
    }
}
