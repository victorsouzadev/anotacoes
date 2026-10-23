package com.organizador.dieta.ui

import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Restaurant
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument

private data class Aba(val rota: String, val nome: String, val icone: ImageVector)

private val ABAS = listOf(
    Aba("hoje", "Hoje", Icons.Filled.Restaurant),
    Aba("chat", "IA", Icons.Filled.Forum),
    Aba("progresso", "Progresso", Icons.Filled.EmojiEvents),
    Aba("fotos", "Fotos", Icons.Filled.PhotoLibrary),
    Aba("mais", "Mais", Icons.Filled.Menu),
)

@Composable
fun DietaApp(vm: DietaViewModel = viewModel(), abrir: kotlinx.coroutines.flow.MutableStateFlow<String?>? = null) {
    val tema by vm.tema.collectAsStateWithLifecycle()
    DietaTema(tema) {
        val nav = rememberNavController()
        val snack = remember { SnackbarHostState() }
        val aviso by vm.aviso.collectAsStateWithLifecycle()
        LaunchedEffect(aviso) {
            aviso?.let { snack.showSnackbar(it); vm.aviso.value = null }
        }
        // Atalho de widget: volta para hoje e abre o destino pedido (foto/x abre o adicionar com a câmera).
        val destino = abrir?.collectAsStateWithLifecycle()?.value
        LaunchedEffect(destino) {
            val d = destino ?: return@LaunchedEffect
            abrir.value = null
            vm.dia.value = com.organizador.dieta.data.Datas.hoje()
            val rota = if (d.startsWith("foto/")) "adicionar/${d.removePrefix("foto/")}?camera=true" else d
            nav.navigate(rota) {
                popUpTo(nav.graph.findStartDestination().id) { saveState = d in ABAS.map { it.rota } }
                launchSingleTop = true
            }
        }
        val atual = nav.currentBackStackEntryAsState().value?.destination?.route
        Scaffold(
            snackbarHost = { SnackbarHost(snack) },
            bottomBar = {
                if (ABAS.any { it.rota == atual }) NavigationBar {
                    ABAS.forEach { aba ->
                        NavigationBarItem(
                            selected = atual == aba.rota,
                            onClick = {
                                nav.navigate(aba.rota) {
                                    popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = { Icon(aba.icone, null) },
                            label = { Text(aba.nome, style = androidx.compose.material3.MaterialTheme.typography.labelMedium, maxLines = 1, softWrap = false, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis) },
                        )
                    }
                }
            },
        ) { pad ->
            // consumeWindowInsets: a barra de baixo já ocupa parte da altura do teclado; sem isso o imePadding do chat
            // soma as duas e sobra um vão entre o campo de texto e o teclado.
            NavHost(nav, startDestination = "hoje", modifier = Modifier.padding(pad).consumeWindowInsets(pad)) {
                composable("hoje") { HojeTela(vm, adicionar = { r -> nav.navigate("adicionar/$r") }) }
                composable("adicionar/{refeicao}?camera={camera}", listOf(
                    navArgument("refeicao") { type = NavType.StringType },
                    navArgument("camera") { type = NavType.BoolType; defaultValue = false },
                )) {
                    AdicionarTela(vm, it.arguments?.getString("refeicao") ?: "almoco", voltar = { nav.popBackStack() },
                        novoAlimento = { nav.navigate("alimento/novo") }, abrirCamera = it.arguments?.getBoolean("camera") == true)
                }
                composable("chat") { ChatTela(vm) }
                composable("progresso") { ProgressoTela(vm) }
                composable("fotos") { FotosTela(vm) }
                composable("mais") { MaisTela(vm, ir = { nav.navigate(it) }) }
                composable("perfil") { PerfilTela(vm, voltar = { nav.popBackStack() }) }
                composable("plano") {
                    PlanoTela(vm, voltar = { nav.popBackStack() }, entrevista = {
                        vm.iniciarEntrevista()
                        nav.navigate("chat") {
                            popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                            launchSingleTop = true
                        }
                    })
                }
                composable("alimentos") { MeusAlimentosTela(vm, voltar = { nav.popBackStack() }, editar = { id -> nav.navigate("alimento/$id") }) }
                composable("alimento/{id}", listOf(navArgument("id") { type = NavType.StringType })) {
                    AlimentoTela(vm, it.arguments?.getString("id") ?: "novo", voltar = { nav.popBackStack() })
                }
                composable("compartilhar") { CompartilharTela(vm, voltar = { nav.popBackStack() }) }
                composable("conta") { ContaTela(vm, voltar = { nav.popBackStack() }) }
            }
        }
    }
}
