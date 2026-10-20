package com.organizador.dieta.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import com.organizador.dieta.data.Metas
import com.organizador.dieta.data.Totais
import java.io.File
import java.time.LocalDate
import kotlin.math.roundToInt

/** Card 1080×1350 (formato de post/story) com o resumo da semana, desenhado direto num Bitmap. */
object CardProgresso {
    fun gerar(context: Context, p: Progresso?, semana: List<Totais>, metas: Metas, pesos: List<Pair<LocalDate, Double>>): File {
        val w = 1080
        val h = 1350
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.drawPaint(Paint().apply { shader = LinearGradient(0f, 0f, 0f, h.toFloat(), 0xFF0B3D1A.toInt(), 0xFF2F9E44.toInt(), Shader.TileMode.CLAMP) })
        val branco = 0xFFFFFFFF.toInt()
        val claro = 0xCCFFFFFF.toInt()
        fun texto(t: String, x: Float, y: Float, tam: Float, negrito: Boolean = false, cor: Int = branco) =
            c.drawText(t, x, y, Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = cor; textSize = tam; typeface = if (negrito) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
            })

        texto("Minha semana na dieta", 80f, 150f, 64f, true)
        var y = 260f
        if (p != null) {
            texto("Nível ${p.nivel}", 80f, y, 110f, true)
            texto("${p.xpTotal} XP", 80f, y + 70f, 44f, cor = claro)
            val barra = RectF(80f, y + 100f, w - 80f, y + 130f)
            c.drawRoundRect(barra, 15f, 15f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x33FFFFFF })
            c.drawRoundRect(RectF(barra.left, barra.top, barra.left + barra.width() * p.xpNoNivel / p.xpParaProximo.coerceAtLeast(1), barra.bottom),
                15f, 15f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = branco })
            y += 260f
            listOf("🔥 ${p.sequencia}" to "dias seguidos", "🎯 ${p.sequenciaMeta}" to "na meta", "🏅 ${p.conquistas.count { it.em != null }}" to "conquistas")
                .forEachIndexed { i, (v, r) ->
                    val x = 80f + i * 320f
                    texto(v, x, y, 72f, true)
                    texto(r, x, y + 50f, 36f, cor = claro)
                }
            y += 170f
        }
        val dias = semana.filter { it.kcal > 0 }
        if (dias.isNotEmpty()) {
            texto("Média dos últimos 7 dias", 80f, y, 44f, true)
            texto("${dias.map { it.kcal }.average().roundToInt()} kcal  (meta ${metas.kcal})", 80f, y + 70f, 52f)
            texto("Proteína ${dias.map { it.proteina }.average().roundToInt()} g · ${dias.count { it.kcalNaMeta(metas) }}/${dias.size} dias na meta",
                80f, y + 130f, 40f, cor = claro)
            y += 220f
        }
        if (pesos.size >= 2) {
            val dif = pesos.last().second - pesos.first().second
            texto("Peso", 80f, y, 44f, true)
            texto("${fmt(pesos.last().second)} kg  (${if (dif > 0) "+" else ""}${fmt(dif)} kg)", 80f, y + 70f, 52f)
        }
        texto("Dieta · hub", 80f, h - 80f, 36f, cor = claro)

        val arq = File(context.cacheDir, "compartilhar/progresso.png").also { it.parentFile?.mkdirs() }
        arq.outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        return arq
    }
}
