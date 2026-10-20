package com.casa.app

import android.content.Context
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import org.junit.After
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.test.core.app.ApplicationProvider
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Fluxo real contra um servidor: só roda com CASA_SERVIDOR definido (ex.: um `node server.mjs` local),
 * porque cria uma casa de verdade.  CASA_SERVIDOR=http://localhost:8080 ./gradlew testDebugUnitTest
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w411dp-h891dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class FluxoTest {
    @get:Rule val compose = createEmptyComposeRule()
    private var tela: ActivityScenario<MainActivity>? = null

    @Before fun limpa() {
        assumeTrue("defina CASA_SERVIDOR para rodar", System.getenv("CASA_SERVIDOR") != null)
        ApplicationProvider.getApplicationContext<Context>().getSharedPreferences("casa", Context.MODE_PRIVATE).edit().clear().commit()
        // Abre o app só depois de limpar o login salvo.
        tela = ActivityScenario.launch(MainActivity::class.java)
    }

    @After fun fecha() { tela?.close() }

    private fun criarCasaAbreOApp() {
        compose.onNode(hasSetTextAction() and hasText("Seu nome")).performTextInput("Teste")
        compose.onNode(hasSetTextAction() and hasText("Nome da casa")).performTextInput("Casa de teste")
        compose.onNode(hasSetTextAction() and hasText("Servidor")).performTextReplacement(System.getenv("CASA_SERVIDOR")!!)
        compose.onAllNodesWithText("Criar casa")[1].performScrollTo().performClick()
        compose.waitUntil(20_000) { compose.onAllNodesWithText("Olá, Teste").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Casa de teste").assertExists()
    }

    /** Cria a casa pelo app; depois a regra "Água" (dia sim, dia não) e a disponibilidade aparecem nas telas. */
    @Test fun criarCasaEMostrarRegras() {
        criarCasaAbreOApp()
        val api = Api(System.getenv("CASA_SERVIDOR")!!, ApplicationProvider.getApplicationContext<Context>()
            .getSharedPreferences("casa", Context.MODE_PRIVATE).getString("token", null))
        kotlinx.coroutines.runBlocking {
            val e = api.chamar("GET", "/api/estado").paraEstado()
            val c = api.chamar("POST", "/api/condicoes", org.json.JSONObject().put("nome", "Água").put("tipo", "alternado").put("referencia", e.hoje))
                .paraEstado().condicoes.single()
            val louca = e.tarefas.first { it.nome == "Lavar a louça" }
            api.chamar("PUT", "/api/tarefas/${louca.id}", org.json.JSONObject().put("condicaoId", c.id))
            api.chamar("PUT", "/api/membros/${e.euId}", org.json.JSONObject().put("disponibilidade", org.json.JSONArray(listOf(1, 1, 0.4, 0.4, 0.4, 1, 1))))
        }
        compose.onNodeWithContentDescription("Atualizar").performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("Hoje: 💧 Água").fetchSemanticsNodes().isNotEmpty() }
        compose.onAllNodesWithText("Tarefas")[0].performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithText("só com 💧 Água", substring = true).fetchSemanticsNodes().isNotEmpty() }
        compose.onAllNodesWithText("Casa")[0].performClick()
        compose.onNodeWithText("Regras da casa").performScrollTo().assertExists()
        compose.onNodeWithText("Dia sim, dia não · hoje tem", substring = true).performScrollTo().assertExists()
        compose.onNodeWithText("Menos tarefa: qua, qui, sex").performScrollTo().assertExists()
    }
}
