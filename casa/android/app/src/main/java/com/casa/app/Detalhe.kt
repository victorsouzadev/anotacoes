package com.casa.app

import android.annotation.SuppressLint
import android.content.Intent
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val HORA = DateTimeFormatter.ofPattern("dd/MM HH:mm").withZone(ZoneId.of("America/Sao_Paulo"))

/**
 * Tela de detalhe de uma tarefa da semana (tela cheia, com voltar): concluir, assumir, marcar como não feita (a própria pessoa,
 * com motivo) ou sinalizar que não foi feita (outra pessoa), reabrir e comentar.
 */
@Composable
fun DetalheTarefa(vm: CasaViewModel, e: Estado, a: Atribuicao) {
    val fechar = { vm.marcarComentariosVistos(); vm.detalhe = null }
    val nome = { id: Int? -> e.membros.find { it.id == id }?.nome ?: "Ninguém" }
    val minha = a.membroId == e.euId
    val comentarios = e.comentarios.filter { it.atribuicaoId == a.id }
    var marcando by remember(a.id) { mutableStateOf(false) }
    var motivo by remember(a.id) { mutableStateOf("") }
    var texto by remember(a.id) { mutableStateOf("") }
    LaunchedEffect(comentarios.size) { vm.marcarComentariosVistos() }
    BackHandler(onBack = fechar)
    Scaffold(
        topBar = {
            TopAppBar(title = { Text(a.tarefa, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
                navigationIcon = { IconButton(onClick = fechar) { Icon(Icons.Outlined.ArrowBack, "Voltar") } })
        },
        bottomBar = {
            Column(Modifier.imePadding()) {
                HorizontalDivider(color = grafite.linha)
                Row(Modifier.background(grafite.folha).padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(texto, { texto = it.take(500) }, Modifier.weight(1f), placeholder = { Text("Comentar…") }, maxLines = 4)
                    IconButton(onClick = { vm.comentar(a, texto.trim()); texto = "" }, enabled = texto.isNotBlank()) {
                        Icon(Icons.AutoMirrored.Outlined.Send, "Enviar comentário", tint = if (texto.isNotBlank()) grafite.grafite else grafite.linha)
                    }
                }
            }
        },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp)) {
            Text(listOfNotNull(nomeDia(a.dia), a.horario, nome(a.membroId), "${a.pontos} pt").joinToString(" · "),
                style = MaterialTheme.typography.bodySmall, color = grafite.grafiteSuave)
            when {
                a.feito -> Text("Feita", Modifier.padding(top = 4.dp), color = grafite.grafiteSuave)
                a.naoFeita != null -> Text(
                    (if (a.naoFeitaPor == a.membroId) "${nome(a.naoFeitaPor)} não conseguiu fazer" else "${nome(a.naoFeitaPor)} sinalizou que não foi feita") +
                        (if (a.naoFeita.isNotBlank()) ": ${a.naoFeita}" else ""),
                    Modifier.padding(top = 4.dp), color = grafite.negativo,
                )
            }
            // Nanquim só na ação principal da tela: concluir.
            Row(Modifier.padding(top = 12.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                if (a.feito) OutlinedButton(onClick = { vm.concluir(a) }, shape = RaioBotao, colors = ButtonDefaults.outlinedButtonColors(contentColor = grafite.grafite),
                    border = androidx.compose.foundation.BorderStroke(1.dp, grafite.linha)) { Text("Desfazer") }
                else Button(onClick = { vm.concluir(a) }, shape = RaioBotao) { Text("Concluir") }
                if (!a.feito && a.naoFeita == null) AcaoNeutra(onClick = { marcando = !marcando }, compacta = true) {
                    Text(if (minha) "Não deu para fazer" else "Sinalizar não feita")
                }
                if (a.naoFeita != null && !a.feito && (minha || a.naoFeitaPor == e.euId || e.euAdmin))
                    AcaoNeutra(onClick = { vm.reabrir(a) }, compacta = true) { Text("Reabrir") }
                if (!minha && !a.feito) AcaoNeutra(onClick = { vm.assumir(a) }, compacta = true) { Text("Assumir") }
            }
            if (marcando) {
                OutlinedTextField(motivo, { motivo = it.take(500) }, Modifier.fillMaxWidth().padding(top = 8.dp),
                    label = { Text(if (minha) "Motivo (opcional)" else "Comentário (opcional)") }, minLines = 2)
                Row {
                    AcaoNeutra(onClick = { vm.naoFeita(a, motivo.trim()); marcando = false; motivo = "" }, compacta = true) { Text("Confirmar") }
                    AcaoNeutra(onClick = { marcando = false }, compacta = true, cor = grafite.grafiteSuave) { Text("Cancelar") }
                }
            }
            HorizontalDivider(Modifier.padding(vertical = 12.dp), color = grafite.linha)
            Text(if (comentarios.isEmpty()) "SEM COMENTÁRIOS" else "COMENTÁRIOS", style = MaterialTheme.typography.labelSmall, color = grafite.grafiteSuave)
            comentarios.forEach { c ->
                Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.Top) {
                    Column(Modifier.weight(1f)) {
                        Text("${nome(c.membroId)} · ${runCatching { HORA.format(Instant.parse(c.em)) }.getOrDefault("")}",
                            style = MaterialTheme.typography.bodySmall, color = grafite.grafiteSuave)
                        if (c.tipo == "nao_feita") Text("marcou como não feita" + (if (c.texto.isNotBlank()) ": ${c.texto}" else ""), color = grafite.negativo)
                        else Text(c.texto)
                    }
                    if (c.membroId == e.euId || e.euAdmin) IconButton(onClick = { vm.apagarComentario(c.id) }, Modifier.size(32.dp)) {
                        Icon(Icons.Outlined.Close, "Apagar comentário", Modifier.size(16.dp), tint = grafite.grafiteSuave)
                    }
                }
            }
        }
    }
}

