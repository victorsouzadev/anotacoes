package com.casa.app

import android.Manifest
import android.content.Intent
import android.os.Build
import androidx.activity.result.contract.ActivityResultContracts
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.ThumbDown
import androidx.compose.material.icons.outlined.ThumbUp
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale


class MainActivity : ComponentActivity() {
    private val vm: CasaViewModel by viewModels()
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Registro.iniciar(this)
        Lembretes.criarCanal(this)
        if (Build.VERSION.SDK_INT >= 33) registerForActivityResult(ActivityResultContracts.RequestPermission()) {}
            .launch(Manifest.permission.POST_NOTIFICATIONS)
        Lembretes.agendar(this)
        setContent {
            TemaGrafite {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) { if (vm.logado && vm.estado != null) Principal(vm) else if (vm.logado) Carregando(vm) else Boas_vindas(vm) }
            }
        }
    }
    override fun onResume() { super.onResume(); if (vm.logado) vm.atualizar() }
}

@Composable
private fun Carregando(vm: CasaViewModel) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        if (vm.erro == null) CircularProgressIndicator(color = grafite.grafiteSuave) else {
            Text(vm.erro!!); Spacer(Modifier.height(12.dp))
            Button(onClick = vm::atualizar, shape = RaioBotao) { Text("Tentar de novo") }
            AcaoNeutra(onClick = vm::sair) { Text("Sair da casa") }
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
    Column(
        Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Spacer(Modifier.height(32.dp))
        Text("Casa", style = MaterialTheme.typography.displaySmall)
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
            shape = RaioBotao,
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
            TopAppBar(title = { Text(e.casaNome) }, colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background), actions = {
                if (vm.carregando) CircularProgressIndicator(Modifier.size(20.dp), color = grafite.grafiteSuave, strokeWidth = 2.dp)
                IconButton(onClick = vm::atualizar) { Icon(Icons.Filled.Refresh, "Atualizar") }
            })
        },
        bottomBar = {
            HorizontalDivider(color = grafite.linha)
            NavigationBar(tonalElevation = 0.dp) { Aba.entries.forEach { a -> NavigationBarItem(aba == a, { aba = a }, { Icon(a.icone, null) }, label = { Text(a.titulo) }) } }
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

/** Linha de uma linha só (48 dp): caixa, tarefa e, à direita, horário · pessoa · pontos. */
@Composable
private fun LinhaAtribuicao(vm: CasaViewModel, e: Estado, a: Atribuicao, mostrarDono: Boolean = true) {
    val dono = e.membros.find { it.id == a.membroId }?.nome ?: "Ninguém"
    val minha = a.membroId == e.euId
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(start = 4.dp, end = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Checkbox(a.feito, { vm.concluir(a) }, colors = coresCaixa())
        Text(a.tarefa, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis,
            color = if (a.feito) grafite.grafiteSuave else grafite.grafite, textDecoration = if (a.feito) TextDecoration.LineThrough else null)
        if (a.horario != null) Text(a.horario, Modifier.padding(start = 8.dp), style = EstiloValor, color = grafite.grafiteSuave)
        val meta = listOfNotNull(dono.takeIf { mostrarDono }, "${a.pontos} pt").joinToString(" · ")
        Text((if (a.horario != null) " · " else "  ") + meta, style = MaterialTheme.typography.bodySmall, color = grafite.grafiteSuave, maxLines = 1)
        if (!minha && !a.feito) AcaoNeutra(onClick = { vm.assumir(a) }, Modifier.padding(start = 4.dp).height(32.dp), compacta = true) { Text("Assumir") }
    }
}

@Composable
private fun Hoje(vm: CasaViewModel, e: Estado) {
    val minhas = e.atribuicoes.filter { it.membroId == e.euId }
    val hoje = minhas.filter { it.dia == e.hoje }
    val atrasadas = minhas.filter { it.dia < e.hoje && !it.feito }
    val proximas = minhas.filter { it.dia > e.hoje && !it.feito }.groupBy { it.dia }
    val eu = e.placar.find { it.membroId == e.euId }
    LazyColumn(contentPadding = PaddingValues(bottom = 8.dp)) {
        item {
            OutlinedCard(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
                Column(Modifier.padding(12.dp)) {
                    Row(verticalAlignment = Alignment.Bottom) {
                        Text("Olá, ${e.membros.find { it.id == e.euId }?.nome}", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                        if (eu != null) Text("${eu.feitos}/${eu.previstos} pt", style = EstiloValor, color = grafite.grafiteSuave)
                    }
                    e.regrasDoDia(e.hoje).takeIf { it.isNotEmpty() }?.let { r ->
                        Text("Hoje: " + r.joinToString(" · ") { rotuloRegra(it) }, style = MaterialTheme.typography.bodySmall, color = grafite.grafiteSuave)
                    }
                    if (eu != null) Progresso(if (eu.previstos == 0) 0f else eu.feitos / eu.previstos.toFloat(), Modifier.fillMaxWidth().padding(top = 8.dp))
                }
            }
        }
        if (atrasadas.isNotEmpty()) { item { Titulo("Atrasadas") }; items(atrasadas, { it.id }) { LinhaAtribuicao(vm, e, it, false) } }
        item { Titulo("Hoje") }
        if (hoje.isEmpty()) item { Text("Nada para hoje. 🎉", Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) }
        items(hoje, { it.id }) { LinhaAtribuicao(vm, e, it, false) }
        if (proximas.isNotEmpty()) {
            item { Titulo("Próximos dias") }
            proximas.forEach { (dia, itens) ->
                item { Rotulo(nomeDia(dia)) }
                items(itens, { it.id }) { LinhaAtribuicao(vm, e, it, false) }
            }
        }
    }
}

@Composable
private fun Titulo(t: String) = Text(t, Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 4.dp), style = MaterialTheme.typography.titleMedium)

/** Legenda em caixa alta (12/16 +0.06em), para separar dias dentro de uma seção. */
@Composable
private fun Rotulo(t: String) = Text(t.uppercase(), Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp), style = MaterialTheme.typography.labelSmall, color = grafite.grafiteSuave)

