package com.organizador.dieta.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ListAlt
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Fastfood
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.organizador.dieta.data.Alimento
import com.organizador.dieta.data.DIAS_SEMANA
import com.organizador.dieta.data.PlanoItem
import com.organizador.dieta.data.REFEICOES
import com.organizador.dieta.data.nomeRefeicao
import java.text.DateFormat
import java.util.Date
import java.util.UUID

@Composable
private fun Tela(titulo: String, voltar: () -> Unit, conteudo: @Composable () -> Unit) {
    Scaffold(topBar = {
        TopAppBar(title = { Text(titulo, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis) }, navigationIcon = { IconButton(onClick = voltar) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Voltar") } })
    }) { pad -> Column(Modifier.padding(pad).verticalScroll(rememberScrollState())) { conteudo() } }
}

@Composable
fun MaisTela(vm: DietaViewModel, ir: (String) -> Unit) {
    val email by vm.email.collectAsStateWithLifecycle()
    Column {
        Text("Mais", Modifier.padding(16.dp), style = androidx.compose.material3.MaterialTheme.typography.headlineMedium)
        fun item(rota: String, icone: ImageVector, titulo: String, sub: String): @Composable () -> Unit = {
            ListItem(headlineContent = { Text(titulo) }, supportingContent = { Text(sub) }, leadingContent = { Icon(icone, null) },
                modifier = Modifier.clickable { ir(rota) })
        }
        item("perfil", Icons.Filled.Person, "Perfil e metas", "Calorias, macros e água")()
        item("plano", Icons.AutoMirrored.Filled.ListAlt, "Plano alimentar", "Cardápio previsto e adesão")()
        item("alimentos", Icons.Filled.Fastfood, "Meus alimentos e receitas", "Cadastros próprios e favoritos")()
        item("compartilhar", Icons.Filled.Share, "Compartilhar progresso", "Links públicos, nutricionista e CSV")()
        item("conta", Icons.Filled.AccountCircle, "Conta e sincronização", email ?: "Não conectado ao hub")()
    }
}

@Composable
fun PerfilTela(vm: DietaViewModel, voltar: () -> Unit) {
    val perfil by vm.perfil.collectAsStateWithLifecycle()
    val sugestao by vm.sugestao.collectAsStateWithLifecycle()
    val pesos by vm.pesos.collectAsStateWithLifecycle()
    var altura by remember { mutableStateOf(if (perfil.alturaCm > 0) fmt(perfil.alturaCm) else "") }
    var nascimento by remember { mutableStateOf(perfil.nascimento ?: "") }
    var sexo by remember { mutableStateOf(perfil.sexo) }
    var atividade by remember { mutableStateOf(perfil.atividade) }
    var objetivo by remember { mutableStateOf(perfil.objetivo) }
    val metas = remember {
        mutableStateListOf(*listOf(perfil.metaKcal, perfil.metaProteinaG, perfil.metaCarboG, perfil.metaGorduraG, perfil.metaAguaMl)
            .map { if (it > 0) it.toString() else "" }.toTypedArray())
    }
    val nascValido = nascimento.isBlank() || Regex("\\d{4}-\\d{2}-\\d{2}").matches(nascimento)

    Tela("Perfil e metas", voltar) {
        Column(Modifier.padding(16.dp)) {
            OutlinedTextField(altura, { altura = it }, Modifier.fillMaxWidth(), label = { Text("Altura (cm)") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
            OutlinedTextField(nascimento, { nascimento = it }, Modifier.fillMaxWidth(), label = { Text("Nascimento (AAAA-MM-DD)") }, singleLine = true,
                isError = !nascValido)
            Sub(pesos.lastOrNull()?.let { "Peso atual: ${fmt(it.kg)} kg (registre na aba Progresso)" } ?: "Registre seu peso na aba Progresso para calcular as metas.")
            Spacer(Modifier.height(12.dp))
            Titulo("Sexo")
            Escolha(listOf("M" to "Masculino", "F" to "Feminino"), sexo) { sexo = it }
            Titulo("Atividade")
            Escolha(listOf(1.2 to "Sedentário", 1.375 to "Leve", 1.55 to "Moderada", 1.725 to "Alta", 1.9 to "Muito alta"), atividade) { atividade = it }
            Titulo("Objetivo")
            Escolha(listOf("perder" to "Perder peso", "manter" to "Manter", "ganhar" to "Ganhar massa"), objetivo) { objetivo = it }
            Spacer(Modifier.height(16.dp))
            Titulo("Metas diárias")
            Sub("Deixe em branco para usar a sugestão (Mifflin-St Jeor): ${sugestao.kcal} kcal · ${sugestao.proteinaG} g proteína · " +
                "${sugestao.carboG} g carbo · ${sugestao.gorduraG} g gordura · ${sugestao.aguaMl} ml água.")
            listOf("Calorias (kcal)", "Proteína (g)", "Carboidrato (g)", "Gordura (g)", "Água (ml)").forEachIndexed { i, rot ->
                OutlinedTextField(metas[i], { metas[i] = it.filter(Char::isDigit) }, Modifier.fillMaxWidth(), label = { Text(rot) }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
            }
            Spacer(Modifier.height(16.dp))
            Button(enabled = nascValido, modifier = Modifier.fillMaxWidth(), onClick = {
                vm.repo.salvarPerfil(perfil.copy(
                    alturaCm = altura.replace(',', '.').toDoubleOrNull() ?: 0.0, nascimento = nascimento.ifBlank { null },
                    sexo = sexo, atividade = atividade, objetivo = objetivo,
                    metaKcal = metas[0].toIntOrNull() ?: 0, metaProteinaG = metas[1].toIntOrNull() ?: 0, metaCarboG = metas[2].toIntOrNull() ?: 0,
                    metaGorduraG = metas[3].toIntOrNull() ?: 0, metaAguaMl = metas[4].toIntOrNull() ?: 0,
                ))
                vm.avisar("Perfil salvo.")
                voltar()
            }) { Text("Salvar") }
        }
    }
}

@Composable
fun PlanoTela(vm: DietaViewModel, voltar: () -> Unit) {
    val plano by vm.plano.collectAsStateWithLifecycle()
    var diaSemana by remember { mutableStateOf(-1) }
    var refeicao by remember { mutableStateOf("almoco") }
    var buscando by remember { mutableStateOf(false) }
    var escolhido by remember { mutableStateOf<Alimento?>(null) }
    Tela("Plano alimentar", voltar) {
        Column(Modifier.padding(16.dp)) {
            Sub("O cardápio previsto. A tela Hoje mostra quantas refeições do plano você registrou (adesão).")
            Spacer(Modifier.height(8.dp))
            Escolha(DIAS_SEMANA, diaSemana) { diaSemana = it }
            Spacer(Modifier.height(8.dp))
            REFEICOES.forEach { (cod, nome) ->
                val itens = plano.filter { it.diaSemana == diaSemana && it.refeicao == cod }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Titulo(nome, Modifier.weight(1f))
                    BotaoTexto(onClick = { refeicao = cod; buscando = true }) { Text("Adicionar") }
                }
                itens.forEach { p ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("${p.nome} — ${fmt(p.quantidadeG)} g", Modifier.weight(1f))
                        IconButton(onClick = { vm.lancar { vm.repo.apagarPlano(p) } }) { Icon(Icons.Filled.Close, "Remover") }
                    }
                }
                HorizontalDivider()
            }
        }
    }
    if (buscando) ModalBottomSheet(onDismissRequest = { buscando = false }) {
        BuscaAlimento(vm, Modifier.fillMaxHeight(0.85f)) { escolhido = it; buscando = false }
    }
    escolhido?.let { a ->
        QuantidadeDialog(a, aoConfirmar = { g ->
            vm.lancar { vm.repo.salvarPlano(PlanoItem(UUID.randomUUID().toString(), diaSemana, refeicao, a.id, a.nome, g)) }
            escolhido = null
        }, aoFechar = { escolhido = null })
    }
}

private val ESCOPOS = listOf(
    "conquistas" to "Nível, XP, sequências, conquistas e heatmap",
    "peso" to "Peso e gráfico",
    "macros" to "Calorias e macros (14 dias)",
    "diario" to "Diário detalhado (14 dias)",
    "fotos_refeicao" to "Fotos das refeições",
    "fotos_corpo" to "Fotos de progresso corporal",
    "exportar" to "Download do CSV (90 dias)",
)

@Composable
fun CompartilharTela(vm: DietaViewModel, voltar: () -> Unit) {
    val context = LocalContext.current
    val links by vm.links.collectAsStateWithLifecycle()
    val marcados = remember { mutableStateListOf("conquistas", "peso", "macros") }
    var titulo by remember { mutableStateOf("Meu progresso") }
    var validade by remember { mutableStateOf<Int?>(30) }
    LaunchedEffect(Unit) { vm.carregarLinks() }

    Tela("Compartilhar progresso", voltar) {
        Column(Modifier.padding(16.dp)) {
            Titulo("Novo link")
            Sub("Quem tiver o link vê só o que estiver marcado. Dá para revogar a qualquer momento.")
            OutlinedTextField(titulo, { titulo = it }, Modifier.fillMaxWidth(), label = { Text("Título") }, singleLine = true)
            ESCOPOS.forEach { (cod, nome) ->
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable { if (cod in marcados) marcados.remove(cod) else marcados.add(cod) }) {
                    Checkbox(cod in marcados, { if (it) marcados.add(cod) else marcados.remove(cod) })
                    Text(nome)
                }
            }
            Row(horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(8.dp)) {
                BotaoSecundario(onClick = { marcados.clear(); marcados.addAll(listOf("macros", "diario", "peso", "exportar")); titulo = "Para o(a) nutricionista" }) {
                    Text("Modo nutricionista")
                }
            }
            Titulo("Validade")
            Escolha(listOf(7 to "7 dias", 30 to "30 dias", 365 to "1 ano", null to "Sem prazo"), validade) { validade = it }
            Spacer(Modifier.height(8.dp))
            Button(enabled = marcados.isNotEmpty(), modifier = Modifier.fillMaxWidth(), onClick = {
                vm.criarLink(titulo, marcados.toList(), validade) { compartilharTexto(context, "${it.titulo}: ${it.url}") }
            }) { Text("Criar e compartilhar link") }
            Spacer(Modifier.height(8.dp))
            BotaoSecundario(modifier = Modifier.fillMaxWidth(), onClick = {
                vm.exportar(90) { compartilharArquivo(context, it, "text/csv") }
            }) { Text("Exportar CSV (90 dias)") }
            Spacer(Modifier.height(16.dp))
            Titulo("Links criados")
            links.forEach { l ->
                Column(Modifier.padding(vertical = 8.dp)) {
                    Text(l.titulo + if (l.revogado) " (revogado)" else "")
                    Sub(l.escopos.joinToString { e -> ESCOPOS.firstOrNull { it.first == e }?.second ?: e } +
                        (l.expiraEm?.let { " · expira ${it.take(10)}" } ?: ""))
                    if (!l.revogado) Row {
                        BotaoTexto(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(l.url))) }) { Text("Abrir") }
                        BotaoTexto(onClick = { copiar(context, l.url); vm.avisar("Link copiado.") }) { Text("Copiar") }
                        BotaoTexto(onClick = { vm.revogar(l) }, cor = grafite.negativo) { Text("Revogar") }
                    }
                }
                HorizontalDivider()
            }
        }
    }
}

