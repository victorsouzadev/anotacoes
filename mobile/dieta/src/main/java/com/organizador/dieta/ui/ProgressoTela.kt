package com.organizador.dieta.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.organizador.dieta.data.Calculos
import com.organizador.dieta.data.Datas
import com.organizador.dieta.data.Totais
import java.time.LocalDate
import java.time.format.DateTimeFormatter

@Composable
fun ProgressoTela(vm: DietaViewModel) {
    val context = LocalContext.current
    val progresso by vm.progresso.collectAsStateWithLifecycle()
    val pesos by vm.pesos.collectAsStateWithLifecycle()
    val semana by vm.semana.collectAsStateWithLifecycle()
    val metas by vm.metas.collectAsStateWithLifecycle()
    val email by vm.email.collectAsStateWithLifecycle()
    var pesoTexto by remember { mutableStateOf("") }

    Column(Modifier.verticalScroll(rememberScrollState())) {
        Row(Modifier.fillMaxWidth().padding(16.dp, 16.dp, 8.dp, 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Progresso", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
            IconButton(onClick = {
                val dias = semana.groupBy { it.data }.mapValues { (_, rs) -> rs.fold(Totais()) { t, r -> t + r } }
                val arq = CardProgresso.gerar(context, progresso, dias.values.toList(), metas, pesos.map { LocalDate.parse(it.data) to it.kg })
                compartilharArquivo(context, arq, "image/png", "Meu progresso na dieta")
            }) { Icon(Icons.Filled.Share, "Compartilhar card") }
        }

        val p = progresso
        if (p == null) {
            Cartao { Sub(if (email == null) "Entre com a conta do hub (Mais → Conta) para ver XP, níveis, sequências e conquistas." else "Sincronize para calcular o progresso.") }
        } else {
            Cartao {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Nível ${p.nivel}", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.weight(1f))
                    Text("${p.xpTotal} XP", style = EstiloValor)
                }
                LinearProgressIndicator(progress = { p.xpNoNivel.toFloat() / p.xpParaProximo.coerceAtLeast(1) }, Modifier.fillMaxWidth().padding(vertical = 6.dp),
                    color = grafite.grafite, trackColor = grafite.linha)
                Sub("Faltam ${p.xpParaProximo - p.xpNoNivel} XP para o nível ${p.nivel + 1}")
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                    Numero("${p.sequencia}", "dias seguidos")
                    Numero("${p.sequenciaMeta}", "na meta")
                    Numero("${p.melhorSequencia}", "melhor sequência")
                }
            }
            Cartao {
                Titulo("Desafio da semana")
                Text(p.desafio)
                LinearProgressIndicator(progress = { p.desafioFeito.toFloat() / p.desafioAlvo }, Modifier.fillMaxWidth().padding(vertical = 6.dp), color = grafite.grafiteSuave, trackColor = grafite.linha)
                Sub("${p.desafioFeito} de ${p.desafioAlvo} dias")
            }
            Cartao {
                Titulo("Últimos 6 meses")
                Spacer(Modifier.height(8.dp))
                Heatmap(p.dias.associate { it.data to it.nivel })
                Sub("Mais escuro = mais metas batidas no dia (calorias, proteína e água).")
            }
        }

        Cartao {
            Titulo("Peso")
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(pesoTexto, { pesoTexto = it }, Modifier.weight(1f), label = { Text("Peso de hoje (kg)") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                Spacer(Modifier.width(8.dp))
                val kg = pesoTexto.replace(',', '.').toDoubleOrNull()
                Button(enabled = kg != null && kg in 20.0..400.0, onClick = {
                    vm.lancar { vm.repo.registrarPeso(Datas.hoje(), kg!!) }
                    pesoTexto = ""
                }) { Text("Salvar") }
            }
            val serie = pesos.groupBy { it.data }.map { (d, ps) -> LocalDate.parse(d) to ps.last().kg }.sortedBy { it.first }.takeLast(90)
            if (serie.size >= 2) {
                Spacer(Modifier.height(8.dp))
                GraficoPeso(serie)
                val dif = serie.last().second - serie.first().second
                Sub("${fmt(serie.last().second)} kg · ${if (dif > 0) "+" else ""}${fmt(dif)} kg desde ${serie.first().first.format(DateTimeFormatter.ofPattern("dd/MM"))}. Linha escura: média de 7 dias.")
            }
            pesos.takeLast(5).reversed().forEach { ps ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("${LocalDate.parse(ps.data).format(DateTimeFormatter.ofPattern("dd/MM"))} — ${fmt(ps.kg)} kg", Modifier.weight(1f))
                    IconButton(onClick = { vm.lancar { vm.repo.apagarPeso(ps) } }) { Icon(Icons.Filled.Close, "Apagar") }
                }
            }
        }

        p?.let {
            Cartao {
                Titulo("Conquistas (${it.conquistas.count { c -> c.em != null }}/${it.conquistas.size})")
                Spacer(Modifier.height(8.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    it.conquistas.forEach { c ->
                        val ok = c.em != null
                        Surface(shape = MaterialTheme.shapes.medium, color = grafite.folha, contentColor = if (ok) grafite.grafite else grafite.grafiteSuave,
                            border = androidx.compose.foundation.BorderStroke(1.dp, grafite.linha)) {
                            Column(Modifier.padding(10.dp).width(140.dp)) {
                                Text(c.nome + if (ok) "" else " (bloqueada)", style = MaterialTheme.typography.titleSmall)
                                Sub(c.descricao)
                                c.em?.let { em -> Sub("em ${LocalDate.parse(em).format(DateTimeFormatter.ofPattern("dd/MM/yy"))}") }
                            }
                        }
                    }
                }
            }
        }
        BotaoSecundario(onClick = { vm.sincronizar() }, Modifier.padding(16.dp)) { Text("Atualizar") }
    }
}

