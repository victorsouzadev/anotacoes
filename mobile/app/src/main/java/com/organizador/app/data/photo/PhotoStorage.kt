package com.organizador.app.data.photo

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import java.io.File
import java.io.IOException
import java.util.UUID

/**
 * Copies a picked/captured photo into the app's private storage (filesDir/photos) so the task owns
 * a stable local file instead of depending on a content:// Uri whose permission grant can be revoked.
 */
object PhotoStorage {

    fun saveFromUri(context: Context, uri: Uri): String? = try {
        val file = newPhotoFile(context)
        context.contentResolver.openInputStream(uri)?.use { input ->
            file.outputStream().use { output -> input.copyTo(output) }
        }
        file.absolutePath
    } catch (e: IOException) {
        null
    }

    fun saveBitmap(context: Context, bitmap: Bitmap): String? = try {
        val file = newPhotoFile(context)
        file.outputStream().use { output -> bitmap.compress(Bitmap.CompressFormat.JPEG, 85, output) }
        file.absolutePath
    } catch (e: IOException) {
        null
    }

    fun delete(path: String?) {
        if (path == null) return
        runCatching { File(path).delete() }
    }

    private fun newPhotoFile(context: Context): File {
        val dir = File(context.filesDir, "photos").apply { mkdirs() }
        return File(dir, "${UUID.randomUUID()}.jpg")
    }
}
