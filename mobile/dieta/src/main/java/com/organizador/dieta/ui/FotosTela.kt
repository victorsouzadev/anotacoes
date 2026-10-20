package com.organizador.dieta.ui

import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.organizador.dieta.data.Datas
import com.organizador.dieta.data.Foto
import com.organizador.dieta.data.nomeRefeicao
import java.io.File
import java.time.LocalDate
import java.time.format.DateTimeFormatter

private val POSES = listOf("frente" to "Frente", "lado" to "Lado", "costas" to "Costas")
private val dd = DateTimeFormatter.ofPattern("dd/MM/yy")

/** Galeria de fotos (refeições e progresso corporal), com comparação lado a lado de duas fotos. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun FotosTela(vm: DietaViewModel) {
    val refeicoes by vm.fotosRefeicao.collectAsStateWithLifecycle()
    val corpo by vm.fotosCorpo.collectAsStateWithLifecycle()
    var aba by remember { mutableStateOf(1) }
    var pose by remember { mutableStateOf("frente") }
    var aberta by remember { mutableStateOf<Foto?>(null) }
    var apagar by remember { mutableStateOf<Foto?>(null) }
    val comparar = remember { mutableStateListOf<Foto>() }
    var comparando by remember { mutableStateOf(false) }
    val pedirFoto = rememberFoto { uri -> vm.foto(uri, Datas.hoje(), "corpo", pose) }

    Column(Modifier.fillMaxSize()) {
        TabRow(aba) {
            Tab(aba == 0, { aba = 0 }, text = { Text("Refeições") })
            Tab(aba == 1, { aba = 1 }, text = { Text("Progresso corporal") })
        }
        val lista = if (aba == 0) refeicoes else corpo
        if (aba == 1) {
            Column(Modifier.padding(16.dp)) {
                Sub("Fotos privadas: só aparecem num link se você liberar \"fotos de progresso\" ao compartilhar.")
                Spacer(Modifier.height(8.dp))
                Escolha(POSES, pose) { pose = it }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                    Button(onClick = { pedirFoto(true) }) { Text("Tirar foto") }
                    BotaoSecundario(onClick = { pedirFoto(false) }) { Text("Da galeria") }
                    if (comparar.size == 2) Button(onClick = { comparando = true }) { Text("Comparar") }
                }
                Sub(if (comparar.isEmpty()) "Toque e segure em duas fotos para comparar." else "${comparar.size}/2 selecionadas")
            }
        } else if (lista.isEmpty()) {
            Sub("As fotos tiradas na tela Hoje (ícone de câmera de cada refeição) aparecem aqui.", Modifier.padding(16.dp))
        }
        LazyVerticalGrid(GridCells.Adaptive(110.dp), Modifier.padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)) {
            items(lista, key = { it.id }) { f ->
                val marcada = f in comparar
                Column(Modifier.combinedClickable(
                    onClick = { aberta = f },
                    onLongClick = {
                        if (aba == 1) { if (marcada) comparar.remove(f) else if (comparar.size < 2) comparar.add(f) } else apagar = f
                    },
                )) {
                    AsyncImage(File(f.caminho), null, Modifier.fillMaxWidth().aspectRatio(if (aba == 1) 0.75f else 1f).clip(RoundedCornerShape(8.dp)),
                        contentScale = ContentScale.Crop, alpha = if (f.caminho.isEmpty()) 0.3f else 1f)
                    Text(
                        (if (marcada) "✓ " else "") + LocalDate.parse(f.data).format(dd) + (f.rotulo?.let { " · " + rotulo(it) } ?: ""),
                        style = MaterialTheme.typography.labelSmall, fontWeight = if (marcada) FontWeight.Bold else null,
                    )
                }
            }
        }
    }

    aberta?.let { f ->
        Dialog(onDismissRequest = { aberta = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                AsyncImage(File(f.caminho), null, Modifier.fillMaxWidth(), contentScale = ContentScale.Fit)
                Row {
                    BotaoTexto(onClick = { apagar = f; aberta = null }, cor = grafite.negativo) { Text("Apagar") }
                    BotaoTexto(onClick = { aberta = null }) { Text("Fechar") }
                }
            }
        }
    }
    if (comparando && comparar.size == 2) {
        val (a, b) = comparar.sortedBy { it.data }
        Dialog(onDismissRequest = { comparando = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Column(Modifier.padding(8.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    listOf(a, b).forEach { f ->
                        Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                            AsyncImage(File(f.caminho), null, Modifier.fillMaxWidth().aspectRatio(0.75f), contentScale = ContentScale.Crop)
                            Text(LocalDate.parse(f.data).format(dd), style = MaterialTheme.typography.titleSmall)
                        }
                    }
                }
                val dias = LocalDate.parse(b.data).toEpochDay() - LocalDate.parse(a.data).toEpochDay()
                Text("$dias dias de diferença", Modifier.padding(8.dp))
                BotaoTexto(onClick = { comparando = false; comparar.clear() }) { Text("Fechar") }
            }
        }
    }
    apagar?.let { f ->
        AlertDialog(
            onDismissRequest = { apagar = null },
            title = { Text("Apagar foto?") },
            text = { Text("Ela sai deste aparelho e do servidor.") },
            confirmButton = { BotaoTexto(onClick = { comparar.remove(f); vm.lancar { vm.repo.apagarFoto(f) }; apagar = null }, cor = grafite.negativo) { Text("Apagar") } },
            dismissButton = { BotaoTexto(onClick = { apagar = null }) { Text("Cancelar") } },
        )
    }
}

private fun rotulo(r: String) = POSES.firstOrNull { it.first == r }?.second ?: nomeRefeicao(r)
