package com.organizador.app.domain.nlp

import com.organizador.app.domain.model.Priority
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime

/**
 * Best-effort Portuguese natural-language parser for the "new task" free-text field.
 * Extracts a due date/time, a #hashtag category and a priority, returning the
 * leftover text as the task title plus human-readable hints for the UI to preview.
 *
 * [parseBatch] additionally supports describing several tasks at once, one per line, with
 * indented lines under a task treated as its checklist (subtasks).
 */
object NaturalLanguageTaskParser {

    // Java's \b word boundary is ASCII-only by default, which would otherwise silently fail to
    // match next to accented letters like "amanhã" or "às". The embedded (?U) flag fixes that on
    // desktop JVMs but isn't valid syntax on Android's ICU-based regex engine (PatternSyntaxException
    // at class-init time), so word boundaries here are done manually via Unicode-aware lookaround
    // instead of \b, which works identically on both.
    private const val BOUNDARY_BEFORE = "(?<![\\p{L}\\p{N}_])"
    private const val BOUNDARY_AFTER = "(?![\\p{L}\\p{N}_])"

    private fun bounded(core: String, ignoreCase: Boolean = true): Regex {
        val prefix = if (ignoreCase) "(?i)" else ""
        return Regex("$prefix$BOUNDARY_BEFORE(?:$core)$BOUNDARY_AFTER")
    }

    private val hashtagRegex = Regex("#([\\p{L}\\p{N}_]+)")
    private val timeRegex = bounded("([01]?\\d|2[0-3])[h:]([0-5]\\d)?")
    private val leadingBulletRegex = Regex("^(?:[-*•]|\\d+[.)])\\s*")

    // Longest keys first so "segunda-feira" matches before the shorter "segunda".
    private val weekdayKeywords: List<Pair<String, DayOfWeek>> = listOf(
        "segunda-feira" to DayOfWeek.MONDAY,
        "terça-feira" to DayOfWeek.TUESDAY,
        "terca-feira" to DayOfWeek.TUESDAY,
        "quarta-feira" to DayOfWeek.WEDNESDAY,
        "quinta-feira" to DayOfWeek.THURSDAY,
        "sexta-feira" to DayOfWeek.FRIDAY,
        "segunda" to DayOfWeek.MONDAY,
        "terça" to DayOfWeek.TUESDAY,
        "terca" to DayOfWeek.TUESDAY,
        "quarta" to DayOfWeek.WEDNESDAY,
        "quinta" to DayOfWeek.THURSDAY,
        "sexta" to DayOfWeek.FRIDAY,
        "sábado" to DayOfWeek.SATURDAY,
        "sabado" to DayOfWeek.SATURDAY,
        "domingo" to DayOfWeek.SUNDAY,
    ).sortedByDescending { it.first.length }

    // Checked longest/most-specific phrase first so "prioridade alta" wins over a bare "alta".
    private val priorityKeywords: List<Pair<Regex, Priority>> = listOf(
        bounded("prioridade\\s+alta") to Priority.HIGH,
        bounded("prioridade\\s+m[ée]dia") to Priority.MEDIUM,
        bounded("prioridade\\s+baixa") to Priority.LOW,
        bounded("urgente") to Priority.HIGH,
        bounded("importante") to Priority.HIGH,
        bounded("sem\\s+pressa") to Priority.LOW,
    )

