package com.casa.app

import android.content.Context
import android.graphics.Bitmap
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/**
 * Gera capturas das telas nos temas dia e noite em CASA_CAPTURAS (só roda com CASA_SERVIDOR e
 * CASA_CAPTURAS definidos). Serve para conferir a identidade visual, não afirma nada sozinho.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w411dp-h891dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class CapturasTest {
    @get:Rule val compose = createEmptyComposeRule()

    @Test fun dia() = capturar("dia", "")
    @Test fun noite() = capturar("noite", "+night")

    private fun capturar(tema: String, qualificador: String) {
        val servidor = System.getenv("CASA_SERVIDOR"); val pasta = System.getenv("CASA_CAPTURAS")
        assumeTrue(servidor != null && pasta != null)
        if (qualificador.isNotEmpty()) RuntimeEnvironment.setQualifiers(qualificador)
        ApplicationProvider.getApplicationContext<Context>().getSharedPreferences("casa", Context.MODE_PRIVATE).edit().clear().commit()
        ActivityScenario.launch(MainActivity::class.java).use { tela = it
            salva(pasta, "$tema-1-boas-vindas")
            compose.onNode(hasSetTextAction() and hasText("Seu nome")).performTextInput("Victor")
            compose.onNode(hasSetTextAction() and hasText("Nome da casa")).performTextInput("Victor e Vitória")
            compose.onNode(hasSetTextAction() and hasText("Servidor")).performTextReplacement(servidor!!)
            compose.onAllNodesWithText("Criar casa")[1].performScrollTo().performClick()
            compose.waitUntil(20_000) { compose.onAllNodesWithText("Olá, Victor").fetchSemanticsNodes().isNotEmpty() }
            compose.onAllNodesWithText("Lavar a louça")[0].performClick() // marca uma como feita
            compose.waitForIdle(); Thread.sleep(1500); compose.waitForIdle()
            salva(pasta, "$tema-2-hoje")
            for ((aba, nome) in listOf("Semana" to "3-semana", "Tarefas" to "4-tarefas", "Casa" to "5-casa")) {
                compose.onAllNodesWithText(aba)[0].performClick(); compose.waitForIdle()
                salva(pasta, "$tema-$nome")
            }
            compose.onAllNodesWithText("Tarefas")[0].performClick(); compose.waitForIdle()
            // A janela de diálogo tem animação contínua no Robolectric: congela o relógio antes de abrir.
            compose.mainClock.autoAdvance = false
            compose.onAllNodesWithText("Limpar o banheiro")[0].performClick()
            compose.mainClock.advanceTimeBy(2000)
            salva(pasta, "$tema-6-editar-tarefa", esperar = false)
        }
    }

    private var tela: ActivityScenario<MainActivity>? = null

    private fun salva(pasta: String, nome: String, esperar: Boolean = true) {
        if (esperar) compose.waitForIdle()
        lateinit var img: Bitmap
        tela!!.onActivity { a ->
            val v = a.window.decorView
            img = Bitmap.createBitmap(v.width, v.height, Bitmap.Config.ARGB_8888)
            val tela = android.graphics.Canvas(img)
            v.draw(tela)
            // Diálogo aberto: desenha a janela dele por cima, centralizada.
            org.robolectric.shadows.ShadowDialog.getLatestDialog()?.takeIf { it.isShowing }?.window?.decorView?.let { d ->
                tela.drawColor(0x52000000)
                tela.save(); tela.translate((v.width - d.width) / 2f, (v.height - d.height) / 2f); d.draw(tela); tela.restore()
            }
        }
        File(pasta).mkdirs()
        File(pasta, "$nome.png").outputStream().use { img.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}
