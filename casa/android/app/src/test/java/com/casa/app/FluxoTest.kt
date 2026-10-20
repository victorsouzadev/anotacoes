package com.casa.app

import android.content.Context
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
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
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Before fun limpa() {
        assumeTrue("defina CASA_SERVIDOR para rodar", System.getenv("CASA_SERVIDOR") != null)
        ApplicationProvider.getApplicationContext<Context>().getSharedPreferences("casa", Context.MODE_PRIVATE).edit().clear().commit()
    }

    @Test fun criarCasaAbreOApp() {
        compose.onNode(hasSetTextAction() and hasText("Seu nome")).performTextInput("Teste")
        compose.onNode(hasSetTextAction() and hasText("Nome da casa")).performTextInput("Casa de teste")
        compose.onNode(hasSetTextAction() and hasText("Servidor")).performTextReplacement(System.getenv("CASA_SERVIDOR")!!)
        compose.onAllNodesWithText("Criar casa")[1].performScrollTo().performClick()
        compose.waitUntil(20_000) { compose.onAllNodesWithText("Olá, Teste").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Casa de teste").assertExists()
    }
}
