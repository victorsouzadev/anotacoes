package com.casa.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale

private val Verde = Color(0xFF2E7D5B)

class MainActivity : ComponentActivity() {
    private val vm: CasaViewModel by viewModels()
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(colorScheme = lightColorScheme(primary = Verde, secondary = Color(0xFF5B8C74))) {
                Surface(Modifier.fillMaxSize()) { if (vm.logado && vm.estado != null) Principal(vm) else if (vm.logado) Carregando(vm) else Boas_vindas(vm) }
            }
        }
    }
    override fun onResume() { super.onResume(); if (vm.logado) vm.atualizar() }
}

@Composable
private fun Carregando(vm: CasaViewModel) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        if (vm.erro == null) CircularProgressIndicator() else {
            Text(vm.erro!!); Spacer(Modifier.height(12.dp))
            Button(onClick = vm::atualizar) { Text("Tentar de novo") }
            TextButton(onClick = vm::sair) { Text("Sair da casa") }
        }
    }
}

@Composable
private fun Boas_vindas(vm: CasaViewModel) {
    var criar by remember { mutableStateOf(true) }
    var servidor by remember { mutableStateOf(vm.api.servidor) }
    var casa by remember { mutableStateOf("") }
    var codigo by remember { mutableStateOf("") }
    var nome by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Spacer(Modifier.height(32.dp))
        Text("Casa", style = MaterialTheme.typography.displaySmall, color = Verde, fontWeight = FontWeight.Bold)
        Text("Divida as tarefas de casa de forma justa.")
        Row {
            FilterChip(criar, { criar = true }, { Text("Criar casa") }); Spacer(Modifier.width(8.dp))
            FilterChip(!criar, { criar = false }, { Text("Entrar com código") })
        }
        OutlinedTextField(nome, { nome = it }, label = { Text("Seu nome") }, modifier = Modifier.fillMaxWidth())
        if (criar) OutlinedTextField(casa, { casa = it }, label = { Text("Nome da casa") }, modifier = Modifier.fillMaxWidth())
        else OutlinedTextField(codigo, { codigo = it.uppercase() }, label = { Text("Código de convite") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(servidor, { servidor = it }, label = { Text("Servidor") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        vm.erro?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Button(
            onClick = { if (criar) vm.criar(servidor.trim(), casa, nome) else vm.entrar(servidor.trim(), codigo, nome) },
            enabled = !vm.carregando && nome.isNotBlank() && (if (criar) casa.isNotBlank() else codigo.isNotBlank()),
            modifier = Modifier.fillMaxWidth(),
        ) { Text(if (criar) "Criar casa" else "Entrar") }
        if (criar) Text("Já vem com uma lista de tarefas comuns — dá para editar depois.", style = MaterialTheme.typography.bodySmall)
    }
}

private enum class Aba(val titulo: String, val icone: androidx.compose.ui.graphics.vector.ImageVector) {
    Hoje("Hoje", Icons.Filled.Today), Semana("Semana", Icons.Filled.CalendarMonth),
    Tarefas("Tarefas", Icons.Filled.Checklist), Casa("Casa", Icons.Filled.Home)
}

@Composable
private fun Principal(vm: CasaViewModel) {
    val e = vm.estado!!
    var aba by rememberSaveable { mutableStateOf(Aba.Hoje) }
    Scaffold(
        topBar = {
            TopAppBar(title = { Text(e.casaNome) }, actions = {
                if (vm.carregando) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                IconButton(onClick = vm::atualizar) { Icon(Icons.Filled.Refresh, "Atualizar") }
            })
        },
        bottomBar = {
            NavigationBar { Aba.entries.forEach { a -> NavigationBarItem(aba == a, { aba = a }, { Icon(a.icone, null) }, label = { Text(a.titulo) }) } }
        },
    ) { p ->
        Column(Modifier.padding(p)) {
            vm.erro?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(12.dp)) }
            when (aba) {
                Aba.Hoje -> Hoje(vm, e)
                Aba.Semana -> Semana(vm, e)
                Aba.Tarefas -> Tarefas(vm, e)
                Aba.Casa -> CasaTela(vm, e)
            }
        }
    }
}

private fun nomeDia(d: String): String {
    val x = LocalDate.parse(d)
    return x.dayOfWeek.getDisplayName(TextStyle.FULL, Locale("pt", "BR")).replaceFirstChar { it.uppercase() } + " ${x.dayOfMonth}/${x.monthValue}"
}

@Composable
private fun LinhaAtribuicao(vm: CasaViewModel, e: Estado, a: Atribuicao, mostrarDono: Boolean = true) {
    val dono = e.membros.find { it.id == a.membroId }?.nome ?: "Ninguém"
    val minha = a.membroId == e.euId
    ListItem(
        leadingContent = { Checkbox(a.feito, { vm.concluir(a) }) },
        headlineContent = { Text(a.tarefa, textDecoration = if (a.feito) TextDecoration.LineThrough else null) },
        supportingContent = { Text((if (mostrarDono) "$dono · " else "") + "${a.pontos} pt") },
        trailingContent = {
            if (!minha && !a.feito) TextButton(onClick = { vm.assumir(a) }) { Text("Assumir") }
        },
    )
}

@Composable
private fun Hoje(vm: CasaViewModel, e: Estado) {
    val minhas = e.atribuicoes.filter { it.membroId == e.euId }
    val hoje = minhas.filter { it.dia == e.hoje }
    val atrasadas = minhas.filter { it.dia < e.hoje && !it.feito }
    val proximas = minhas.filter { it.dia > e.hoje && !it.feito }
    val eu = e.placar.find { it.membroId == e.euId }
    LazyColumn {
        item {
            Card(Modifier.fillMaxWidth().padding(12.dp)) {
                Column(Modifier.padding(16.dp)) {
                    Text("Olá, ${e.membros.find { it.id == e.euId }?.nome}", style = MaterialTheme.typography.titleLarge)
                    if (eu != null) {
                        Text("${eu.feitos} de ${eu.previstos} pontos nesta semana")
                        LinearProgressIndicator(progress = { if (eu.previstos == 0) 0f else eu.feitos / eu.previstos.toFloat() }, Modifier.fillMaxWidth().padding(top = 8.dp))
                    }
                }
            }
        }
        if (atrasadas.isNotEmpty()) { item { Titulo("Atrasadas") }; items(atrasadas, { it.id }) { LinhaAtribuicao(vm, e, it, false) } }
        item { Titulo("Hoje") }
        if (hoje.isEmpty()) item { Text("Nada para hoje. 🎉", Modifier.padding(16.dp)) }
        items(hoje, { it.id }) { LinhaAtribuicao(vm, e, it, false) }
        if (proximas.isNotEmpty()) { item { Titulo("Próximos dias") }; items(proximas, { it.id }) { a ->
            Column { Text(nomeDia(a.dia), Modifier.padding(start = 16.dp), style = MaterialTheme.typography.labelSmall); LinhaAtribuicao(vm, e, a, false) }
        } }
    }
}

@Composable
private fun Titulo(t: String) = Text(t, Modifier.padding(start = 16.dp, top = 16.dp, bottom = 4.dp), style = MaterialTheme.typography.titleMedium, color = Verde)

@Composable
private fun Semana(vm: CasaViewModel, e: Estado) {
    var filtro by remember { mutableStateOf<Int?>(null) }
    val lista = e.atribuicoes.filter { filtro == null || it.membroId == filtro }.groupBy { it.dia }
    LazyColumn {
        item {
            Row(Modifier.padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                FilterChip(filtro == null, { filtro = null }, { Text("Todos") })
                e.membros.take(4).forEach { m -> FilterChip(filtro == m.id, { filtro = m.id }, { Text(m.nome) }) }
            }
        }
        lista.toSortedMap().forEach { (dia, itens) ->
            item { Titulo(nomeDia(dia) + if (dia == e.hoje) " · hoje" else "") }
            items(itens, { it.id }) { LinhaAtribuicao(vm, e, it) }
        }
    }
}

@Composable
private fun Tarefas(vm: CasaViewModel, e: Estado) {
    var editando by remember { mutableStateOf<Tarefa?>(null) }
    var nova by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxSize()) {
        LazyColumn(contentPadding = PaddingValues(bottom = 88.dp)) {
            item { Text("Toque para editar. Marque o que você gosta 👍 ou prefere evitar 👎 — a divisão leva isso em conta.", Modifier.padding(16.dp), style = MaterialTheme.typography.bodySmall) }
            items(e.tarefas, { it.id }) { t ->
                val nivel = e.preferencias[t.id] ?: 0
                val fixo = e.membros.find { it.id == t.fixoId }?.nome
                ListItem(
                    modifier = Modifier.clickable { editando = t },
                    headlineContent = { Text(t.nome) },
                    supportingContent = { Text("${t.pontos} pt · ${if (t.vezes == 7) "todo dia" else "${t.vezes}x/semana"}" + (fixo?.let { " · sempre $it" } ?: "")) },
                    trailingContent = {
                        Row {
                            IconButton(onClick = { vm.preferencia(t.id, if (nivel == 1) 0 else 1) }) { Icon(Icons.Filled.ThumbUp, "Gosto", tint = if (nivel == 1) Verde else Color.LightGray) }
                            IconButton(onClick = { vm.preferencia(t.id, if (nivel == -1) 0 else -1) }) { Icon(Icons.Filled.ThumbDown, "Evito", tint = if (nivel == -1) Color(0xFFC62828) else Color.LightGray) }
                        }
                    },
                )
            }
        }
        ExtendedFloatingActionButton(onClick = { nova = true }, modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp), icon = { Icon(Icons.Filled.Add, null) }, text = { Text("Nova tarefa") })
    }
    if (nova || editando != null) EditorTarefa(e, editando, vm) { nova = false; editando = null }
}