@Composable
private fun Numero(valor: String, rotulo: String) = Column(horizontalAlignment = Alignment.CenterHorizontally) {
    Text(valor, style = EstiloValor.copy(fontSize = androidx.compose.ui.unit.TextUnit(26f, androidx.compose.ui.unit.TextUnitType.Sp)))
    Sub(rotulo)
}

/** Heatmap estilo GitHub: colunas = semanas, linhas = dias (domingo em cima). */
@Composable
fun Heatmap(niveis: Map<LocalDate, Int>) {
    val hoje = Datas.hoje()
    val inicio = hoje.minusWeeks(25).let { it.minusDays((it.dayOfWeek.value % 7).toLong()) }
    // Linha (vazio) e grafite cada vez mais forte conforme as metas batidas: dado, não acento.
    val g = grafite
    val cores = listOf(g.linha, g.grafite.copy(alpha = 0.25f), g.grafite.copy(alpha = 0.5f), g.grafite.copy(alpha = 0.75f), g.grafite)
    Canvas(Modifier.fillMaxWidth().height(110.dp)) {
        val semanas = 26
        val gap = 3f
        val lado = minOf((size.width - gap * (semanas - 1)) / semanas, (size.height - gap * 6) / 7)
        var d = inicio
        while (!d.isAfter(hoje)) {
            val sem = ((d.toEpochDay() - inicio.toEpochDay()) / 7).toInt()
            val dow = d.dayOfWeek.value % 7
            drawRoundRect(cores[(niveis[d] ?: 0).coerceIn(0, 4)], Offset(sem * (lado + gap), dow * (lado + gap)), Size(lado, lado), CornerRadius(3f))
            d = d.plusDays(1)
        }
    }
}

@Composable
fun GraficoPeso(serie: List<Pair<LocalDate, Double>>) {
    val media = Calculos.mediaMovel(serie)
    val linha = grafite.linha
    val suave = grafite.grafiteSuave
    val acento = grafite.grafite
    Canvas(Modifier.fillMaxWidth().height(160.dp)) {
        val min = (serie.minOf { it.second } - 0.5)
        val max = (serie.maxOf { it.second } + 0.5)
        val d0 = serie.first().first.toEpochDay()
        val span = (serie.last().first.toEpochDay() - d0).coerceAtLeast(1)
        fun pt(d: LocalDate, v: Double) = Offset(size.width * (d.toEpochDay() - d0) / span, (size.height * (1 - (v - min) / (max - min))).toFloat())
        fun caminho(vals: List<Double>) = Path().apply {
            serie.forEachIndexed { i, (d, _) -> val o = pt(d, vals[i]); if (i == 0) moveTo(o.x, o.y) else lineTo(o.x, o.y) }
        }
        drawPath(caminho(serie.map { it.second }), linha, style = Stroke(2.dp.toPx()))
        drawPath(caminho(media), acento, style = Stroke(3.dp.toPx()))
        serie.forEach { (d, v) -> drawCircle(suave, 3.dp.toPx(), pt(d, v)) }
    }
}
