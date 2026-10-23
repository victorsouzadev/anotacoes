package com.organizador.dieta.ui

import android.net.Uri
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AddAPhoto
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material3.AssistChip
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage

private val SUGESTOES = listOf(
    "Monte um cardápio para a semana dentro das minhas metas",
    "Revise minhas metas de calorias e macros",
    "Como foi minha alimentação nos últimos 7 dias?",
    "Sugira um jantar leve com o que falta de proteína hoje",
    "Troque o café da manhã do plano por opções mais baratas",
)

/** Chat com a IA da Dieta: consulta os dados e, com confirmação, altera metas, plano e registros. */
@Composable
fun ChatTela(vm: DietaViewModel) {
    val mensagens by vm.chat.collectAsStateWithLifecycle()
    val pensando by vm.pensando.collectAsStateWithLifecycle()
    val entrevista by vm.entrevista.collectAsStateWithLifecycle()
    var texto by remember { mutableStateOf("") }
    var foto by remember { mutableStateOf<Uri?>(null) }
    var menuFoto by remember { mutableStateOf(false) }
    val pedirFoto = rememberFoto { foto = it }
    val lista = rememberLazyListState()
    LaunchedEffect(mensagens.size, pensando) { if (mensagens.isNotEmpty()) lista.animateScrollToItem(mensagens.size) }

    fun enviar(t: String) {
        if (t.isBlank() || pensando) return
        vm.enviarChat(t.trim(), foto)
        texto = ""
        foto = null
    }

    Column(Modifier.fillMaxSize().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(16.dp, 12.dp, 8.dp, 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Assistente", Modifier.weight(1f), style = MaterialTheme.typography.headlineMedium)
            if (mensagens.isNotEmpty()) IconButton(onClick = { vm.limparChat() }) { Icon(Icons.Filled.DeleteSweep, "Nova conversa") }
        }
        if (entrevista) Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp).border(1.dp, grafite.linha, RoundedCornerShape(8.dp)).padding(start = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Sub("Entrevista do plano alimentar: responda e, quando quiser, peça \"pode montar\".", Modifier.weight(1f))
            BotaoTexto(onClick = { vm.encerrarEntrevista() }) { Text("Encerrar") }
        }
        LazyColumn(Modifier.weight(1f), state = lista, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (mensagens.isEmpty()) item {
                Column(Modifier.padding(16.dp)) {
                    Text("Peça para montar ou ajustar sua dieta, revisar metas ou analisar sua semana. " +
                        "O assistente usa seus dados reais e pergunta antes de alterar o plano ou as metas.")
                    Spacer(Modifier.padding(4.dp))
                    BotaoSecundario(onClick = { vm.iniciarEntrevista() }, enabled = !pensando) { Text("Montar plano com entrevista") }
                    Sub("A IA pergunta sobre sua rotina, gostos e restrições e monta um plano com 2 ou 3 opções por refeição.")
                    Spacer(Modifier.padding(4.dp))
                    Sub("Usa a chave de IA configurada no hub (Configurações de IA). Para mandar foto, a da OpenRouter. " +
                        "Não substitui acompanhamento de nutricionista.")
                }
            }
            items(mensagens) { m -> Balao(m) }
            if (pensando) item {
                Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = grafite.grafiteSuave)
                    Spacer(Modifier.padding(4.dp))
                    Sub("Pensando…")
                }
            }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SUGESTOES.forEach { s -> AssistChip(onClick = { enviar(s) }, label = { Text(s) }, enabled = !pensando) }
        }
        foto?.let { uri ->
            Box(Modifier.padding(start = 16.dp, top = 8.dp)) {
                AsyncImage(uri, null, Modifier.size(64.dp).clip(MaterialTheme.shapes.medium), contentScale = ContentScale.Crop)
                IconButton(onClick = { foto = null }, Modifier.size(24.dp).align(Alignment.TopEnd)) { Icon(Icons.Filled.Close, "Tirar foto") }
            }
        }
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Box {
                IconButton(onClick = { menuFoto = true }) { Icon(Icons.Filled.AddAPhoto, "Anexar foto") }
                DropdownMenu(menuFoto, onDismissRequest = { menuFoto = false }) {
                    DropdownMenuItem(text = { Text("Câmera") }, onClick = { menuFoto = false; pedirFoto(true) })
                    DropdownMenuItem(text = { Text("Galeria") }, onClick = { menuFoto = false; pedirFoto(false) })
                }
            }
            OutlinedTextField(texto, { texto = it }, Modifier.weight(1f), placeholder = { Text("Pergunte ou peça uma mudança") }, maxLines = 4)
            IconButton(onClick = { enviar(texto) }, enabled = texto.isNotBlank() && !pensando) {
                Icon(Icons.AutoMirrored.Filled.Send, "Enviar", tint = if (texto.isNotBlank() && !pensando) grafite.nanquim else grafite.grafiteSuave)
            }
        }
    }
}

@Composable
private fun Balao(m: MsgChat) {
    val meu = m.papel == "usuario"
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = if (meu) Arrangement.End else Arrangement.Start) {
        Surface(
            shape = RoundedCornerShape(10.dp),
            color = if (meu) grafite.nanquimTinta else grafite.folha,
            modifier = Modifier.widthIn(max = 340.dp).border(1.dp, grafite.linha, RoundedCornerShape(10.dp)),
        ) {
            Column(Modifier.padding(12.dp)) {
                if (m.comFoto) Sub("[foto anexada]")
                Text(if (meu) AnnotatedString(m.texto) else markdown(m.texto))
            }
        }
    }
}

/** Markdown mínimo do que o modelo costuma mandar: **negrito**, títulos (#) e marcadores (-, *). Tabelas ficam como texto. */
private fun markdown(t: String): AnnotatedString = buildAnnotatedString {
    var primeira = true
    t.lines().forEach { bruta ->
        // Tabela markdown: some a linha separadora (|---|) e as barras viram " · ", para caber na tela.
        val tl = bruta.trim()
        if (tl.startsWith("|") && tl.replace(Regex("[|:\\-\\s]"), "").isEmpty()) return@forEach
        if (!primeira) append('\n')
        primeira = false
        var l = if (tl.startsWith("|")) tl.trim('|').split('|').joinToString(" · ") { it.trim() } else bruta
        val titulo = l.trimStart().startsWith("#")
        if (titulo) l = l.trimStart().trimStart('#').trim()
        if (l.trimStart().startsWith("- ") || l.trimStart().startsWith("* ")) l = "•" + l.trimStart().substring(1)
        val partes = l.split("**")
        partes.forEachIndexed { j, p ->
            if (titulo || j % 2 == 1) withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(p) } else append(p)
        }
    }
}
