package com.organizador.dieta.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import androidx.core.content.res.ResourcesCompat
import com.organizador.dieta.R
import com.organizador.dieta.data.Metas
import com.organizador.dieta.data.Totais
import java.io.File
import java.time.LocalDate
import androidx.compose.ui.graphics.toArgb
import kotlin.math.roundToInt

/**
 * Card 1080×1350 (formato de post/story) com o resumo da semana, desenhado direto num Bitmap. Cores do Grafite
 * (dia): fundo nanquim, texto sobre-nanquim, secundário nanquim-tinta, trilho da barra nanquim-escuro.
 */
object CardProgresso {
    fun gerar(context: Context, p: Progresso?, semana: List<Totais>, metas: Metas, pesos: List<Pair<LocalDate, Double>>): File {
        val w = 1080
        val h = 1350
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val g = GrafiteCores.Dia
        c.drawColor(g.nanquim.toArgb())
        val branco = g.sobreNanquim.toArgb()
        val claro = g.nanquimTinta.toArgb()
        // Fontes variáveis: o peso certo (500 / 400) só dá para pedir a partir do Android 9.
        fun peso(t: Typeface?, w: Int, padrao: Typeface) =
            t?.let { if (android.os.Build.VERSION.SDK_INT >= 28) Typeface.create(it, w, false) else it } ?: padrao
        val titulo = peso(ResourcesCompat.getFont(context, R.font.newsreader), 500, Typeface.SERIF)
        val corpo = peso(ResourcesCompat.getFont(context, R.font.figtree), 400, Typeface.DEFAULT)
        val valor = ResourcesCompat.getFont(context, R.font.ibm_plex_mono_medium) ?: Typeface.MONOSPACE
        fun texto(t: String, x: Float, y: Float, tam: Float, fonte: Typeface = corpo, cor: Int = branco) =
            c.drawText(t, x, y, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = cor; textSize = tam; typeface = fonte })

        texto("Minha semana na dieta", 80f, 150f, 64f, titulo)
        var y = 260f
        if (p != null) {
            texto("Nível ${p.nivel}", 80f, y, 110f, titulo)
            texto("${p.xpTotal} XP", 80f, y + 70f, 44f, valor, claro)
            val barra = RectF(80f, y + 100f, w - 80f, y + 130f)
            c.drawRoundRect(barra, 15f, 15f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = g.nanquimEscuro.toArgb() })
            c.drawRoundRect(RectF(barra.left, barra.top, barra.left + barra.width() * p.xpNoNivel / p.xpParaProximo.coerceAtLeast(1), barra.bottom),
                15f, 15f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = g.papel.toArgb() })
            y += 260f
            listOf("${p.sequencia}" to "dias seguidos", "${p.sequenciaMeta}" to "na meta", "${p.conquistas.count { it.em != null }}" to "conquistas")
                .forEachIndexed { i, (v, r) ->
                    val x = 80f + i * 320f
                    texto(v, x, y, 72f, valor)
                    texto(r, x, y + 50f, 36f, cor = claro)
                }
            y += 170f
        }
        val dias = semana.filter { it.kcal > 0 }
        if (dias.isNotEmpty()) {
            texto("Média dos últimos 7 dias", 80f, y, 44f)
            texto("${dias.map { it.kcal }.average().roundToInt()} kcal  (meta ${metas.kcal})", 80f, y + 70f, 52f, valor)
            texto("Proteína ${dias.map { it.proteina }.average().roundToInt()} g · ${dias.count { it.kcalNaMeta(metas) }}/${dias.size} dias na meta",
                80f, y + 130f, 40f, cor = claro)
            y += 220f
        }
        if (pesos.size >= 2) {
            val dif = pesos.last().second - pesos.first().second
            texto("Peso", 80f, y, 44f)
            texto("${fmt(pesos.last().second)} kg  (${if (dif > 0) "+" else ""}${fmt(dif)} kg)", 80f, y + 70f, 52f, valor)
        }
        texto("Dieta · hub", 80f, h - 80f, 36f, cor = claro)

        val arq = File(context.cacheDir, "compartilhar/progresso.png").also { it.parentFile?.mkdirs() }
        arq.outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        return arq
    }
}
