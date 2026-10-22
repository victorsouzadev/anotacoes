package com.organizador.dieta.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
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
    val pensando by vm.pensando.collectAsStateWithLifecycle()
    var escolhido by remember { mutableStateOf<Alimento?>(null) }
    var menuIa by remember { mutableStateOf(false) }
    var modoFoto by remember { mutableStateOf("prato") }
    var descrevendo by remember { mutableStateOf(false) }
    var reconhecidos by remember { mutableStateOf<List<ItemIa>?>(null) }
    var produto by remember { mutableStateOf<ProdutoIa?>(null) }
    val aoRotulo: (ProdutoIa) -> Unit = { produto = it }
    val pedirFoto = rememberFoto { uri -> vm.reconhecer(modoFoto, null, uri, { reconhecidos = it }, aoRotulo) }

    Scaffold(topBar = {
        TopAppBar(
            title = { Text("Adicionar ao ${nomeRefeicao(refeicao).lowercase()}") },
            navigationIcon = { IconButton(onClick = voltar) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Voltar") } },
            actions = {
                Box {
                    IconButton(onClick = { menuIa = true }, enabled = !pensando) { Icon(Icons.Filled.AutoAwesome, "Reconhecer com IA") }
                    DropdownMenu(menuIa, onDismissRequest = { menuIa = false }) {
                        DropdownMenuItem(text = { Text("Foto do prato") }, onClick = { menuIa = false; modoFoto = "prato"; pedirFoto(true) })
                        DropdownMenuItem(text = { Text("Prato da galeria") }, onClick = { menuIa = false; modoFoto = "prato"; pedirFoto(false) })
                        DropdownMenuItem(text = { Text("Descrever o que comi") }, onClick = { menuIa = false; descrevendo = true })
                        DropdownMenuItem(text = { Text("Foto da embalagem") }, onClick = { menuIa = false; modoFoto = "embalagem"; pedirFoto(true) })
                        DropdownMenuItem(text = { Text("Embalagem da galeria") }, onClick = { menuIa = false; modoFoto = "embalagem"; pedirFoto(false) })
                    }
                }
                IconButton(onClick = novoAlimento) { Icon(Icons.Filled.Add, "Novo alimento") }
            },
        )
    }) { pad ->
        Column(Modifier.padding(pad)) {
            if (pensando) LinearProgressIndicator(Modifier.fillMaxWidth(), color = grafite.grafiteSuave, trackColor = grafite.linha)
            BuscaAlimento(vm) { escolhido = it }
        }
    }
    escolhido?.let { a ->
        QuantidadeDialog(a, aoConfirmar = { g ->
            vm.lancar { vm.repo.registrar(dia, refeicao, a, g) }
            vm.avisar("${a.nome} adicionado.")
            escolhido = null
        }, aoFechar = { escolhido = null })
    }
    if (descrevendo) {
        var texto by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { descrevendo = false },
            title = { Text("O que você comeu?") },
            text = {
                OutlinedTextField(texto, { texto = it }, Modifier.fillMaxWidth(), minLines = 3,
                    placeholder = { Text("Ex.: 2 ovos mexidos, 1 pão francês e café com leite") })
            },
            confirmButton = {
                BotaoTexto(enabled = texto.isNotBlank(), cor = grafite.nanquim, onClick = {
                    descrevendo = false
                    vm.reconhecer("texto", texto, null, { reconhecidos = it }, aoRotulo)
                }) { Text("Reconhecer") }
            },
            dismissButton = { BotaoTexto(onClick = { descrevendo = false }) { Text("Cancelar") } },
        )
    }
    produto?.let { p ->
        ProdutoDialog(p,
            aoRegistrar = { g -> vm.registrarProduto(refeicao, p.alimento, g); produto = null },
            aoEditar = { vm.rascunho = p.alimento; produto = null; novoAlimento() },
            aoFechar = { produto = null })
    }
    reconhecidos?.let { itens ->
        ReconhecidosDialog(itens, aoConfirmar = { vm.registrarItens(refeicao, it); reconhecidos = null }, aoFechar = { reconhecidos = null })
    }
}