@Composable
private fun Semana(vm: CasaViewModel, e: Estado) {
    var filtro by remember { mutableStateOf<Int?>(null) }
    val lista = e.atribuicoes.filter { filtro == null || it.membroId == filtro }.groupBy { it.dia }
    LazyColumn(contentPadding = PaddingValues(bottom = 8.dp)) {
        item {
            Row(Modifier.padding(horizontal = 12.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                FilterChip(filtro == null, { filtro = null }, { Text("Todos") })
                e.membros.forEach { m -> FilterChip(filtro == m.id, { filtro = m.id }, { Text(m.nome) }) }
            }
        }
        lista.toSortedMap().forEach { (dia, itens) ->
            item {
                val regras = e.regrasDoDia(dia).joinToString(" ") { rotuloRegra(it) }
                Titulo(nomeDia(dia) + (if (dia == e.hoje) " · hoje" else "") + (if (regras.isNotEmpty()) "   $regras" else ""))
            }
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
            item { Text("Toque para editar. 👍 gosto / 👎 evito: a divisão leva isso em conta.", Modifier.padding(horizontal = 16.dp, vertical = 8.dp), style = MaterialTheme.typography.bodySmall, color = grafite.grafiteSuave) }
            items(e.tarefas, { it.id }) { t ->
                val nivel = e.preferencias[t.id] ?: 0
                val fixo = e.membros.find { it.id == t.fixoId }?.nome
                val regra = e.condicoes.find { it.id == t.condicaoId }
                Row(Modifier.fillMaxWidth().clickable { editando = t }.heightIn(min = 52.dp).padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f).padding(vertical = 4.dp)) {
                        Text(t.nome, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(listOfNotNull("${t.pontos} pt", if (t.vezes == 7) "todo dia" else "${t.vezes}x/sem", t.horario?.let { "às $it" },
                            fixo?.let { "sempre $it" }, regra?.let { rotuloRegra(it) }).joinToString(" · "),
                            style = MaterialTheme.typography.bodySmall, color = grafite.grafiteSuave, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    IconButton(onClick = { vm.preferencia(t.id, if (nivel == 1) 0 else 1) }, Modifier.size(40.dp)) { Icon(if (nivel == 1) Icons.Filled.ThumbUp else Icons.Outlined.ThumbUp, "Gosto", Modifier.size(20.dp), tint = if (nivel == 1) grafite.grafite else grafite.grafiteSuave) }
                    IconButton(onClick = { vm.preferencia(t.id, if (nivel == -1) 0 else -1) }, Modifier.size(40.dp)) { Icon(if (nivel == -1) Icons.Filled.ThumbDown else Icons.Outlined.ThumbDown, "Evito", Modifier.size(20.dp), tint = if (nivel == -1) grafite.grafite else grafite.grafiteSuave) }
                }
            }
        }
        ExtendedFloatingActionButton(onClick = { nova = true }, modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp), shape = RaioBotao,
            containerColor = MaterialTheme.colorScheme.primary, contentColor = MaterialTheme.colorScheme.onPrimary, icon = { Icon(Icons.Filled.Add, null) }, text = { Text("Nova tarefa") })
    }
    if (nova || editando != null) EditorTarefa(e, editando, vm) { nova = false; editando = null }
}

@Composable
private fun EditorTarefa(e: Estado, t: Tarefa?, vm: CasaViewModel, fechar: () -> Unit) {
    var nome by remember { mutableStateOf(t?.nome ?: "") }
    var pontos by remember { mutableFloatStateOf((t?.pontos ?: 2).toFloat()) }
    var vezes by remember { mutableFloatStateOf((t?.vezes ?: 1).toFloat()) }
    var fixo by remember { mutableStateOf(t?.fixoId) }
    var regra by remember { mutableStateOf(t?.condicaoId) }
    var horario by remember { mutableStateOf(t?.horario) }
    var duracao by remember { mutableStateOf(t?.duracao ?: 30) }
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val escolherHorario = {
        val (h, m) = (horario ?: "20:00").split(":").map { it.toInt() }
        android.app.TimePickerDialog(ctx, { _, hh, mm -> horario = "%02d:%02d".format(hh, mm) }, h, m, true).show()
    }
    AlertDialog(
        onDismissRequest = fechar,
        title = { Text(if (t == null) "Nova tarefa" else "Editar tarefa") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                OutlinedTextField(nome, { nome = it }, label = { Text("Nome") }, singleLine = true)
                Text("Esforço: ${pontos.toInt()} pt", Modifier.padding(top = 12.dp))
                Slider(pontos, { pontos = it }, valueRange = 1f..10f, steps = 8, colors = coresSlider())
                Text("Frequência: " + if (vezes.toInt() == 7) "todo dia" else "${vezes.toInt()}x por semana")
                Slider(vezes, { vezes = it }, valueRange = 1f..7f, steps = 5, colors = coresSlider())
                Text("Responsável fixo")
                Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    FilterChip(fixo == null, { fixo = null }, { Text("Dividir") })
                    e.membros.take(3).forEach { m -> FilterChip(fixo == m.id, { fixo = m.id }, { Text(m.nome) }) }
                }
                Text("Horário de preferência", Modifier.padding(top = 8.dp))
                Row(Modifier.padding(top = 4.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    FilterChip(horario == null, { horario = null }, { Text("Sem horário") })
                    FilterChip(horario != null, { escolherHorario() }, { Text(horario ?: "Escolher…", style = if (horario != null) EstiloValor else MaterialTheme.typography.labelLarge) })
                }
                if (horario != null) Row(Modifier.padding(top = 4.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf(15, 30, 45, 60, 90).forEach { d -> FilterChip(duracao == d, { duracao = d }, { Text("$d min") }) }
                }
                if (e.condicoes.isNotEmpty()) {
                    Text("Só nos dias de", Modifier.padding(top = 8.dp))
                    Row(Modifier.padding(top = 4.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        FilterChip(regra == null, { regra = null }, { Text("Qualquer dia") })
                        e.condicoes.forEach { c -> FilterChip(regra == c.id, { regra = c.id }, { Text(rotuloRegra(c)) }) }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { vm.salvarTarefa(t?.id, nome, pontos.toInt(), vezes.toInt(), fixo, regra, horario, duracao); fechar() }, enabled = nome.isNotBlank()) { Text("Salvar") } },
        dismissButton = {
            Row {
                if (t != null) AcaoPerigo(onClick = { vm.removerTarefa(t.id); fechar() }) { Text("Excluir") }
                AcaoNeutra(onClick = fechar) { Text("Cancelar") }
            }
        },
    )
}

@Composable
private fun CasaTela(vm: CasaViewModel, e: Estado) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    var editando by remember { mutableStateOf<Membro?>(null) }
    var regraEditando by remember { mutableStateOf<Condicao?>(null) }
    var novaRegra by remember { mutableStateOf(false) }
    LazyColumn {
        item {
            OutlinedCard(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
                Row(Modifier.padding(start = 12.dp, end = 4.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Código de convite".uppercase(), style = MaterialTheme.typography.labelSmall, color = grafite.grafiteSuave)
                        Text(e.codigo, style = EstiloValor)
                    }
                    TextButton(shape = RaioBotao, onClick = {
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
            Column(Modifier.fillMaxWidth().clickable { editando = m }.padding(horizontal = 16.dp, vertical = 6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(p.nome + if (p.membroId == e.euId) " (você)" else "", Modifier.weight(1f))
                    Text("${p.feitos}/${p.previstos} pt", style = EstiloValor, color = grafite.grafiteSuave)
                }
                val extras = listOfNotNull(
                    "peso ${m?.peso}", "saldo ${if (p.saldo > 0) "+" else ""}${p.saldo}", m?.ausenteAte?.let { "ausente até $it" },
                    m?.disponibilidade?.withIndex()?.filter { it.value < 0.99 }?.takeIf { it.isNotEmpty() }
                        ?.let { l -> "menos tarefa " + l.joinToString(", ") { DIAS_CURTOS[it.index] + if (it.value <= 0) " (nada)" else "" } },
                )
                Text(extras.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = grafite.grafiteSuave, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Progresso(if (p.previstos == 0) 0f else p.feitos / p.previstos.toFloat(), Modifier.fillMaxWidth().padding(top = 4.dp))
            }
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
                OutlinedButton(onClick = vm::redistribuir, Modifier.padding(top = 8.dp), shape = RaioBotao,
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = grafite.grafite), border = BorderStroke(1.dp, grafite.linha)) { Icon(Icons.Filled.Shuffle, null); Spacer(Modifier.width(6.dp)); Text("Redistribuir a semana") }
            }
        }
        item { Titulo("Regras da casa") }
        item {
            Text("Tarefas ligadas a uma regra só caem nos dias em que ela vale (ex.: lavar louça só quando tem água).",
                Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall)
        }
        items(e.condicoes, { "regra${it.id}" }) { c ->
            val n = e.tarefas.count { it.condicaoId == c.id }
            ListItem(
        colors = coresLinha(),
                modifier = Modifier.clickable { regraEditando = c },
                headlineContent = { Text(rotuloRegra(c)) },
                supportingContent = { Text(descreverRegra(c, e.hoje) + " · $n tarefa${if (n == 1) "" else "s"}") },
            )
        }
        item {
            AcaoNeutra(onClick = { novaRegra = true }, Modifier.padding(horizontal = 8.dp)) {
                Icon(Icons.Filled.Add, null); Spacer(Modifier.width(6.dp)); Text("Nova regra")
            }
        }
        item { Titulo("Agenda") }
        item { ConfigAgenda(vm, e) }
        item { Titulo("Lembretes") }
        item { ConfigLembretes() }
        item {
            Column(Modifier.padding(horizontal = 16.dp)) {
                Spacer(Modifier.height(16.dp))
                AcaoNeutra(onClick = vm::sair, cor = grafite.grafiteSuave) { Text("Sair deste aparelho") }
            }
        }
    }
    editando?.let { m -> EditorMembro(vm, e, m) { editando = null } }
    if (novaRegra || regraEditando != null) EditorRegra(vm, e, regraEditando) { novaRegra = false; regraEditando = null }
}

private val DIAS_CURTOS = listOf("seg", "ter", "qua", "qui", "sex", "sáb", "dom")

private fun rotuloRegra(c: Condicao): String {
    val n = c.nome.lowercase()
    val icone = when {
        "água" in n || "agua" in n -> "💧"
        "luz" in n || "energia" in n -> "⚡"
        "gás" in n || "gas" in n -> "🔥"
        "lixo" in n || "coleta" in n -> "🗑️"
        "feira" in n -> "🥬"
        else -> "📌"
    }
    return "$icone ${c.nome}"
}

private fun descreverRegra(c: Condicao, hoje: String): String =
    if (c.tipo == "alternado") {
        val vale = c.referencia != null && java.time.temporal.ChronoUnit.DAYS.between(LocalDate.parse(c.referencia), LocalDate.parse(hoje)) % 2 == 0L
        "Dia sim, dia não · hoje ${if (vale) "tem" else "não tem"}"
    } else c.dias.joinToString(", ") { DIAS_CURTOS[it] }.ifEmpty { "nenhum dia" }

@Composable
private fun EditorRegra(vm: CasaViewModel, e: Estado, c: Condicao?, fechar: () -> Unit) {
    var nome by remember { mutableStateOf(c?.nome ?: "Água") }
    var tipo by remember { mutableStateOf(c?.tipo ?: "alternado") }
    val valeHojeInicial = c?.let { it.tipo == "alternado" && descreverRegra(it, e.hoje).endsWith("hoje tem") } ?: true
    var valeHoje by remember { mutableStateOf(valeHojeInicial) }
    var dias by remember { mutableStateOf(c?.dias?.toSet() ?: emptySet()) }
    AlertDialog(
        onDismissRequest = fechar,
        title = { Text(if (c == null) "Nova regra" else "Editar regra") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(nome, { nome = it }, label = { Text("Nome (ex.: Água)") }, singleLine = true)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    FilterChip(tipo == "alternado", { tipo = "alternado" }, { Text("Dia sim, dia não") })
                    FilterChip(tipo == "semana", { tipo = "semana" }, { Text("Dias da semana") })
                }
                if (tipo == "alternado") {
                    Text("Hoje vale?")
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        FilterChip(valeHoje, { valeHoje = true }, { Text("Sim, hoje") })
                        FilterChip(!valeHoje, { valeHoje = false }, { Text("Não, amanhã") })
                    }
                } else {
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        DIAS_CURTOS.forEachIndexed { i, d -> FilterChip(i in dias, { dias = if (i in dias) dias - i else dias + i }, { Text(d) }) }
                    }
                }
                Text("Depois, ligue as tarefas a esta regra na aba Tarefas.", style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = {
            TextButton(onClick = {
                val ref = if (tipo == "alternado") LocalDate.parse(e.hoje).plusDays(if (valeHoje) 0 else 1).toString() else null
                vm.salvarRegra(c?.id, nome.trim(), tipo, ref, dias.sorted()); fechar()
            }, enabled = nome.isNotBlank() && (tipo == "alternado" || dias.isNotEmpty())) { Text("Salvar") }
        },
        dismissButton = {
            Row {
                if (c != null) AcaoPerigo(onClick = { vm.removerRegra(c.id); fechar() }) { Text("Excluir") }
                AcaoNeutra(onClick = fechar) { Text("Cancelar") }
            }
        },
    )
}

@Composable
private fun EditorMembro(vm: CasaViewModel, e: Estado, m: Membro, fechar: () -> Unit) {
    var peso by remember { mutableFloatStateOf(m.peso.toFloat()) }
    var dias by remember { mutableStateOf("") }
    var disp by remember { mutableStateOf(m.disponibilidade) }
    AlertDialog(
        onDismissRequest = fechar,
        title = { Text(m.nome) },
        text = {
            Column {
                Text("Peso na divisão: ${"%.1f".format(peso)}  (1 = normal, 0.5 = metade)")
                Slider(peso, { peso = it }, valueRange = 0.1f..3f, colors = coresSlider())
                OutlinedTextField(dias, { dias = it.filter(Char::isDigit) }, label = { Text("Ausente pelos próximos N dias") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true)
                if (m.ausenteAte != null) Text("Hoje ausente até ${m.ausenteAte} (deixe 0 para limpar)", style = MaterialTheme.typography.bodySmall)
                Text("Disponibilidade na semana (toque para mudar)", Modifier.padding(top = 12.dp))
                Row(Modifier.padding(top = 4.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    DIAS_CURTOS.forEachIndexed { i, d ->
                        val f = disp[i]
                        // Livre → Pouco → Nada → Livre
                        val proximo = when { f >= 0.99 -> 0.4; f > 0 -> 0.0; else -> 1.0 }
                        FilterChip(f < 0.99, { disp = disp.toMutableList().also { it[i] = proximo } }, {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(d); Text((if (f >= 0.99) "livre" else if (f > 0) "pouco" else "nada").uppercase(), style = MaterialTheme.typography.labelSmall)
                            }
                        })
                    }
                }
                Text("Em dias de \"pouco\" a pessoa recebe só tarefas leves; o que sobra vai para outros dias ou pessoas, mantendo a semana equilibrada.",
                    style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = {
            TextButton(onClick = {
                val ausente = when { dias.isBlank() -> m.ausenteAte; dias == "0" -> null; else -> LocalDate.now().plusDays(dias.toLong()).toString() }
                vm.salvarMembro(m, Math.round(peso * 10) / 10.0, ausente, disp); fechar()
            }) { Text("Salvar") }
        },
        dismissButton = {
            Row {
                if (e.euAdmin || m.id == e.euId) AcaoPerigo(onClick = { vm.removerMembro(m.id); fechar() }) {
                    Text(if (m.id == e.euId) "Sair da casa" else "Remover")
                }
                AcaoNeutra(onClick = fechar) { Text("Cancelar") }
            }
        },
    )
}

@Composable
private fun ConfigAgenda(vm: CasaViewModel, e: Estado) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    var escolhido by remember { mutableStateOf(Agenda.calendarioEscolhido(ctx)) }
    var calendarios by remember { mutableStateOf(Agenda.calendarios(ctx)) }
    var escolhendo by remember { mutableStateOf(false) }
    val permissao = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        calendarios = Agenda.calendarios(ctx)
        if (calendarios.isNotEmpty()) escolhendo = true
    }
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    Column(Modifier.padding(horizontal = 16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Minhas tarefas na agenda do celular")
                Text(escolhido?.let { id -> calendarios.find { it.id == id }?.let { "${it.nome} · ${it.conta}" } } ?: "Com horário vira evento; sem horário, dia inteiro.",
                    style = MaterialTheme.typography.bodySmall, color = grafite.grafiteSuave, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Switch(escolhido != null, { ligar ->
                if (ligar) {
                    if (Agenda.temPermissao(ctx)) { calendarios = Agenda.calendarios(ctx); escolhendo = true } else permissao.launch(Agenda.PERMISSOES)
                } else { Agenda.desligar(ctx); escolhido = null }
            }, colors = coresChave())
        }
        if (escolhido != null) AcaoNeutra(onClick = { calendarios = Agenda.calendarios(ctx); escolhendo = true }, compacta = true) { Text("Trocar de agenda") }
        Text("Link para assinar em outra agenda (Google Agenda no computador, Apple…)", Modifier.padding(top = 8.dp))
        if (e.agendaUrl == null) {
            AcaoNeutra(onClick = vm::gerarLinkAgenda, compacta = true) { Text("Gerar link .ics") }
        } else {
            Text(e.agendaUrl, style = MaterialTheme.typography.bodySmall, color = grafite.grafiteSuave, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Row {
                AcaoNeutra(onClick = { clipboard.setText(androidx.compose.ui.text.AnnotatedString(e.agendaUrl)) }, compacta = true) { Text("Copiar") }
                AcaoNeutra(onClick = vm::gerarLinkAgenda, compacta = true) { Text("Trocar link") }
                AcaoNeutra(onClick = vm::desligarLinkAgenda, compacta = true, cor = grafite.grafiteSuave) { Text("Desligar") }
            }
            Text("Quem tiver o link vê suas tarefas. \"Trocar link\" invalida o anterior.", style = MaterialTheme.typography.bodySmall, color = grafite.grafiteSuave)
        }
    }
    if (escolhendo) AlertDialog(
        onDismissRequest = { escolhendo = false },
        title = { Text("Escolha a agenda") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                if (calendarios.isEmpty()) Text("Nenhuma agenda com permissão de escrita neste celular.")
                calendarios.forEach { c ->
                    Row(Modifier.fillMaxWidth().clickable {
                        escolhido = c.id; escolhendo = false
                        val estado = vm.estado
                        kotlin.concurrent.thread { Agenda.escolher(ctx, c.id, estado) }
                    }.heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(escolhido == c.id, null, colors = RadioButtonDefaults.colors(selectedColor = grafite.grafite, unselectedColor = grafite.grafiteSuave))
                        Column(Modifier.padding(start = 8.dp)) {
                            Text(c.nome)
                            Text(c.conta, style = MaterialTheme.typography.bodySmall, color = grafite.grafiteSuave)
                        }
                    }
                }
            }
        },
        confirmButton = { AcaoNeutra(onClick = { escolhendo = false }) { Text("Fechar") } },
    )
}

@Composable
private fun ConfigLembretes() {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    var ativo by remember { mutableStateOf(Lembretes.ativo(ctx)) }
    var manha by remember { mutableFloatStateOf(Lembretes.horaManha(ctx).toFloat()) }
    var noite by remember { mutableFloatStateOf(Lembretes.horaNoite(ctx).toFloat()) }
    val salvar = { Lembretes.configurar(ctx, ativo, manha.toInt(), noite.toInt()) }
    Column(Modifier.padding(horizontal = 16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Avisar sobre minhas tarefas", Modifier.weight(1f))
            Switch(ativo, { ativo = it; salvar() }, colors = coresChave())
        }
        if (ativo) {
            Text("Manhã (tarefas do dia): ${manha.toInt()}h")
            Slider(manha, { manha = it }, valueRange = 5f..12f, steps = 6, onValueChangeFinished = salvar, colors = coresSlider())
            Text("Noite (o que ficou pendente): ${noite.toInt()}h")
            Slider(noite, { noite = it }, valueRange = 16f..23f, steps = 6, onValueChangeFinished = salvar, colors = coresSlider())
        }
    }
}

// ---------- componentes no padrão Grafite ----------
// Nanquim é o acento único da tela; as ações secundárias ficam em grafite.

@Composable
private fun AcaoNeutra(onClick: () -> Unit, modifier: Modifier = Modifier, cor: Color = grafite.grafite, compacta: Boolean = false, content: @Composable RowScope.() -> Unit) =
    TextButton(onClick = onClick, modifier = modifier, shape = RaioBotao, colors = ButtonDefaults.textButtonColors(contentColor = cor),
        contentPadding = if (compacta) PaddingValues(horizontal = 8.dp, vertical = 0.dp) else ButtonDefaults.TextButtonContentPadding, content = content)

@Composable
private fun AcaoPerigo(onClick: () -> Unit, content: @Composable RowScope.() -> Unit) =
    TextButton(onClick = onClick, shape = RaioBotao, colors = ButtonDefaults.textButtonColors(contentColor = grafite.negativo), content = content)

@Composable
private fun Progresso(valor: Float, modifier: Modifier) =
    LinearProgressIndicator(progress = { valor }, modifier = modifier, color = grafite.grafite, trackColor = grafite.linha)

@Composable
private fun coresCaixa() = CheckboxDefaults.colors(checkedColor = grafite.grafite, uncheckedColor = grafite.grafiteSuave, checkmarkColor = grafite.folha)

@Composable
private fun coresSlider() = SliderDefaults.colors(
    thumbColor = grafite.grafite, activeTrackColor = grafite.grafite, inactiveTrackColor = grafite.linha,
    activeTickColor = grafite.folha, inactiveTickColor = grafite.grafiteSuave,
)

@Composable
private fun coresChave() = SwitchDefaults.colors(
    checkedThumbColor = grafite.folha, checkedTrackColor = grafite.grafite,
    uncheckedThumbColor = grafite.grafiteSuave, uncheckedTrackColor = grafite.papel, uncheckedBorderColor = grafite.grafiteSuave,
)

/** Linhas de lista direto no papel; folha fica para cartões e janelas. */
@Composable
private fun coresLinha() = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.background)
