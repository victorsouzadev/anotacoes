package com.organizador.dieta.data

import java.text.Normalizer
import java.time.Instant
import java.time.LocalDate
import java.time.Period
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

object Datas {
    private val br = DateTimeFormatter.ofPattern("EEE, dd/MM", Locale("pt", "BR"))

    fun hoje(): LocalDate = LocalDate.now()
    fun iso(ms: Long): String = Instant.ofEpochMilli(ms).toString()
    fun epoch(iso: String): Long = runCatching { Instant.parse(iso).toEpochMilli() }.getOrDefault(0)
    fun curta(d: LocalDate): String = br.format(d).replaceFirstChar { it.uppercase() }
    /** DayOfWeek do .NET: 0 = domingo. */
    fun diaSemana(d: LocalDate): Int = d.dayOfWeek.value % 7
}

val REFEICOES = listOf("cafe" to "Café da manhã", "almoco" to "Almoço", "lanche" to "Lanche", "jantar" to "Jantar", "ceia" to "Ceia")
fun nomeRefeicao(codigo: String) = REFEICOES.firstOrNull { it.first == codigo }?.second ?: codigo
val DIAS_SEMANA = listOf(-1 to "Todos os dias", 1 to "Segunda", 2 to "Terça", 3 to "Quarta", 4 to "Quinta", 5 to "Sexta", 6 to "Sábado", 0 to "Domingo")

data class Metas(val kcal: Int, val proteinaG: Int, val carboG: Int, val gorduraG: Int, val aguaMl: Int)

data class Totais(val kcal: Double = 0.0, val proteina: Double = 0.0, val carbo: Double = 0.0, val gordura: Double = 0.0, val fibra: Double = 0.0) {
    operator fun plus(r: Registro) = Totais(kcal + r.kcal, proteina + r.proteina, carbo + r.carbo, gordura + r.gordura, fibra + r.fibra)
    fun kcalNaMeta(m: Metas) = kcal > 0 && abs(kcal - m.kcal) <= m.kcal * 0.1
}

/** Mesma conta do backend (DietaMetas.cs), para as metas funcionarem offline. */
object Calculos {
    val PADRAO = Metas(2000, 120, 230, 65, 2500)

    fun sugerir(p: Perfil, pesoKg: Double?, hoje: LocalDate = Datas.hoje()): Metas {
        if (pesoKg == null || pesoKg <= 0 || p.alturaCm <= 0) return PADRAO
        val idade = p.nascimento?.let { runCatching { Period.between(LocalDate.parse(it), hoje).years }.getOrNull() }?.coerceIn(10, 100) ?: 30
        val tmb = 10 * pesoKg + 6.25 * p.alturaCm - 5 * idade + if (p.sexo == "F") -161 else 5
        val gasto = tmb * p.atividade.coerceIn(1.1, 2.0)
        val kcal = when (p.objetivo) {
            "perder" -> max(gasto * 0.8, if (p.sexo == "F") 1200.0 else 1500.0)
            "ganhar" -> gasto * 1.1
            else -> gasto
        }
        val proteina = pesoKg * if (p.objetivo == "perder") 2.0 else 1.8
        val gordura = pesoKg * 0.8
        val carbo = max(0.0, (kcal - proteina * 4 - gordura * 9) / 4)
        return Metas(arred(kcal, 10), proteina.roundToInt(), carbo.roundToInt(), gordura.roundToInt(), arred(pesoKg * 35, 50))
    }

    fun vigentes(p: Perfil, pesoKg: Double?): Metas {
        val s = sugerir(p, pesoKg)
        return Metas(
            if (p.metaKcal > 0) p.metaKcal else s.kcal,
            if (p.metaProteinaG > 0) p.metaProteinaG else s.proteinaG,
            if (p.metaCarboG > 0) p.metaCarboG else s.carboG,
            if (p.metaGorduraG > 0) p.metaGorduraG else s.gorduraG,
            if (p.metaAguaMl > 0) p.metaAguaMl else s.aguaMl,
        )
    }

    /** Valores de [gramas] de um alimento cujos valores são por 100 g. */
    fun porcao(a: Alimento, gramas: Double): Totais {
        val f = gramas / 100.0
        return Totais(r1(a.kcal * f), r1(a.proteina * f), r1(a.carbo * f), r1(a.gordura * f), r1(a.fibra * f))
    }

    /** Média móvel de 7 dias (por data) de uma série de pesos ordenada. */
    fun mediaMovel(pesos: List<Pair<LocalDate, Double>>): List<Double> = pesos.map { (d, _) ->
        pesos.filter { (x, _) -> !x.isAfter(d) && x.isAfter(d.minusDays(7)) }.map { it.second }.average()
    }

    fun semAcento(s: String): String =
        Normalizer.normalize(s, Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "").lowercase().replace(',', ' ')

    /** Todos os termos da busca aparecem no nome ("frango grelhado" acha "Frango, peito, sem pele, grelhado"). */
    fun combina(nome: String, busca: String): Boolean {
        val termos = semAcento(busca).split(' ').filter { it.isNotBlank() }
        if (termos.isEmpty()) return true
        val n = semAcento(nome)
        return termos.all { n.contains(it) }
    }

    private fun arred(v: Double, passo: Int) = ((v / passo).roundToInt() * passo)
    private fun r1(v: Double) = (v * 10).roundToInt() / 10.0
}
