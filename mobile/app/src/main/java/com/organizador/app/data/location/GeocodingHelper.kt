package com.organizador.app.data.location

import android.content.Context
import android.location.Address
import android.location.Geocoder
import android.os.Build
import java.util.Locale
import kotlin.coroutines.resume
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext

/** Resolves a free-text address/place query to coordinates using the on-device [Geocoder] — no API key or network call to a maps provider needed, unlike a Maps SDK place picker. */
object GeocodingHelper {

    suspend fun search(context: Context, query: String): Address? {
        if (!Geocoder.isPresent()) return null
        val geocoder = Geocoder(context, Locale("pt", "BR"))
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            suspendCancellableCoroutine { continuation ->
                geocoder.getFromLocationName(query, 1) { addresses ->
                    if (continuation.isActive) continuation.resume(addresses.firstOrNull())
                }
            }
        } else {
            withContext(Dispatchers.IO) {
                @Suppress("DEPRECATION")
                runCatching { geocoder.getFromLocationName(query, 1)?.firstOrNull() }.getOrNull()
            }
        }
    }
}
