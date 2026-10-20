package com.organizador.dieta.ui

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import com.organizador.dieta.data.Alimento
import com.organizador.dieta.data.Calculos
import java.io.File
import java.util.Locale
import kotlin.math.roundToInt

@Composable
fun Cartao(modifier: Modifier = Modifier, conteudo: @Composable () -> Unit) {
    // Folha sobre papel, borda linha de 1 px, sem sombra.
    Card(
        modifier = modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = grafite.folha, contentColor = grafite.grafite),
        border = androidx.compose.foundation.BorderStroke(1.dp, grafite.linha),
        elevation = CardDefaults.cardElevation(0.dp),
    ) { Column(Modifier.padding(16.dp)) { conteudo() } }
}

/** Barra "consumido / meta". [destaque] = a barra principal (grafite); as outras em grafite-suave. Passou de 110% vira atenção. */
@Composable
fun BarraMeta(rotulo: String, valor: Double, meta: Int, unidade: String, destaque: Boolean = false) {
    val frac = if (meta > 0) (valor / meta).toFloat() else 0f
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(rotulo, style = MaterialTheme.typography.bodyMedium)
            Text("${valor.roundToInt()} / $meta $unidade", style = EstiloValor)
        }
        Spacer(Modifier.height(4.dp))
        LinearProgressIndicator(
            progress = { frac.coerceIn(0f, 1f) },
            modifier = Modifier.fillMaxWidth().height(8.dp),
            color = if (frac > 1.1f) grafite.atencao else if (destaque) grafite.grafite else grafite.grafiteSuave,
            trackColor = grafite.linha,
        )
    }
}

@Composable
fun Titulo(texto: String, modifier: Modifier = Modifier) =
    Text(texto, modifier = modifier, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)

@Composable
fun Sub(texto: String, modifier: Modifier = Modifier, maxLines: Int = Int.MAX_VALUE) =
    Text(texto, modifier = modifier, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = maxLines, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)

@Composable
fun <T> Escolha(opcoes: List<Pair<T, String>>, valor: T, aoEscolher: (T) -> Unit) {
    androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        opcoes.forEach { (v, nome) -> FilterChip(selected = v == valor, onClick = { aoEscolher(v) }, label = { Text(nome) }) }
    }
}

/** Pergunta a quantidade: em gramas ou em porções, se o alimento tiver porção definida. */
@Composable
fun QuantidadeDialog(alimento: Alimento, inicial: Double = alimento.porcaoG, aoConfirmar: (Double) -> Unit, aoFechar: () -> Unit) {
    val temPorcao = alimento.porcaoNome != null
    var emPorcao by remember { mutableStateOf(temPorcao && inicial == alimento.porcaoG) }
    var texto by remember { mutableStateOf(if (emPorcao) "1" else fmt(inicial)) }
    val n = texto.replace(',', '.').toDoubleOrNull()
    val gramas = n?.let { if (emPorcao) it * alimento.porcaoG else it }
    AlertDialog(
        onDismissRequest = aoFechar,
        title = { Text(alimento.nome, style = MaterialTheme.typography.titleMedium) },
        text = {
            Column {
                if (temPorcao) {
                    Escolha(listOf(true to (alimento.porcaoNome ?: "porção"), false to "gramas"), emPorcao) {
                        texto = if (it) "1" else fmt(alimento.porcaoG)
                        emPorcao = it
                    }
                    Spacer(Modifier.height(8.dp))
                }
                OutlinedTextField(
                    value = texto, onValueChange = { texto = it }, singleLine = true,
                    label = { Text(if (emPorcao) "Quantidade (${alimento.porcaoNome} = ${fmt(alimento.porcaoG)} g)" else "Gramas") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
                if (gramas != null && gramas > 0) {
                    val t = Calculos.porcao(alimento, gramas)
                    Spacer(Modifier.height(8.dp))
                    Text("${fmt(gramas)} g · ${t.kcal.roundToInt()} kcal · P ${fmt(t.proteina)} · C ${fmt(t.carbo)} · G ${fmt(t.gordura)}")
                }
            }
        },
        confirmButton = { BotaoTexto(enabled = gramas != null && gramas > 0 && gramas <= 5000, onClick = { aoConfirmar(gramas!!) }, cor = grafite.nanquim) { Text("OK") } },
        dismissButton = { BotaoTexto(onClick = aoFechar) { Text("Cancelar") } },
    )
}

@Composable
fun Macros(kcal: Double, p: Double, c: Double, g: Double) =
    Sub("${kcal.roundToInt()} kcal · P ${fmt(p)} g · C ${fmt(c)} g · G ${fmt(g)} g")

@Composable
fun LinhaValor(rotulo: String, valor: String) = Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
    Text(rotulo, Modifier.weight(1f))
    Spacer(Modifier.width(8.dp))
    Text(valor, style = EstiloValor)
}

fun fmt(v: Double): String = if (v == v.roundToInt().toDouble()) v.roundToInt().toString() else String.format(Locale("pt", "BR"), "%.1f", v)

fun compartilharArquivo(context: Context, arquivo: File, tipo: String, texto: String? = null) {
    val uri = FileProvider.getUriForFile(context, context.packageName + ".arquivos", arquivo)
    val i = Intent(Intent.ACTION_SEND).setType(tipo).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    texto?.let { i.putExtra(Intent.EXTRA_TEXT, it) }
    context.startActivity(Intent.createChooser(i, "Compartilhar"))
}

fun compartilharTexto(context: Context, texto: String) =
    context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, texto), "Compartilhar"))

/**
 * Câmera do sistema (TakePicture, sem permissão de câmera no app) ou galeria. A foto chega como Uri e o
 * Repo guarda uma cópia reduzida; o arquivo temporário da câmera é apagado em seguida.
 */
@Composable
fun rememberFoto(aoEscolher: (android.net.Uri) -> Unit): (Boolean) -> Unit {
    val context = androidx.compose.ui.platform.LocalContext.current
    val temp = remember { File(context.cacheDir, "compartilhar/camera.jpg").also { it.parentFile?.mkdirs() } }
    val tempUri = remember { FileProvider.getUriForFile(context, context.packageName + ".arquivos", temp) }
    val camera = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.TakePicture()) { ok ->
        if (ok) aoEscolher(tempUri)
    }
    val galeria = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia()) { uri ->
        uri?.let(aoEscolher)
    }
    return { usarCamera ->
        if (usarCamera) camera.launch(tempUri)
        else galeria.launch(androidx.activity.result.PickVisualMediaRequest(androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia.ImageOnly))
    }
}

// Nanquim é o acento único da tela: fica para a ação principal. Botões secundários e de texto vão em grafite.

@Composable
fun BotaoSecundario(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
                    contentPadding: androidx.compose.foundation.layout.PaddingValues = androidx.compose.material3.ButtonDefaults.ContentPadding,
                    content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) =
    androidx.compose.material3.OutlinedButton(
        onClick, modifier, enabled, contentPadding = contentPadding,
        colors = androidx.compose.material3.ButtonDefaults.outlinedButtonColors(contentColor = grafite.grafite),
        border = androidx.compose.foundation.BorderStroke(1.dp, grafite.linha),
        content = content,
    )

/** [cor] padrão grafite; nanquim só na confirmação de um diálogo, negativo para excluir. */
@Composable
fun BotaoTexto(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, cor: Color = grafite.grafite,
               content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) =
    TextButton(onClick, modifier, enabled, colors = androidx.compose.material3.ButtonDefaults.textButtonColors(contentColor = cor), content = content)
