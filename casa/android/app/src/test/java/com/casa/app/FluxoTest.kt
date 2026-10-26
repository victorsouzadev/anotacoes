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
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.performScrollToNode
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
        compose.waitUntil(10_000) { compose.onAllNodesWithText(" Água").fetchSemanticsNodes().isNotEmpty() }
        compose.onAllNodesWithText("Tarefas")[0].performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithText("só com água", substring = true).fetchSemanticsNodes().isNotEmpty() }
        compose.onAllNodesWithText("Casa")[0].performClick()
        compose.onNodeWithText("Regras da casa").performScrollTo().assertExists()
        compose.onNodeWithText("Dia sim, dia não · hoje tem", substring = true).performScrollTo().assertExists()
        compose.onNodeWithText("menos tarefa qua, qui, sex", substring = true).performScrollTo().assertExists()

        // Não feita + comentário pelo detalhe da tarefa.
        compose.onAllNodesWithText("Hoje")[0].performClick(); compose.waitForIdle()
        val primeira = kotlinx.coroutines.runBlocking { api.chamar("GET", "/api/estado").paraEstado() }.let { e -> e.atribuicoes.first { it.membroId == e.euId && it.dia == e.hoje } }
        compose.onAllNodesWithText(primeira.tarefa)[0].performClick()
        compose.onNodeWithText("Não deu para fazer").performClick()
        compose.onNode(hasSetTextAction() and hasText("Motivo (opcional)")).performTextInput("Faltou água")
        compose.onNodeWithText("Confirmar").performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("Faltou água", substring = true).fetchSemanticsNodes().isNotEmpty() }
        compose.onNode(hasSetTextAction() and hasText("Comentar…")).performTextInput("Faço amanhã")
        compose.onNodeWithContentDescription("Enviar comentário").performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("Faço amanhã").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription("Voltar").performClick(); compose.waitForIdle()
        // Não feita sai da aba Hoje e continua na Semana, com a marca e os comentários.
        compose.waitUntil(5_000) { compose.onAllNodesWithText("não feita").fetchSemanticsNodes().isEmpty() }
        compose.onAllNodesWithText("Semana")[0].performClick(); compose.waitForIdle()
        compose.waitUntil(5_000) { compose.onAllNodesWithText("não feita").fetchSemanticsNodes().isNotEmpty() }
        compose.onAllNodesWithContentDescription("Comentários")[0].assertExists()
        val depois = kotlinx.coroutines.runBlocking { api.chamar("GET", "/api/estado").paraEstado() }
        org.junit.Assert.assertEquals("Faltou água", depois.atribuicoes.first { it.id == primeira.id }.naoFeita)
        org.junit.Assert.assertEquals(2, depois.comentarios.count { it.atribuicaoId == primeira.id })

        // Foto: envia uma imagem pela mesma função que a câmera/galeria usam e confere no detalhe e na lista.
        val outra = depois.atribuicoes.first { it.membroId == depois.euId && it.dia == depois.hoje && it.id != primeira.id }
        val arq = java.io.File(ApplicationProvider.getApplicationContext<Context>().cacheDir, "foto.jpg")
        arq.outputStream().use { android.graphics.Bitmap.createBitmap(800, 600, android.graphics.Bitmap.Config.ARGB_8888).compress(android.graphics.Bitmap.CompressFormat.JPEG, 80, it) }
        tela!!.onActivity { act -> androidx.lifecycle.ViewModelProvider(act)[CasaViewModel::class.java].enviarFoto(outra, android.net.Uri.fromFile(arq), concluir = true) }
        compose.onAllNodesWithText("Hoje")[0].performClick(); compose.waitForIdle()
        compose.waitUntil(15_000) { compose.onAllNodesWithContentDescription("Com foto").fetchSemanticsNodes().isNotEmpty() }
        compose.onAllNodesWithText(outra.tarefa)[0].performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("Foto de Teste").fetchSemanticsNodes().isNotEmpty() }
        compose.waitUntil(10_000) { compose.onAllNodesWithContentDescription("Foto da tarefa ${outra.tarefa}").fetchSemanticsNodes().isNotEmpty() }
        val comFoto = kotlinx.coroutines.runBlocking { api.chamar("GET", "/api/estado").paraEstado() }.atribuicoes.first { it.id == outra.id }
        org.junit.Assert.assertTrue("enviada e concluída", comFoto.foto && comFoto.feito)
        compose.onNodeWithContentDescription("Voltar").performClick(); compose.waitForIdle()

        // Iniciar (opcional): ▶ na linha → "em andamento"; concluir mostra quanto levou; desligar esconde o botão.
        val eI = kotlinx.coroutines.runBlocking { api.chamar("GET", "/api/estado").paraEstado() }
        val inic = eI.atribuicoes.first { it.membroId == eI.euId && it.dia == eI.hoje && it.pendente }
        compose.onNodeWithContentDescription("Iniciar ${inic.tarefa}").performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("em andamento", substring = true).fetchSemanticsNodes().isNotEmpty() }
        org.junit.Assert.assertNotNull(kotlinx.coroutines.runBlocking { api.chamar("GET", "/api/estado").paraEstado() }.atribuicoes.first { it.id == inic.id }.iniciadaEm)
        compose.onAllNodesWithText(inic.tarefa)[0].performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithText("Em andamento desde", substring = true).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Concluir").performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("Feita · levou", substring = true).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription("Voltar").performClick(); compose.waitForIdle()
        compose.onAllNodesWithText("Casa")[0].performClick(); compose.waitForIdle()
        compose.onNode(androidx.compose.ui.test.hasScrollToNodeAction()).performScrollToNode(hasText("Botão Iniciar nas tarefas"))
        tela!!.onActivity { act -> androidx.lifecycle.ViewModelProvider(act)[CasaViewModel::class.java].escolherMostrarIniciar(false) }
        compose.onAllNodesWithText("Hoje")[0].performClick(); compose.waitForIdle()
        org.junit.Assert.assertTrue(compose.onAllNodesWithContentDescription("Iniciar", substring = true).fetchSemanticsNodes().isEmpty())
        tela!!.onActivity { act -> androidx.lifecycle.ViewModelProvider(act)[CasaViewModel::class.java].escolherMostrarIniciar(true) }

        // Imprimir: abre pela barra, troca as opções e confere o endereço que a pré-visualização carregou.
        compose.onNodeWithContentDescription("Imprimir semana").performClick(); compose.waitForIdle()
        compose.onNodeWithText("Lista por dia").performClick()
        compose.onAllNodesWithText("Teste")[0].performClick()
        compose.onNodeWithText("Já marcar as feitas").assertExists()
        compose.waitForIdle()
        var carregado: String? = null; var cabecalhos: Map<String, String>? = null
        tela!!.onActivity { act ->
            fun acha(v: android.view.View): android.webkit.WebView? = v as? android.webkit.WebView
                ?: (v as? android.view.ViewGroup)?.let { g -> (0 until g.childCount).firstNotNullOfOrNull { acha(g.getChildAt(it)) } }
            val w = acha(act.window.decorView)!!
            carregado = org.robolectric.Shadows.shadowOf(w).lastLoadedUrl
            cabecalhos = org.robolectric.Shadows.shadowOf(w).lastAdditionalHttpHeaders
        }
        val eu = kotlinx.coroutines.runBlocking { api.chamar("GET", "/api/estado").paraEstado() }.euId
        org.junit.Assert.assertTrue(carregado, carregado!!.endsWith("/painel/imprimir?formato=dia&pessoa=$eu&feitas=1"))
        org.junit.Assert.assertTrue(cabecalhos!!["Authorization"]!!.startsWith("Bearer "))
        compose.onNodeWithContentDescription("Voltar").performClick(); compose.waitForIdle()

        // TV: abre /tv como a TV faria, lê o código e conecta pelo app.
        val servidor = System.getenv("CASA_SERVIDOR")!!
        val tv = java.net.URL("$servidor/tv").openConnection() as java.net.HttpURLConnection
        val pagina = tv.inputStream.bufferedReader().readText()
        val cookieTv = tv.getHeaderField("Set-Cookie").substringBefore(";")
        val codigo = Regex("aria-label=\"Código ([A-Z0-9 ]+)\"").find(pagina)!!.groupValues[1].replace(" ", "")
        compose.onAllNodesWithText("Casa")[0].performClick(); compose.waitForIdle()
        compose.onNode(androidx.compose.ui.test.hasScrollToNodeAction()).performScrollToNode(hasText("Conectar TV"))
        compose.onNodeWithText("Conectar TV").performClick()
        compose.onNode(hasSetTextAction() and hasText("Código da TV")).performTextInput(codigo.lowercase())
        compose.onNodeWithText("Conectar").performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("1 TV conectada").fetchSemanticsNodes().isNotEmpty() }
        val estadoTv = (java.net.URL("$servidor/tv/estado").openConnection() as java.net.HttpURLConnection).apply { setRequestProperty("Cookie", cookieTv) }
        org.junit.Assert.assertTrue(estadoTv.inputStream.bufferedReader().readText().contains("\"pronto\":true"))
    }
}
