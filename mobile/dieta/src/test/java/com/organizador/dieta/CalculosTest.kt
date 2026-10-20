package com.organizador.dieta

import com.organizador.dieta.data.Alimento
import com.organizador.dieta.data.Calculos
import com.organizador.dieta.data.Perfil
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CalculosTest {
    private val hoje = LocalDate.of(2026, 10, 20)

    @Test
    fun sem_peso_usa_o_padrao() = assertEquals(Calculos.PADRAO, Calculos.sugerir(Perfil(alturaCm = 180.0), null, hoje))

    @Test
    fun mifflin_igual_ao_backend() {
        // 80 kg, 180 cm, 36 anos, homem, sedentário: TMB 1750 × 1,2 = 2100 kcal; água 2800 ml.
        val m = Calculos.sugerir(Perfil(alturaCm = 180.0, nascimento = "1990-01-01", sexo = "M", atividade = 1.2), 80.0, hoje)
        assertEquals(2100, m.kcal)
        assertEquals(144, m.proteinaG)
        assertEquals(2800, m.aguaMl)
    }

    @Test
    fun meta_fixada_vence_a_sugestao() =
        assertEquals(1800, Calculos.vigentes(Perfil(alturaCm = 180.0, metaKcal = 1800), 80.0).kcal)

    @Test
    fun porcao_proporcional() {
        val arroz = Alimento("taco-1", "Arroz", 124.0, 2.6, 25.8, 1.0)
        assertEquals(186.0, Calculos.porcao(arroz, 150.0).kcal, 0.01)
    }

    @Test
    fun busca_sem_acento_e_por_palavras() {
        assertTrue(Calculos.combina("Feijão, carioca, cozido", "feijao cozido"))
        assertFalse(Calculos.combina("Feijão, carioca, cozido", "feijao preto"))
    }
}
