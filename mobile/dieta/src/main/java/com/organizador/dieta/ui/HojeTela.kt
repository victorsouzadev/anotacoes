package com.organizador.dieta.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.Add
import androidx.compose.ui.unit.sp
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.organizador.dieta.data.Datas
import com.organizador.dieta.data.REFEICOES
import com.organizador.dieta.data.Registro
import com.organizador.dieta.data.Totais
import java.io.File
import kotlin.math.roundToInt

@Composable
fun HojeTela(vm: DietaViewModel, adicionar: (String) -> Unit) {
    val dia by vm.dia.collectAsStateWithLifecycle()
    val registros by vm.registrosDia.collectAsStateWithLifecycle()
    val agua by vm.aguaDia.collectAsStateWithLifecycle()
    val fotos by vm.fotosDia.collectAsStateWithLifecycle()
    val metas by vm.metas.collectAsStateWithLifecycle()
    val plano by vm.plano.collectAsStateWithLifecycle()
    val progresso by vm.progresso.collectAsStateWithLifecycle()
    val sincronizando by vm.sincronizando.collectAsStateWithLifecycle()
    val totais = registros.fold(Totais()) { t, r -> t + r }
    val totalAgua = agua.sumOf { it.ml }
    var editando by remember { mutableStateOf<Registro?>(null) }
    var fotoPara by remember { mutableStateOf<String?>(null) }
    val pedirFoto = rememberFoto { uri -> fotoPara?.let { ref -> vm.foto(uri, dia, "refeicao", ref) } }

    LazyColumn {
        item {
            Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconeBotao(Icons.Filled.ChevronLeft, "Dia anterior", { vm.dia.value = dia.minusDays(1) }, cor = grafite.grafite, tamanho = 24.dp)
                // Com a fonte do sistema grande, o título encolhe com reticências e a sequência desce para baixo dele,
                // em vez de quebrar "Hoje" em duas linhas.
                Column1(Modifier.weight(1f).clickable { vm.dia.value = Datas.hoje() }) {
                    Text(
                        if (dia == Datas.hoje()) "Hoje" else Datas.curta(dia),
                        style = MaterialTheme.typography.titleLarge, maxLines = 1, softWrap = false,
                        overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                    )
                    progresso?.let { Sub("${it.sequencia} dias seguidos · nível ${it.nivel}", Modifier, maxLines = 1) }
                }
                IconeBotao(Icons.Filled.Sync, "Sincronizar", { vm.sincronizar() }, enabled = !sincronizando)
                IconeBotao(Icons.Filled.ChevronRight, "Próximo dia", { vm.dia.value = dia.plusDays(1) }, cor = grafite.grafite, tamanho = 24.dp, enabled = dia < Datas.hoje())
            }
        }
        item {
            Cartao {
                val restante = metas.kcal - totais.kcal
                Text(
                    if (restante >= 0) "${restante.roundToInt()} kcal restantes" else "${(-restante).roundToInt()} kcal acima da meta",
                    style = MaterialTheme.typography.headlineSmall,
                    color = if (restante >= 0) grafite.grafite else grafite.atencao,
                )
                Spacer(Modifier.height(8.dp))
                BarraMeta("Calorias", totais.kcal, metas.kcal, "kcal", destaque = true)
                BarraMeta("Proteína", totais.proteina, metas.proteinaG, "g")
                BarraMeta("Carboidrato", totais.carbo, metas.carboG, "g")
                BarraMeta("Gordura", totais.gordura, metas.gorduraG, "g")
                Sub("Fibra ${fmt(totais.fibra)} g")
                val ds = Datas.diaSemana(dia)
                val doDia = plano.filter { it.diaSemana == -1 || it.diaSemana == ds }.map { it.refeicao }.distinct()
                if (doDia.isNotEmpty()) {
                    val feitas = doDia.count { r -> registros.any { it.refeicao == r } }
                    Spacer(Modifier.height(4.dp))
                    Sub("Plano alimentar: $feitas de ${doDia.size} refeições (${100 * feitas / doDia.size}%)")
                }
            }
        }
        item {
            Cartao {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Titulo("Água", Modifier.weight(1f))
                    agua.lastOrNull()?.let { ultima ->
                        IconeBotao(Icons.AutoMirrored.Filled.Undo, "Desfazer", { vm.lancar { vm.repo.desfazerAgua(ultima) } })
                    }
                }
                BarraMeta("", totalAgua.toDouble(), metas.aguaMl, "ml")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    listOf(200, 300, 500).forEach { ml ->
                        BotaoSecundario(onClick = { vm.lancar { vm.repo.beberAgua(dia, ml) } }, Modifier.weight(1f),
                            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 4.dp, vertical = 8.dp)) {
                            Text("+$ml", maxLines = 1, softWrap = false, style = EstiloValor)
                        }
                    }
                }
            }
        }
        items(REFEICOES, key = { it.first }) { (codigo, nome) ->
            val itens = registros.filter { it.refeicao == codigo }
            val fotosRef = fotos.filter { it.rotulo == codigo }
            val t = itens.fold(Totais()) { acc, r -> acc + r }
            var menu by remember { mutableStateOf(false) }
            Cartao {
                // Cabeçalho numa linha: nome, total da refeição, menu (foto/repetir) e o "+" (a única ação em nanquim).
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(nome, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, maxLines = 1,
                        overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                    if (itens.isNotEmpty()) Text("${t.kcal.roundToInt()} kcal", style = EstiloValor.copy(fontSize = 13.sp), color = grafite.grafiteSuave)
                    Box {
                        IconeBotao(Icons.Filled.MoreVert, "Mais opções", { menu = true })
                        DropdownMenu(menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(text = { Text("Foto da refeição") }, leadingIcon = { Icon(Icons.Filled.PhotoCamera, null) },
                                onClick = { menu = false; fotoPara = codigo; pedirFoto(true) })
                            DropdownMenuItem(text = { Text("Foto da galeria") }, leadingIcon = { Icon(Icons.Filled.PhotoLibrary, null) },
                                onClick = { menu = false; fotoPara = codigo; pedirFoto(false) })
                            DropdownMenuItem(text = { Text("Repetir de ontem") }, leadingIcon = { Icon(Icons.Filled.ContentCopy, null) }, onClick = {
                                menu = false
                                vm.lancar { if (vm.repo.repetir(dia.minusDays(1), dia, codigo) == 0) vm.avisar("Nada no $nome de ontem.") }
                            })
                        }
                    }
                    IconeBotao(Icons.Filled.Add, "Adicionar", { adicionar(codigo) }, cor = grafite.nanquim, tamanho = 22.dp)
                }
                if (itens.isNotEmpty()) Sub("P ${fmt(t.proteina)} g · C ${fmt(t.carbo)} g · G ${fmt(t.gordura)} g", maxLines = 1)
                if (fotosRef.isNotEmpty()) {
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(vertical = 4.dp)) {
                        items(fotosRef, key = { it.id }) { f ->
                            AsyncImage(File(f.caminho), null, Modifier.size(48.dp).clip(RoundedCornerShape(6.dp)), contentScale = ContentScale.Crop)
                        }
                    }
                }
                itens.forEach { r ->
                    Row(Modifier.fillMaxWidth().clickable { editando = r }.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column1(Modifier.weight(1f)) {
                            Text(r.nome, style = MaterialTheme.typography.bodyMedium, maxLines = 1,
                                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                            Sub("${fmt(r.quantidadeG)} g · ${r.kcal.roundToInt()} kcal · P ${fmt(r.proteina)} g", maxLines = 1)
                        }
                        IconeBotao(Icons.Filled.Close, "Remover", { vm.lancar { vm.repo.apagar(r) } }, tamanho = 18.dp)
                    }
                }
            }
        }
        item { Spacer(Modifier.height(24.dp)) }
    }

    editando?.let { r ->
        val alimento = vm.alimentos.value.firstOrNull { it.id == r.alimentoId }
            ?: com.organizador.dieta.data.Alimento(r.id, r.nome, r.kcal * 100 / r.quantidadeG, r.proteina * 100 / r.quantidadeG,
                r.carbo * 100 / r.quantidadeG, r.gordura * 100 / r.quantidadeG)
        QuantidadeDialog(alimento.copy(porcaoNome = null), inicial = r.quantidadeG,
            aoConfirmar = { g -> vm.lancar { vm.repo.alterarQuantidade(r, g) }; editando = null },
            aoFechar = { editando = null })
    }
}

@Composable
fun Column1(modifier: Modifier = Modifier, conteudo: @Composable () -> Unit) =
    androidx.compose.foundation.layout.Column(modifier) { conteudo() }