/** Aba Casa → Painel: abrir no app e gerar link + código para PC/TV. */
@Composable
fun ConfigPainel(vm: CasaViewModel, e: Estado) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    Column(Modifier.padding(horizontal = 16.dp)) {
        AcaoNeutra(onClick = { vm.painelAberto = true }, compacta = true) {
            Icon(Icons.Outlined.Dashboard, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Abrir painel")
        }
        Text("PC ou TV: abra o link no navegador e digite o código.", style = MaterialTheme.typography.bodySmall, color = grafite.grafiteSuave)
        val p = e.painel
        if (p == null) {
            AcaoNeutra(onClick = vm::gerarPainel, compacta = true) { Text("Gerar link e código") }
        } else {
            Row(Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(p.url.removePrefix("https://"), style = EstiloValor, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("Código ${p.codigo.chunked(3).joinToString(" ")}", style = EstiloValor)
                    Text(if (p.aparelhos == 0) "Nenhum aparelho conectado" else "${p.aparelhos} aparelho${if (p.aparelhos > 1) "s" else ""} conectado${if (p.aparelhos > 1) "s" else ""}",
                        style = MaterialTheme.typography.bodySmall, color = grafite.grafiteSuave)
                }
            }
            Row {
                AcaoNeutra(onClick = { clipboard.setText(androidx.compose.ui.text.AnnotatedString(p.url)) }, compacta = true) { Text("Copiar link") }
                AcaoNeutra(onClick = {
                    // Só o link: o código é passado à parte (é ele que protege o painel).
                    ctx.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, p.url), "Enviar link"))
                }, compacta = true) { Text("Enviar") }
                AcaoNeutra(onClick = vm::gerarPainel, compacta = true) { Text("Trocar") }
            }
            Row {
                if (p.aparelhos > 0) AcaoNeutra(onClick = vm::desconectarAparelhos, compacta = true, cor = grafite.grafiteSuave) { Text("Desconectar aparelhos") }
                AcaoNeutra(onClick = vm::desligarPainel, compacta = true, cor = grafite.grafiteSuave) { Text("Desligar link") }
            }
            Text("\"Trocar\" gera link e código novos e desconecta os aparelhos.", style = MaterialTheme.typography.bodySmall, color = grafite.grafiteSuave)
        }
    }
}

/** Painel completo dentro do app: a mesma página do PC/TV, autenticada pelo token do membro. */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun PainelTela(vm: CasaViewModel) {
    BackHandler { vm.painelAberto = false }
    val escuro = grafite == GrafiteCores.Noite
    val url = vm.api.servidor.trimEnd('/') + "/painel/app?tema=" + if (escuro) "escuro" else "claro"
    Scaffold(topBar = {
        TopAppBar(title = { Text("Painel") }, colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            navigationIcon = { IconButton(onClick = { vm.painelAberto = false }) { Icon(Icons.Outlined.ArrowBack, "Voltar") } })
    }) { pad ->
        AndroidView(
            modifier = Modifier.padding(pad).fillMaxSize(),
            factory = { ctx ->
                WebView(ctx).apply {
                    setBackgroundColor(0) // transparente até a página pintar o papel
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    CookieManager.getInstance().setAcceptCookie(true)
                    webViewClient = WebViewClient()
                    loadUrl(url, mapOf("Authorization" to "Bearer ${vm.api.token}"))
                }
            },
            update = { w -> if (w.url != null && !w.url!!.contains("tema=" + if (escuro) "escuro" else "claro")) w.loadUrl(url, mapOf("Authorization" to "Bearer ${vm.api.token}")) },
        )
    }
}
