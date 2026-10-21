package com.casa.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import androidx.core.content.FileProvider
import androidx.exifinterface.media.ExifInterface
import java.io.ByteArrayOutputStream
import java.io.File

/** Fotos das tarefas: arquivo temporário para a câmera e redução antes de enviar. */
object Fotos {
    private const val LADO_MAX = 1600

    /** Uri de um arquivo novo no cache, para a câmera gravar a foto (FileProvider, sem permissão de câmera). */
    fun novoArquivo(c: Context): Uri {
        val pasta = File(c.cacheDir, "fotos").apply { mkdirs() }
        pasta.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 86_400_000 }?.forEach { it.delete() }
        val f = File.createTempFile("tarefa-", ".jpg", pasta)
        return FileProvider.getUriForFile(c, "${c.packageName}.fotos", f)
    }

    /** Lê a imagem (câmera ou galeria), corrige a rotação e devolve JPEG com o lado maior ≤ 1600 px. */
    fun reduzir(c: Context, uri: Uri): ByteArray {
        val cr = c.contentResolver
        val limites = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        cr.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, limites) }
        require(limites.outWidth > 0) { "Não consegui ler a imagem" }
        var amostra = 1
        while (maxOf(limites.outWidth, limites.outHeight) / (amostra * 2) >= LADO_MAX) amostra *= 2
        var bm = cr.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = amostra }) }
            ?: error("Não consegui ler a imagem")
        val escala = LADO_MAX.toFloat() / maxOf(bm.width, bm.height)
        val giro = runCatching { cr.openInputStream(uri).use { ExifInterface(it!!).rotationDegrees } }.getOrDefault(0)
        if (escala < 1f || giro != 0) {
            val m = Matrix().apply { if (escala < 1f) postScale(escala, escala); if (giro != 0) postRotate(giro.toFloat()) }
            bm = Bitmap.createBitmap(bm, 0, 0, bm.width, bm.height, m, true)
        }
        return ByteArrayOutputStream().use { out -> bm.compress(Bitmap.CompressFormat.JPEG, 82, out); out.toByteArray() }
    }
}