@Composable
private fun EditorTarefa(e: Estado, t: Tarefa?, vm: CasaViewModel, fechar: () -> Unit) {
    var nome by remember { mutableStateOf(t?.nome ?: "") }
    var pontos by remember { mutableFloatStateOf((t?.pontos ?: 2).toFloat()) }
    var vezes by remember { mutableFloatStateOf((t?.vezes ?: 1).toFloat()) }
    var fixo by remember { mutableStateOf(t?.fixoId) }
    AlertDialog(
        onDismissRequest = fechar,
        title = { Text(if (t == null) "Nova tarefa" else "Editar tarefa") },
        text = {
            Column {
                OutlinedTextField(nome, { nome = it }, label = { Text("Nome") }, singleLine = true)
                Text("Esforço: ${pontos.toInt()} pt", Modifier.padding(top = 12.dp))
                Slider(pontos, { pontos = it }, valueRange = 1f..10f, steps = 8)
                Text("Frequência: " + if (vezes.toInt() == 7) "todo dia" else "${vezes.toInt()}x por semana")
                Slider(vezes, { vezes = it }, valueRange = 1f..7f, steps = 5)
                Text("Responsável fixo")
                Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    FilterChip(fixo == null, { fixo = null }, { Text("Dividir") })
                    e.membros.take(3).forEach { m -> FilterChip(fixo == m.id, { fixo = m.id }, { Text(m.nome) }) }
                }
            }
        },
        confirmButton = { TextButton(onClick = { vm.salvarTarefa(t?.id, nome, pontos.toInt(), vezes.toInt(), fixo); fechar() }, enabled = nome.isNotBlank()) { Text("Salvar") } },
        dismissButton = {
            Row {
                if (t != null) TextButton(onClick = { vm.removerTarefa(t.id); fechar() }) { Text("Excluir", color = MaterialTheme.colorScheme.error) }
                TextButton(onClick = fechar) { Text("Cancelar") }
            }
        },
    )
}

