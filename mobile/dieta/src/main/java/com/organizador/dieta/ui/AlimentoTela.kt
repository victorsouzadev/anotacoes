package com.organizador.dieta.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.organizador.dieta.data.Alimento
import com.organizador.dieta.data.Calculos
import com.organizador.dieta.data.objetos
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

@Composable
fun MeusAlimentosTela(vm: DietaViewModel, voltar: () -> Unit, editar: (String) -> Unit) {
    val meus by vm.meusAlimentos.collectAsStateWithLifecycle()
    Scaffold(topBar = {
        TopAppBar(
            title = { Text("Meus alimentos e receitas") },
            navigationIcon = { IconButton(onClick = voltar) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Voltar") } },
            actions = { IconButton(onClick = { editar("novo") }) { Icon(Icons.Filled.Add, "Novo") } },
        )
    }) { pad ->
        LazyColumn(Modifier.padding(pad)) {
            if (meus.isEmpty()) item { Sub("Nenhum ainda. Cadastre alimentos, receitas, ou favorite itens da TACO na busca.", Modifier.padding(16.dp)) }
            items(meus, key = { it.id }) { a ->
                Column(Modifier.fillMaxWidth().clickable { editar(a.id) }.padding(16.dp)) {
                    Text((if (a.favorito) "★ " else "") + a.nome)
                    Sub("100 g: ${fmt(a.kcal)} kcal · P ${fmt(a.proteina)} · C ${fmt(a.carbo)} · G ${fmt(a.gordura)}" + if (a.fonte == "receita") " · receita" else "")
                }
                HorizontalDivider()
            }
        }
    }
}

/** Cadastro manual (valores por 100 g) ou receita (itens + gramas; os valores são calculados). */
@Composable
fun AlimentoTela(vm: DietaViewModel, id: String, voltar: () -> Unit) {
    val alimentos by vm.alimentos.collectAsStateWithLifecycle()
    // "novo" pode vir preenchido com o que a IA leu de uma tabela nutricional (vm.rascunho); só é usado uma vez.
    val rascunho = remember(id) { if (id == "novo") vm.rascunho.also { vm.rascunho = null } else null }
    val original = remember(id) { alimentos.firstOrNull { it.id == id } }
    var receita by remember { mutableStateOf(original?.fonte == "receita") }
    var nome by remember { mutableStateOf(original?.nome ?: rascunho?.nome ?: "") }
    val campos = remember {
        mutableStateListOf(
            *(original ?: rascunho).let { b -> listOf(b?.kcal, b?.proteina, b?.carbo, b?.gordura, b?.fibra, b?.sodio) }
                .map { it?.let(::fmt) ?: "" }.toTypedArray(),
        )
    }
    var porcaoNome by remember { mutableStateOf(original?.porcaoNome ?: rascunho?.porcaoNome ?: "") }
    var porcaoG by remember { mutableStateOf((original ?: rascunho)?.porcaoG?.let(::fmt) ?: "100") }
    var codigo by remember { mutableStateOf(original?.codigoBarras ?: "") }
    val itens = remember {
        mutableStateListOf<Pair<Alimento, Double>>().apply {
            runCatching { JSONArray(original?.itens ?: "[]").objetos() }.getOrDefault(emptyList()).forEach { j ->
                alimentos.firstOrNull { it.id == j.getString("alimentoId") }?.let { add(it to j.getDouble("gramas")) }
            }
        }
    }
    var buscando by remember { mutableStateOf(false) }
    var gramasDe by remember { mutableStateOf<Alimento?>(null) }

    fun n(s: String) = s.replace(',', '.').toDoubleOrNull()
    val valido = nome.isNotBlank() && (n(porcaoG) ?: 0.0) > 0 &&
        if (receita) itens.isNotEmpty() else n(campos[0]) != null && campos.take(4).all { it.isBlank() || n(it) != null }

    Scaffold(topBar = {
        TopAppBar(
            title = { Text(if (original == null) "Novo alimento" else "Editar") },
            navigationIcon = { IconButton(onClick = voltar) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Voltar") } },
            actions = {
                if (original != null) IconButton(onClick = { vm.lancar { vm.repo.apagarAlimento(original) }; voltar() }) { Icon(Icons.Filled.Delete, "Excluir") }
            },
        )
    }) { pad ->
        Column(Modifier.padding(pad).padding(16.dp).verticalScroll(rememberScrollState())) {
            Escolha(listOf(false to "Alimento", true to "Receita"), receita) { receita = it }
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(nome, { nome = it }, Modifier.fillMaxWidth(), label = { Text("Nome") }, singleLine = true)
            if (receita) {
                Spacer(Modifier.height(12.dp))
                Titulo("Ingredientes")
                itens.forEachIndexed { i, (a, g) ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("${a.nome} — ${fmt(g)} g", Modifier.weight(1f))
                        IconButton(onClick = { itens.removeAt(i) }) { Icon(Icons.Filled.Close, "Remover") }
                    }
                }
                BotaoSecundario(onClick = { buscando = true }) { Text("Adicionar ingrediente") }
                if (itens.isNotEmpty()) {
                    val total = itens.sumOf { it.second }
                    val kcal = itens.sumOf { (a, g) -> Calculos.porcao(a, g).kcal }
                    Sub("Total ${fmt(total)} g · ${fmt(kcal)} kcal · ${fmt(kcal / total * 100)} kcal por 100 g")
                }
            } else {
                Spacer(Modifier.height(8.dp))
                Sub("Valores por 100 g")
                listOf("Calorias (kcal)", "Proteína (g)", "Carboidrato (g)", "Gordura (g)", "Fibra (g)", "Sódio (mg)").forEachIndexed { i, rot ->
                    OutlinedTextField(campos[i], { campos[i] = it }, Modifier.fillMaxWidth(), label = { Text(rot) }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                }
                OutlinedTextField(codigo, { codigo = it.filter(Char::isDigit) }, Modifier.fillMaxWidth(), label = { Text("Código de barras (opcional)") },
                    singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
            }
            Spacer(Modifier.height(8.dp))
            Row {
                OutlinedTextField(porcaoNome, { porcaoNome = it }, Modifier.weight(1f), label = { Text("Porção (ex.: 1 fatia)") }, singleLine = true)
                Spacer(Modifier.padding(4.dp))
                OutlinedTextField(porcaoG, { porcaoG = it }, Modifier.weight(1f), label = { Text("Gramas da porção") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
            }
            Spacer(Modifier.height(16.dp))
            Button(enabled = valido, modifier = Modifier.fillMaxWidth(), onClick = {
                val base = original ?: Alimento(UUID.randomUUID().toString(), "", 0.0, 0.0, 0.0, 0.0)
                val novo = base.copy(
                    nome = nome.trim(),
                    kcal = n(campos[0]) ?: 0.0, proteina = n(campos[1]) ?: 0.0, carbo = n(campos[2]) ?: 0.0,
                    gordura = n(campos[3]) ?: 0.0, fibra = n(campos[4]) ?: 0.0, sodio = n(campos[5]) ?: 0.0,
                    porcaoNome = porcaoNome.trim().ifBlank { null }, porcaoG = n(porcaoG) ?: 100.0,
                    codigoBarras = codigo.ifBlank { null },
                    fonte = if (receita) "receita" else if (base.fonte == "off") "off" else "manual",
                    itens = if (receita) JSONArray(itens.map { (a, g) -> JSONObject().put("alimentoId", a.id).put("nome", a.nome).put("gramas", g) }).toString() else null,
                )
                vm.lancar { vm.repo.salvarAlimento(novo) }
                voltar()
            }) { Text("Salvar") }
        }
    }

    if (buscando) {
        ModalBottomSheet(onDismissRequest = { buscando = false }) {
            BuscaAlimento(vm, Modifier.fillMaxHeight(0.85f)) { gramasDe = it; buscando = false }
        }
    }
    gramasDe?.let { a ->
        QuantidadeDialog(a, aoConfirmar = { g -> itens.add(a to g); gramasDe = null }, aoFechar = { gramasDe = null })
    }
}
