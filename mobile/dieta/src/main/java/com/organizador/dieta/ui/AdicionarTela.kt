package com.organizador.dieta.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.organizador.dieta.data.Alimento
import com.organizador.dieta.data.Calculos
import com.organizador.dieta.data.nomeRefeicao

@Composable
fun AdicionarTela(vm: DietaViewModel, refeicao: String, voltar: () -> Unit, novoAlimento: () -> Unit) {
    val dia by vm.dia.collectAsStateWithLifecycle()
    var escolhido by remember { mutableStateOf<Alimento?>(null) }
    Scaffold(topBar = {
        TopAppBar(
            title = { Text("Adicionar ao ${nomeRefeicao(refeicao).lowercase()}") },
            navigationIcon = { IconButton(onClick = voltar) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Voltar") } },
            actions = { IconButton(onClick = novoAlimento) { Icon(Icons.Filled.Add, "Novo alimento") } },
        )
    }) { pad ->
        BuscaAlimento(vm, Modifier.padding(pad)) { escolhido = it }
    }
    escolhido?.let { a ->
        QuantidadeDialog(a, aoConfirmar = { g ->
            vm.lancar { vm.repo.registrar(dia, refeicao, a, g) }
            vm.avisar("${a.nome} adicionado.")
            escolhido = null
        }, aoFechar = { escolhido = null })
    }
}

/** Busca na TACO e nos alimentos próprios, recentes quando vazia, e leitura de código de barras. */
@Composable
fun BuscaAlimento(vm: DietaViewModel, modifier: Modifier = Modifier, aoEscolher: (Alimento) -> Unit) {
    val context = LocalContext.current
    val alimentos by vm.alimentos.collectAsStateWithLifecycle()
    val recentes by vm.recentes.collectAsStateWithLifecycle()
    var busca by remember { mutableStateOf("") }

    val lista = remember(busca, alimentos, recentes) {
        if (busca.isBlank()) {
            val porId = alimentos.associateBy { it.id }
            val usados = recentes.mapNotNull { it.alimentoId }.distinct().mapNotNull { porId[it] }
            (alimentos.filter { it.favorito } + usados + alimentos.filter { it.proprio }).distinctBy { it.id }.take(60)
        } else {
            alimentos.filter { Calculos.combina(it.nome, busca) }
                .sortedWith(compareByDescending<Alimento> { it.favorito }.thenByDescending { it.proprio }
                    .thenBy { if (Calculos.semAcento(it.nome).startsWith(Calculos.semAcento(busca).trim())) 0 else 1 }
                    .thenBy { it.nome.length })
                .take(80)
        }
    }

    Column(modifier.fillMaxSize()) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = busca, onValueChange = { busca = it }, singleLine = true, modifier = Modifier.weight(1f),
                placeholder = { Text("Buscar alimento (ex.: frango grelhado)") }, leadingIcon = { Icon(Icons.Filled.Search, null) },
            )
            IconButton(onClick = {
                GmsBarcodeScanning.getClient(context).startScan()
                    .addOnSuccessListener { b -> b.rawValue?.let { vm.buscarCodigo(it, aoEscolher) } }
                    .addOnFailureListener { vm.avisar("Leitor de código indisponível: ${it.message}") }
            }) { Icon(Icons.Filled.QrCodeScanner, "Ler código de barras") }
        }
        if (busca.isBlank()) Sub("Favoritos, recentes e seus alimentos", Modifier.padding(horizontal = 16.dp))
        LazyColumn {
            items(lista, key = { it.id }) { a ->
                Row(Modifier.fillMaxWidth().clickable { aoEscolher(a) }.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(a.nome)
                        Sub("100 g: ${fmt(a.kcal)} kcal · P ${fmt(a.proteina)} · C ${fmt(a.carbo)} · G ${fmt(a.gordura)}" +
                            (if (a.fonte == "taco") " · TACO" else if (a.fonte == "receita") " · receita" else ""))
                    }
                    IconButton(onClick = { vm.lancar { vm.repo.alternarFavorito(a) } }) {
                        Icon(if (a.favorito) Icons.Filled.Star else Icons.Filled.StarBorder, "Favorito")
                    }
                }
                HorizontalDivider()
            }
            if (lista.isEmpty() && busca.isNotBlank()) item { Sub("Nada encontrado. Use + para cadastrar.", Modifier.padding(16.dp)) }
        }
    }
}