@Composable
private fun CasaTela(vm: CasaViewModel, e: Estado) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    var editando by remember { mutableStateOf<Membro?>(null) }
    LazyColumn {
        item {
            Card(Modifier.fillMaxWidth().padding(12.dp)) {
                Column(Modifier.padding(16.dp)) {
                    Text("Código de convite", style = MaterialTheme.typography.labelMedium)
                    Text(e.codigo, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = Verde)
                    TextButton(onClick = {
                        val i = Intent(Intent.ACTION_SEND).setType("text/plain")
                            .putExtra(Intent.EXTRA_TEXT, "Entre na casa \"${e.casaNome}\" no app Casa com o código ${e.codigo}")
                        ctx.startActivity(Intent.createChooser(i, "Convidar"))
                    }) { Icon(Icons.Filled.Share, null); Spacer(Modifier.width(6.dp)); Text("Convidar") }
                }
            }
        }
        item { Titulo("Placar da semana") }
        items(e.placar, { it.membroId }) { p ->
            val m = e.membros.find { it.id == p.membroId }
            ListItem(
                modifier = Modifier.clickable { editando = m },
                headlineContent = { Text(p.nome + if (p.membroId == e.euId) " (você)" else "") },
                supportingContent = {
                    Column {
                        Text("${p.feitos}/${p.previstos} pt · peso ${m?.peso} · saldo ${if (p.saldo > 0) "+" else ""}${p.saldo}" + (m?.ausenteAte?.let { " · ausente até $it" } ?: ""))
                        LinearProgressIndicator(progress = { if (p.previstos == 0) 0f else p.feitos / p.previstos.toFloat() }, Modifier.fillMaxWidth().padding(top = 4.dp))
                    }
                },
            )
        }
        item { Titulo("Como dividir") }
        item {
            Column(Modifier.padding(horizontal = 16.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(e.modo == "pontos", { vm.modo("pontos") }, { Text("Equilibrar pontos") })
                    FilterChip(e.modo == "rodizio", { vm.modo("rodizio") }, { Text("Rodízio") })
                }
                Text(
                    if (e.modo == "pontos") "Cada um recebe uma carga proporcional ao seu peso, considerando preferências e quem ficou devendo na semana passada."
                    else "As tarefas giram entre as pessoas a cada semana.",
                    style = MaterialTheme.typography.bodySmall,
                )
                OutlinedButton(onClick = vm::redistribuir, Modifier.padding(top = 8.dp)) { Icon(Icons.Filled.Shuffle, null); Spacer(Modifier.width(6.dp)); Text("Redistribuir a semana") }
                Spacer(Modifier.height(24.dp))
                TextButton(onClick = vm::sair) { Text("Sair deste aparelho") }
            }
        }
    }
    editando?.let { m -> EditorMembro(vm, e, m) { editando = null } }
}

