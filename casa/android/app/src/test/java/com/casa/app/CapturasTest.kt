package com.casa.app

import android.content.Context
import android.graphics.Bitmap
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
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
            val api = Api(servidor, ApplicationProvider.getApplicationContext<Context>().getSharedPreferences("casa", Context.MODE_PRIVATE).getString("token", null))
            kotlinx.coroutines.runBlocking {
                val e = api.chamar("GET", "/api/estado").paraEstado()
                for ((t, h) in listOf("Lavar a louça" to "20:00", "Cozinhar o jantar" to "19:30"))
                    api.chamar("PUT", "/api/tarefas/${e.tarefas.first { it.nome == t }.id}", org.json.JSONObject().put("horario", h))
            }
            compose.onNode(androidx.compose.ui.test.hasContentDescription("Atualizar")).performClick()
            compose.waitUntil(10_000) { compose.onAllNodesWithText("20:00").fetchSemanticsNodes().isNotEmpty() }
            compose.waitForIdle(); Thread.sleep(1500); compose.waitForIdle()
            salva(pasta, "$tema-2-hoje")
            for ((aba, nome) in listOf("Semana" to "3-semana", "Tarefas" to "4-tarefas", "Casa" to "5-casa")) {
                compose.onAllNodesWithText(aba)[0].performClick(); compose.waitForIdle()
                salva(pasta, "$tema-$nome")
            }
            // Detalhe de uma tarefa com comentário e "não feita".
            compose.onAllNodesWithText("Hoje")[0].performClick(); compose.waitForIdle()
            compose.onAllNodesWithText("Lavar a louça")[0].performClick()
            compose.onNodeWithText("Não deu para fazer").performClick()
            compose.onNode(hasSetTextAction() and hasText("Motivo (opcional)")).performTextInput("Faltou água de manhã")
            compose.onNodeWithText("Confirmar").performClick()
            compose.waitUntil(10_000) { compose.onAllNodesWithText("Faltou água de manhã", substring = true).fetchSemanticsNodes().isNotEmpty() }
            compose.onNode(hasSetTextAction() and hasText("Comentar…")).performTextInput("Faço à noite, quando voltar")
            compose.onNode(androidx.compose.ui.test.hasContentDescription("Enviar comentário")).performClick()
            compose.waitUntil(10_000) { compose.onAllNodesWithText("Faço à noite, quando voltar").fetchSemanticsNodes().isNotEmpty() }
            salva(pasta, "$tema-7-detalhe")
            compose.onNode(androidx.compose.ui.test.hasContentDescription("Voltar")).performClick(); compose.waitForIdle()
            salva(pasta, "$tema-8-hoje-com-marcas")
            if (tema == "dia") {
                // Tema escolhido no app vale mesmo com o sistema no claro.
                compose.onAllNodesWithText("Casa")[0].performClick(); compose.waitForIdle()
                compose.onNode(androidx.compose.ui.test.hasScrollToNodeAction()).performScrollToNode(hasText("Escuro"))
                compose.onNodeWithText("Escuro").performClick(); compose.waitForIdle()
                salva(pasta, "$tema-9-casa-tema-escuro-no-app")
                compose.onNodeWithText("Sistema").performClick(); compose.waitForIdle()
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
