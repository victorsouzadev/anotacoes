package com.organizador.dieta.ui

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.organizador.dieta.data.Alimento
import com.organizador.dieta.data.Calculos
import com.organizador.dieta.data.PlanoItem
import com.organizador.dieta.data.REFEICOES
import com.organizador.dieta.data.Totais
import java.util.UUID
import kotlin.math.roundToInt

private val DIAS_CURTOS = listOf(-1 to "Todos", 1 to "Seg", 2 to "Ter", 3 to "Qua", 4 to "Qui", 5 to "Sex", 6 to "Sáb", 0 to "Dom")

/**
 * Plano alimentar como um cardápio: um cartão por refeição, uma opção visível por vez (troca nos chips) e,
 * no topo, o total do dia com as opções escolhidas contra as metas.
 */
@Composable
fun PlanoTela(vm: DietaViewModel, voltar: () -> Unit, entrevista: () -> Unit) {
    val plano by vm.plano.collectAsStateWithLifecycle()
    val alimentos by vm.alimentos.collectAsStateWithLifecycle()
    val perfil by vm.perfil.collectAsStateWithLifecycle()
    val metas by vm.metas.collectAsStateWithLifecycle()
    val porId = remember(alimentos) { alimentos.associateBy { it.id } }
    var diaSemana by remember { mutableStateOf(-1) }
    // Opção escolhida por "dia/refeição"; sem escolha = a menor.
    val selecao = remember { mutableStateMapOf<String, Int>() }
    var alvo by remember { mutableStateOf<Pair<String, Int>?>(null) }
    var buscando by remember { mutableStateOf(false) }
    var escolhido by remember { mutableStateOf<Alimento?>(null) }

    fun totais(itens: List<PlanoItem>) = itens.fold(Totais()) { t, p ->
        porId[p.alimentoId]?.let { a -> Calculos.porcao(a, p.quantidadeG).let { Totais(t.kcal + it.kcal, t.proteina + it.proteina, t.carbo + it.carbo, t.gordura + it.gordura) } } ?: t
    }

    Tela("Plano alimentar", voltar) {
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            DIAS_CURTOS.forEach { (d, nome) ->
                // Dia com cardápio próprio fica em negrito; os outros seguem "todos os dias".
                val proprio = d != -1 && plano.any { it.diaSemana == d }
                androidx.compose.material3.FilterChip(selected = d == diaSemana, onClick = { diaSemana = d },
                    label = { Text(nome, maxLines = 1, fontWeight = if (proprio) FontWeight.Bold else null) })
            }
        }

        // Por refeição: itens do dia escolhido; se o dia não tiver, os de "todos os dias" (herdados, só leitura aqui).
        val porRefeicao = REFEICOES.map { (cod, nome) ->
            val proprios = plano.filter { it.diaSemana == diaSemana && it.refeicao == cod }
            val herdado = proprios.isEmpty() && diaSemana != -1
            val itens = if (herdado) plano.filter { it.diaSemana == -1 && it.refeicao == cod } else proprios
            Triple(cod to nome, itens.groupBy { it.opcao }.toSortedMap(), herdado)
        }
        val escolhidas = porRefeicao.mapNotNull { (ref, opcoes, _) ->
            if (opcoes.isEmpty()) null else opcoes[selecao["$diaSemana/${ref.first}"]] ?: opcoes.values.first()
        }
        val dia = totais(escolhidas.flatten())

        Cartao {
            Row(verticalAlignment = Alignment.Bottom) {
                Text("${dia.kcal.roundToInt()}", style = MaterialTheme.typography.headlineMedium)
                Text(" / ${metas.kcal} kcal no dia", Modifier.weight(1f).padding(bottom = 4.dp), style = MaterialTheme.typography.bodySmall,
                    color = grafite.grafiteSuave)
            }
            Spacer(Modifier.height(4.dp))
            BarraMeta("Proteína", dia.proteina, metas.proteinaG, "g", destaque = true)
            BarraMeta("Carboidrato", dia.carbo, metas.carboG, "g")
            BarraMeta("Gordura", dia.gordura, metas.gorduraG, "g")
            Sub("Somando a opção escolhida de cada refeição.", Modifier.padding(top = 2.dp))
        }

        porRefeicao.forEach { (ref, opcoes, herdado) ->
            val (cod, nome) = ref
            val chave = "$diaSemana/$cod"
            val n = selecao[chave]?.takeIf { it in opcoes } ?: opcoes.keys.firstOrNull() ?: 1
            val itens = opcoes[n].orEmpty()
            val t = totais(itens)
            var menu by remember(chave) { mutableStateOf(false) }
            Cartao {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(nome, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (itens.isNotEmpty()) Text("${t.kcal.roundToInt()} kcal", style = EstiloValor.copy(fontSize = 13.sp), color = grafite.grafiteSuave)
                    if (!herdado && opcoes.isNotEmpty()) Box {
                        IconeBotao(Icons.Filled.MoreVert, "Mais opções", { menu = true })
                        DropdownMenu(menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(text = { Text("Nova opção") }, onClick = {
                                menu = false; alvo = cod to (opcoes.keys.max() + 1); buscando = true
                            })
                            DropdownMenuItem(text = { Text("Apagar a opção $n") }, onClick = {
                                menu = false; vm.lancar { itens.forEach { vm.repo.apagarPlano(it) } }; selecao.remove(chave)
                            })
                        }
                    }
                    IconeBotao(Icons.Filled.Add, "Adicionar", { alvo = cod to (if (herdado) 1 else n); buscando = true },
                        cor = grafite.nanquim, tamanho = 22.dp)
                }
                if (opcoes.size > 1) Row(
                    Modifier.horizontalScroll(rememberScrollState()).padding(vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    opcoes.forEach { (k, op) ->
                        val sel = k == n
                        Text(
                            "Opção $k · ${totais(op).kcal.roundToInt()}",
                            Modifier.clip(RoundedCornerShape(6.dp))
                                .border(1.dp, if (sel) grafite.grafite else grafite.linha, RoundedCornerShape(6.dp))
                                .clickable { selecao[chave] = k }.padding(horizontal = 10.dp, vertical = 5.dp),
                            style = MaterialTheme.typography.labelLarge,
                            color = if (sel) grafite.grafite else grafite.grafiteSuave,
                        )
                    }
                }
                if (herdado && itens.isNotEmpty()) Sub("Igual a todos os dias. Adicione para ter um cardápio só deste dia.")
                if (itens.isEmpty()) Sub("Sem plano para esta refeição.")
                itens.forEach { p ->
                    Row(Modifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(p.nome, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text("${fmt(p.quantidadeG)} g", style = EstiloValor.copy(fontSize = 13.sp), color = grafite.grafite)
                        if (!herdado) IconeBotao(Icons.Filled.Close, "Remover", { vm.lancar { vm.repo.apagarPlano(p) } }, tamanho = 16.dp)
                    }
                }
                if (itens.isNotEmpty()) Sub("P ${fmt(t.proteina)} g · C ${fmt(t.carbo)} g · G ${fmt(t.gordura)} g", Modifier.padding(top = 4.dp), maxLines = 1)
                itens.firstNotNullOfOrNull { it.observacao }?.let {
                    Text("Troca: $it", Modifier.padding(top = 2.dp), style = MaterialTheme.typography.bodySmall.copy(fontStyle = FontStyle.Italic),
                        color = grafite.grafiteSuave)
                }
            }
        }

        Column(Modifier.padding(horizontal = 12.dp, vertical = 12.dp)) {
            Button(onClick = entrevista, Modifier.fillMaxWidth()) { Text("Montar ou refazer com a IA (entrevista)") }
            perfil.preferencias?.let { Sub("A IA já sabe: $it", Modifier.padding(top = 6.dp), maxLines = 4) }
        }
    }

    if (buscando) ModalBottomSheet(onDismissRequest = { buscando = false }) {
        BuscaAlimento(vm, Modifier.fillMaxHeight(0.85f)) { escolhido = it; buscando = false }
    }
    escolhido?.let { a ->
        QuantidadeDialog(a, aoConfirmar = { g ->
            alvo?.let { (ref, op) ->
                vm.lancar { vm.repo.salvarPlano(PlanoItem(UUID.randomUUID().toString(), diaSemana, ref, a.id, a.nome, g, opcao = op)) }
                selecao["$diaSemana/$ref"] = op
            }
            escolhido = null
        }, aoFechar = { escolhido = null })
    }
}