@Composable
private fun EditorMembro(vm: CasaViewModel, e: Estado, m: Membro, fechar: () -> Unit) {
    var peso by remember { mutableFloatStateOf(m.peso.toFloat()) }
    var dias by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = fechar,
        title = { Text(m.nome) },
        text = {
            Column {
                Text("Peso na divisão: ${"%.1f".format(peso)}  (1 = normal, 0.5 = metade)")
                Slider(peso, { peso = it }, valueRange = 0.1f..3f)
                OutlinedTextField(dias, { dias = it.filter(Char::isDigit) }, label = { Text("Ausente pelos próximos N dias") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true)
                if (m.ausenteAte != null) Text("Hoje ausente até ${m.ausenteAte} (deixe 0 para limpar)", style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = {
            TextButton(onClick = {
                val ausente = when { dias.isBlank() -> m.ausenteAte; dias == "0" -> null; else -> LocalDate.now().plusDays(dias.toLong()).toString() }
                vm.salvarMembro(m, Math.round(peso * 10) / 10.0, ausente); fechar()
            }) { Text("Salvar") }
        },
        dismissButton = {
            Row {
                if (e.euAdmin || m.id == e.euId) TextButton(onClick = { vm.removerMembro(m.id); fechar() }) {
                    Text(if (m.id == e.euId) "Sair da casa" else "Remover", color = MaterialTheme.colorScheme.error)
                }
                TextButton(onClick = fechar) { Text("Cancelar") }
            }
        },
    )
}
