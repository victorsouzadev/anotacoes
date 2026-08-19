package com.organizador.app.domain.nlp

import com.organizador.app.domain.model.Priority
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Shared by [NaturalLanguageTaskParser] (local, regex-based) and the Anthropic-backed interpreter so both surfaces the same hint text in the UI. */
internal fun buildHints(
    dueDateTime: LocalDateTime?,
    hasExplicitTime: Boolean,
    categoryName: String?,
    priority: Priority?,
    today: LocalDate,
): List<String> {
    val hints = mutableListOf<String>()
    if (dueDateTime != null) hints.add("Prazo: ${formatDueHint(dueDateTime, today, hasExplicitTime)}")
    if (categoryName != null) hints.add("Categoria: #$categoryName")
    if (priority != null) hints.add("Prioridade: ${priorityDisplayName(priority)}")
    return hints
}

internal fun formatDueHint(dateTime: LocalDateTime, today: LocalDate, hasExplicitTime: Boolean): String {
    val date = dateTime.toLocalDate()
    val datePart = when (date) {
        today -> "hoje"
        today.plusDays(1) -> "amanhã"
        else -> date.format(DateTimeFormatter.ofPattern("EEE, dd/MM", Locale("pt", "BR")))
    }
    if (!hasExplicitTime) return datePart
    val timePart = dateTime.toLocalTime().format(DateTimeFormatter.ofPattern("HH:mm"))
    return "$datePart às $timePart"
}

internal fun priorityDisplayName(priority: Priority): String = when (priority) {
    Priority.LOW -> "Baixa"
    Priority.MEDIUM -> "Média"
    Priority.HIGH -> "Alta"
}