/** Produto lido da embalagem: mostra de onde vieram os valores e registra com um toque (1 embalagem por padrão). */
@Composable
private fun ProdutoDialog(p: ProdutoIa, aoRegistrar: (Double) -> Unit, aoEditar: () -> Unit, aoFechar: () -> Unit) {
    val a = p.alimento
    var emPorcao by remember { mutableStateOf(a.porcaoNome != null) }
    var texto by remember { mutableStateOf(if (emPorcao) "1" else fmt(a.porcaoG)) }
    val n = texto.replace(',', '.').toDoubleOrNull()
    val gramas = n?.let { if (emPorcao) it * a.porcaoG else it }
    AlertDialog(
        onDismissRequest = aoFechar,
        title = { Text(a.nome) },
        text = {
            Column {
                Sub(when (p.fonte) {
                    "openfoodfacts" -> "Valores da Open Food Facts (achado pela marca ou pelo código de barras)."
                    "rotulo" -> "Valores lidos da tabela nutricional da foto."
                    else -> "Tabela não visível: valores estimados pela IA para esse tipo de produto. Confira ou edite."
                })
                Spacer(Modifier.height(8.dp))
                Text("100 g: ${fmt(a.kcal)} kcal · P ${fmt(a.proteina)} · C ${fmt(a.carbo)} · G ${fmt(a.gordura)}", style = EstiloValor)
                Spacer(Modifier.height(8.dp))
                if (a.porcaoNome != null) Escolha(listOf(true to "${a.porcaoNome} (${fmt(a.porcaoG)} g)", false to "gramas"), emPorcao) {
                    texto = if (it) "1" else fmt(a.porcaoG); emPorcao = it
                }
                OutlinedTextField(texto, { texto = it }, Modifier.fillMaxWidth(), singleLine = true,
                    label = { Text(if (emPorcao) "Quantidade" else "Gramas") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                if (gramas != null && gramas > 0) Sub("${fmt(gramas)} g · ${Calculos.porcao(a, gramas).kcal.toInt()} kcal")
            }
        },
        confirmButton = {
            BotaoTexto(enabled = gramas != null && gramas in 1.0..5000.0, cor = grafite.nanquim, onClick = { aoRegistrar(gramas!!) }) { Text("Registrar") }
        },
        dismissButton = {
            Row {
                BotaoTexto(onClick = aoEditar) { Text("Editar dados") }
                BotaoTexto(onClick = aoFechar) { Text("Cancelar") }
            }
        },
    )
}

/** Confere o que a IA reconheceu: marca o que entra e ajusta as gramas antes de registrar. */
@Composable
private fun ReconhecidosDialog(itens: List<ItemIa>, aoConfirmar: (List<Pair<ItemIa, Double>>) -> Unit, aoFechar: () -> Unit) {
    val marcados = remember { mutableStateListOf(*itens.map { true }.toTypedArray()) }
    val gramas = remember { mutableStateListOf(*itens.map { fmt(it.gramas) }.toTypedArray()) }
    AlertDialog(
        onDismissRequest = aoFechar,
        title = { Text("Reconhecido pela IA") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Sub("Confira as quantidades. Itens sem correspondência na TACO usam a estimativa da IA.")
                itens.forEachIndexed { i, it ->
                    val g = gramas[i].replace(',', '.').toDoubleOrNull() ?: 0.0
                    val base = it.alimento ?: it.estimativa
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
                        Checkbox(marcados[i], { v -> marcados[i] = v })
                        Column(Modifier.weight(1f)) {
                            Text(it.alimento?.nome ?: it.nome)
                            Sub((if (it.alimento == null) "estimativa · " else "") + "${Calculos.porcao(base, g).kcal.toInt()} kcal")
                        }
                        OutlinedTextField(gramas[i], { v -> gramas[i] = v }, Modifier.width(84.dp), singleLine = true, suffix = { Text("g") },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                    }
                }
            }
        },
        confirmButton = {
            val escolhidos = itens.indices.filter { marcados[it] }.mapNotNull { i ->
                gramas[i].replace(',', '.').toDoubleOrNull()?.takeIf { it in 1.0..5000.0 }?.let { itens[i] to it }
            }
            BotaoTexto(enabled = escolhidos.isNotEmpty(), cor = grafite.nanquim, onClick = { aoConfirmar(escolhidos) }) { Text("Registrar") }
        },
        dismissButton = { BotaoTexto(onClick = aoFechar) { Text("Cancelar") } },
    )
}

/** Busca na TACO e nos alimentos próprios, recentes quando vazia, e leitura de código de barras. */
@Composable
fun BuscaAlimento(vm: DietaViewModel, modifier: Modifier = Modifier, aoEscolher: (Alimento) -> Unit) {
    val context = LocalContext.current
    val alimentos by vm.alimentos.collectAsStateWithLifecycle()
    val recentes by vm.recentes.collectAsStateWithLifecycle()
    var busca by remember { mutableStateOf("") }
    val produtos by vm.produtos.collectAsStateWithLifecycle()
    val buscandoProdutos by vm.buscandoProdutos.collectAsStateWithLifecycle()
    // Espera a pessoa parar de digitar antes de consultar a Open Food Facts.
    androidx.compose.runtime.LaunchedEffect(busca) {
        kotlinx.coroutines.delay(600)
        vm.buscarProdutos(busca)
    }
    val escolher: (Alimento) -> Unit = { a -> vm.lancar { aoEscolher(vm.garantirSalvo(a)) } }

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
                    .addOnSuccessListener { b -> b.rawValue?.let { vm.buscarCodigo(it, escolher) } }
                    .addOnFailureListener { vm.avisar("Leitor de código indisponível: ${it.message}") }
            }) { Icon(Icons.Filled.QrCodeScanner, "Ler código de barras") }
        }
        if (busca.isBlank()) Sub("Favoritos, recentes e seus alimentos", Modifier.padding(horizontal = 16.dp))
        LazyColumn {
            items(lista, key = { it.id }) { a ->
                Row(Modifier.fillMaxWidth().clickable { escolher(a) }.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
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
            // Produtos industrializados: só os que ainda não estão salvos no aparelho (mesmo código de barras).
            val codigos = alimentos.mapNotNull { it.codigoBarras }.toSet()
            val novos = if (busca.isBlank()) emptyList() else produtos.filter { it.codigoBarras !in codigos }
            if (novos.isNotEmpty() || buscandoProdutos) item {
                Sub(if (buscandoProdutos) "Procurando produtos industrializados…" else "Produtos industrializados (Open Food Facts)",
                    Modifier.padding(start = 16.dp, top = 16.dp, end = 16.dp, bottom = 4.dp))
            }
            items(novos, key = { it.id }) { a ->
                Column(Modifier.fillMaxWidth().clickable { escolher(a) }.padding(horizontal = 16.dp, vertical = 10.dp)) {
                    Text(a.nome)
                    Sub("100 g: ${fmt(a.kcal)} kcal · P ${fmt(a.proteina)} · C ${fmt(a.carbo)} · G ${fmt(a.gordura)}" +
                        (a.porcaoNome?.let { " · $it = ${fmt(a.porcaoG)} g" } ?: ""))
                }
                HorizontalDivider()
            }
            if (lista.isEmpty() && novos.isEmpty() && !buscandoProdutos && busca.isNotBlank()) item {
                Sub("Nada encontrado. Tire uma foto da embalagem (botão de IA, no alto) ou use + para cadastrar.", Modifier.padding(16.dp))
            }
        }
    }
}
