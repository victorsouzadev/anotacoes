package com.organizador.dieta.ui

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.isSystemInDarkTheme
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
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
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

val Verde = Color(0xFF2F9E44)
val Azul = Color(0xFF1C7ED6)
val Laranja = Color(0xFFE8590C)
val Roxo = Color(0xFF7048E8)

@Composable
fun DietaTema(content: @Composable () -> Unit) {
    val escuro = isSystemInDarkTheme()
    val cores = if (escuro) {
        darkColorScheme(primary = Color(0xFF51CF66), secondary = Color(0xFF4DABF7), background = Color(0xFF0E1116),
            surface = Color(0xFF0E1116), surfaceVariant = Color(0xFF1B1F27), surfaceContainer = Color(0xFF161A21))
    } else {
        lightColorScheme(primary = Verde, secondary = Azul, background = Color(0xFFF7F7F5), surface = Color(0xFFF7F7F5),
            surfaceVariant = Color(0xFFFFFFFF), surfaceContainer = Color(0xFFEFEFEB))
    }
    MaterialTheme(colorScheme = cores, content = content)
}

@Composable
fun Cartao(modifier: Modifier = Modifier, conteudo: @Composable () -> Unit) {
    Card(
        modifier = modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) { Column(Modifier.padding(16.dp)) { conteudo() } }
}

/** Barra "consumido / meta" com rótulo. Passou de 110% fica laranja. */
@Composable
fun BarraMeta(rotulo: String, valor: Double, meta: Int, unidade: String, cor: Color) {
    val frac = if (meta > 0) (valor / meta).toFloat() else 0f
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(rotulo, style = MaterialTheme.typography.bodyMedium)
            Text("${valor.roundToInt()} / $meta $unidade", style = MaterialTheme.typography.bodyMedium)
        }
        Spacer(Modifier.height(4.dp))
        LinearProgressIndicator(
            progress = { frac.coerceIn(0f, 1f) },
            modifier = Modifier.fillMaxWidth().height(8.dp),
            color = if (frac > 1.1f) Laranja else cor,
            trackColor = MaterialTheme.colorScheme.surfaceContainer,
        )
    }
}

@Composable
fun Titulo(texto: String, modifier: Modifier = Modifier) =
    Text(texto, modifier = modifier, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)

@Composable
fun Sub(texto: String, modifier: Modifier = Modifier) =
    Text(texto, modifier = modifier, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)

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
        confirmButton = { TextButton(enabled = gramas != null && gramas > 0 && gramas <= 5000, onClick = { aoConfirmar(gramas!!) }) { Text("OK") } },
        dismissButton = { TextButton(onClick = aoFechar) { Text("Cancelar") } },
    )
}

@Composable
fun Macros(kcal: Double, p: Double, c: Double, g: Double) =
    Sub("${kcal.roundToInt()} kcal · P ${fmt(p)} g · C ${fmt(c)} g · G ${fmt(g)} g")

@Composable
fun LinhaValor(rotulo: String, valor: String) = Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
    Text(rotulo, Modifier.weight(1f))
    Spacer(Modifier.width(8.dp))
    Text(valor, fontWeight = FontWeight.SemiBold)
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
