package com.organizador.app.domain.nlp

import com.organizador.app.domain.model.Priority
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NaturalLanguageTaskParserTest {

    // Arbitrary fixed instant so date-math assertions don't depend on when the test runs.
    private val reference = LocalDateTime.of(2026, 8, 10, 9, 0)

    private fun nextWeekday(from: LocalDate, target: DayOfWeek): LocalDate {
        var date = from
        while (date.dayOfWeek != target) date = date.plusDays(1)
        return date
    }

    @Test
    fun `extracts hashtag as category and strips it from the title`() {
        val result = NaturalLanguageTaskParser.parse("Comprar leite #mercado", reference)
        assertEquals("mercado", result.categoryName)
        assertEquals("Comprar leite", result.cleanTitle)
    }

    @Test
    fun `urgente keyword sets high priority`() {
        val result = NaturalLanguageTaskParser.parse("Enviar relatório urgente", reference)
        assertEquals(Priority.HIGH, result.priority)
        assertEquals("Enviar relatório", result.cleanTitle)
    }

    @Test
    fun `explicit priority phrase overrides bare keywords`() {
        val result = NaturalLanguageTaskParser.parse("Revisar contrato prioridade baixa", reference)
        assertEquals(Priority.LOW, result.priority)
    }

    @Test
    fun `ate alone does not imply priority`() {
        val result = NaturalLanguageTaskParser.parse("Enviar até sexta", reference)
        assertNull(result.priority)
    }

    @Test
    fun `hoje resolves to the reference date without an explicit time`() {
        val result = NaturalLanguageTaskParser.parse("Pagar conta hoje", reference)
        assertEquals(reference.toLocalDate(), result.dueDateTime?.toLocalDate())
        assertEquals(false, result.hasExplicitTime)
    }

    @Test
    fun `amanha resolves to the day after the reference date`() {
        val result = NaturalLanguageTaskParser.parse("Ligar amanhã", reference)
        assertEquals(reference.toLocalDate().plusDays(1), result.dueDateTime?.toLocalDate())
    }

    @Test
    fun `weekday name resolves to the next occurrence of that weekday`() {
        val result = NaturalLanguageTaskParser.parse("Reunião sexta", reference)
        val expected = nextWeekday(reference.toLocalDate(), DayOfWeek.FRIDAY)
        assertEquals(expected, result.dueDateTime?.toLocalDate())
    }

    @Test
    fun `hour-h time format is parsed as an explicit time`() {
        val result = NaturalLanguageTaskParser.parse("Call 18h", reference)
        assertTrue(result.hasExplicitTime)
        assertEquals(LocalTime.of(18, 0), result.dueDateTime?.toLocalTime())
    }

    @Test
    fun `hour-colon-minute time format is parsed`() {
        val result = NaturalLanguageTaskParser.parse("Call 18:30", reference)
        assertEquals(LocalTime.of(18, 30), result.dueDateTime?.toLocalTime())
    }

    @Test
    fun `date and time combine into a single due instant`() {
        val result = NaturalLanguageTaskParser.parse("Reunião amanhã às 14h", reference)
        assertEquals(reference.toLocalDate().plusDays(1), result.dueDateTime?.toLocalDate())
        assertEquals(LocalTime.of(14, 0), result.dueDateTime?.toLocalTime())
        assertTrue(result.hasExplicitTime)
    }

    @Test
    fun `text with no recognizable fields falls back to a manual-entry hint`() {
        val result = NaturalLanguageTaskParser.parse("Tarefa qualquer", reference)
        assertNull(result.dueDateTime)
        assertNull(result.categoryName)
        assertNull(result.priority)
        assertEquals(listOf("Nada identificado automaticamente — preencha manualmente"), result.hints)
    }

    @Test
    fun `parseBatch treats a single line as one task with no subtasks`() {
        val items = NaturalLanguageTaskParser.parseBatch("Comprar leite", reference)
        assertEquals(1, items.size)
        assertEquals("Comprar leite", items[0].cleanTitle)
        assertTrue(items[0].subtasks.isEmpty())
    }

    @Test
    fun `parseBatch groups indented lines as subtasks of the line above`() {
        val input = "Organizar viagem #trabalho\n  comprar passagem\n  reservar hotel\nLigar pro dentista amanhã"
        val items = NaturalLanguageTaskParser.parseBatch(input, reference)

        assertEquals(2, items.size)

        assertEquals("Organizar viagem", items[0].cleanTitle)
        assertEquals("trabalho", items[0].categoryName)
        assertEquals(listOf("comprar passagem", "reservar hotel"), items[0].subtasks)

        assertEquals("Ligar pro dentista", items[1].cleanTitle)
        assertEquals(reference.toLocalDate().plusDays(1), items[1].dueDateTime?.toLocalDate())
        assertTrue(items[1].subtasks.isEmpty())
    }

    @Test
    fun `parseBatch strips leading bullet markers from top-level lines`() {
        val items = NaturalLanguageTaskParser.parseBatch("- Tarefa um\n- Tarefa dois", reference)
        assertEquals(listOf("Tarefa um", "Tarefa dois"), items.map { it.cleanTitle })
    }
}