    fun parse(rawInput: String, reference: LocalDateTime = LocalDateTime.now()): ParsedTask {
        var remaining = rawInput

        val categoryName = hashtagRegex.find(remaining)?.groupValues?.get(1)
        remaining = hashtagRegex.replace(remaining, "").trim()

        var priority: Priority? = null
        for ((regex, matchedPriority) in priorityKeywords) {
            val match = regex.find(remaining) ?: continue
            priority = matchedPriority
            remaining = remaining.removeRange(match.range).trim()
            break
        }

        val today = reference.toLocalDate()
        var dueDate: LocalDate? = null

        // "até" only marks that a deadline preposition is present in the sentence (e.g. "até sexta");
        // it does not by itself imply urgency, so it is stripped without affecting priority.
        remaining = bounded("até").replace(remaining, "").trim()

        when {
            bounded("hoje").containsMatchIn(remaining) -> {
                dueDate = today
                remaining = bounded("hoje").replace(remaining, "").trim()
            }
            bounded("amanh[ãa]").containsMatchIn(remaining) -> {
                dueDate = today.plusDays(1)
                remaining = bounded("amanh[ãa]").replace(remaining, "").trim()
            }
            else -> {
                for ((keyword, dayOfWeek) in weekdayKeywords) {
                    val match = bounded(Regex.escape(keyword)).find(remaining) ?: continue
                    dueDate = nextOrSameDate(today, dayOfWeek)
                    remaining = remaining.removeRange(match.range).trim()
                    break
                }
            }
        }

        var dueTime: LocalTime? = null
        timeRegex.find(remaining)?.let { match ->
            val hour = match.groupValues[1].toIntOrNull()
            val minute = match.groupValues[2].takeIf { it.isNotEmpty() }?.toIntOrNull() ?: 0
            if (hour != null && hour in 0..23 && minute in 0..59) {
                dueTime = LocalTime.of(hour, minute)
                remaining = remaining.removeRange(match.range).trim()
            }
        }

        remaining = bounded("às").replace(remaining, "").trim()
        remaining = remaining.replace(Regex("\\s{2,}"), " ").trim(' ', ',', '-').trim()

        val hasExplicitTime = dueTime != null
        val dueDateTime: LocalDateTime? = when {
            dueDate != null && dueTime != null -> LocalDateTime.of(dueDate, dueTime)
            dueDate != null -> LocalDateTime.of(dueDate, LocalTime.of(23, 59))
            dueTime != null -> LocalDateTime.of(today, dueTime)
            else -> null
        }
        val hints = buildHints(dueDateTime, hasExplicitTime, categoryName, priority, today).ifEmpty {
            listOf("Nada identificado automaticamente — preencha manualmente")
        }

        return ParsedTask(
            cleanTitle = remaining,
            dueDateTime = dueDateTime,
            hasExplicitTime = hasExplicitTime,
            categoryName = categoryName,
            priority = priority,
            hints = hints,
        )
    }

    /**
     * Splits free text into one [ParsedTask] per top-level (non-indented) line, each parsed the
     * same way as [parse]. A line indented with leading whitespace is treated as a subtask of the
     * closest top-level line above it rather than a task of its own. A leading bullet/number
     * marker ("-", "*", "•", "1.") is stripped from any line before parsing.
     */
    fun parseBatch(rawInput: String, reference: LocalDateTime = LocalDateTime.now()): List<ParsedTask> {
        val topLevelLines = mutableListOf<String>()
        val subtaskLinesByTopIndex = mutableListOf<MutableList<String>>()

        for (rawLine in rawInput.split("\n")) {
            if (rawLine.isBlank()) continue
            val isIndented = rawLine.first().isWhitespace()
            val cleaned = leadingBulletRegex.replace(rawLine.trim(), "").trim()
            if (cleaned.isBlank()) continue

            if (isIndented && topLevelLines.isNotEmpty()) {
                subtaskLinesByTopIndex.last().add(cleaned)
            } else {
                topLevelLines.add(cleaned)
                subtaskLinesByTopIndex.add(mutableListOf())
            }
        }

        return topLevelLines.mapIndexed { index, line ->
            val base = parse(line, reference)
            val subtasks = subtaskLinesByTopIndex[index]
            if (subtasks.isEmpty()) {
                base
            } else {
                base.copy(subtasks = subtasks, hints = base.hints + "${subtasks.size} subtarefa(s)")
            }
        }
    }

    private fun nextOrSameDate(from: LocalDate, target: DayOfWeek): LocalDate {
        var date = from
        while (date.dayOfWeek != target) date = date.plusDays(1)
        return date
    }
}
