package com.organizador.dieta.ui

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
fun DietaApp(vm: DietaViewModel = viewModel()) {
    val tema by vm.tema.collectAsStateWithLifecycle()
    DietaTema(tema) {
        val nav = rememberNavController()
        val snack = remember { SnackbarHostState() }
        val aviso by vm.aviso.collectAsStateWithLifecycle()
        LaunchedEffect(aviso) {
            aviso?.let { snack.showSnackbar(it); vm.aviso.value = null }
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
            NavHost(nav, startDestination = "hoje", modifier = Modifier.padding(pad)) {
                composable("hoje") { HojeTela(vm, adicionar = { r -> nav.navigate("adicionar/$r") }) }
                composable("adicionar/{refeicao}", listOf(navArgument("refeicao") { type = NavType.StringType })) {
                    AdicionarTela(vm, it.arguments?.getString("refeicao") ?: "almoco", voltar = { nav.popBackStack() },
                        novoAlimento = { nav.navigate("alimento/novo") })
                }
                composable("chat") { ChatTela(vm) }
                composable("progresso") { ProgressoTela(vm) }
                composable("fotos") { FotosTela(vm) }
                composable("mais") { MaisTela(vm, ir = { nav.navigate(it) }) }
                composable("perfil") { PerfilTela(vm, voltar = { nav.popBackStack() }) }
                composable("plano") { PlanoTela(vm, voltar = { nav.popBackStack() }) }
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