private fun copiar(context: Context, texto: String) =
    context.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("link", texto))

@Composable
fun ContaTela(vm: DietaViewModel, voltar: () -> Unit) {
    val email by vm.email.collectAsStateWithLifecycle()
    val ultimo by vm.ultimoSync.collectAsStateWithLifecycle()
    val sincronizando by vm.sincronizando.collectAsStateWithLifecycle()
    var servidor by remember { mutableStateOf(vm.servidor) }
    var login by remember { mutableStateOf("") }
    var senha by remember { mutableStateOf("") }
    var lembretes by remember { mutableStateOf(vm.lembretes) }

    Tela("Conta e sincronização", voltar) {
        Column(Modifier.padding(16.dp)) {
            if (email != null) {
                Text("Conectado como $email")
                Sub(if (ultimo > 0) "Último sync: ${DateFormat.getDateTimeInstance().format(Date(ultimo))}" else "Ainda não sincronizado.")
                Spacer(Modifier.height(8.dp))
                FlowRow(horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(8.dp)) {
                    Button(enabled = !sincronizando, onClick = { vm.sincronizar() }) { Text(if (sincronizando) "Sincronizando…" else "Sincronizar agora") }
                    BotaoSecundario(onClick = { vm.sair() }) { Text("Sair") }
                }
            } else {
                Sub("Use a mesma conta do hub. Sem login o app funciona offline, mas sem sync, progresso, código de barras e compartilhamento.")
                OutlinedTextField(servidor, { servidor = it }, Modifier.fillMaxWidth(), label = { Text("Servidor") }, singleLine = true)
                OutlinedTextField(login, { login = it }, Modifier.fillMaxWidth(), label = { Text("E-mail") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
                OutlinedTextField(senha, { senha = it }, Modifier.fillMaxWidth(), label = { Text("Senha") }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
                Spacer(Modifier.height(8.dp))
                FlowRow(horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(8.dp)) {
                    Button(enabled = login.isNotBlank() && senha.isNotBlank(), onClick = { vm.entrar(servidor, login, senha, false) { senha = "" } }) { Text("Entrar") }
                    BotaoSecundario(enabled = login.isNotBlank() && senha.length >= 8, onClick = { vm.entrar(servidor, login, senha, true) { senha = "" } }) { Text("Criar conta") }
                }
            }
            Spacer(Modifier.height(24.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Lembretes")
                    Sub("Às 13:30 e 20:30, se o almoço/jantar ainda não foi registrado.")
                }
                Switch(lembretes, { lembretes = it; vm.lembretes = it })
            }
        }
    }
}
