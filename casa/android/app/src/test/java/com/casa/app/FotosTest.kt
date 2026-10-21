package com.casa.app

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class FotosTest {
    @Test fun reduzEGira() {
        val c = ApplicationProvider.getApplicationContext<android.content.Context>()
        // Foto "deitada" de 4000×3000 com EXIF dizendo que a câmera estava em pé (girar 90°).
        val f = File(c.cacheDir, "grande.jpg")
        f.outputStream().use { Bitmap.createBitmap(4000, 3000, Bitmap.Config.ARGB_8888).compress(Bitmap.CompressFormat.JPEG, 90, it) }
        ExifInterface(f).apply { setAttribute(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_ROTATE_90.toString()); saveAttributes() }
        val jpeg = Fotos.reduzir(c, Uri.fromFile(f))
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size, o)
        assertEquals("em pé depois de girar", 1600, o.outHeight)
        assertEquals(1200, o.outWidth)
        assertTrue("bem menor que o original: ${jpeg.size} bytes", jpeg.size < f.length())
    }
}
