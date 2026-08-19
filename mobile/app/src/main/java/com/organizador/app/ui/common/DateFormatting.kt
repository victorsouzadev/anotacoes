package com.organizador.app.ui.common

import com.organizador.app.domain.common.toLocalDateTime
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

enum class DueStatus { NONE, OVERDUE, TODAY, UPCOMING }

private val ptBr = Locale("pt", "BR")

/** Sentinel time the NL parser assigns when only a date (no explicit time) was recognized. */
private val NO_EXPLICIT_TIME = LocalTime.of(23, 59)

fun dueStatusOf(dueDateMillis: Long?, today: LocalDate = LocalDate.now()): DueStatus {
    if (dueDateMillis == null) return DueStatus.NONE
    val date = dueDateMillis.toLocalDateTime().toLocalDate()
    return when {
        date.isBefore(today) -> DueStatus.OVERDUE
        date.isEqual(today) -> DueStatus.TODAY
        else -> DueStatus.UPCOMING
    }
}

fun formatDueChipLabel(dueDateMillis: Long?, today: LocalDate = LocalDate.now()): String {
    if (dueDateMillis == null) return "Sem prazo"
    val dateTime = dueDateMillis.toLocalDateTime()
    val date = dateTime.toLocalDate()
    val hasExplicitTime = dateTime.toLocalTime() != NO_EXPLICIT_TIME
    val datePart = when (date) {
        today -> "Hoje"
        today.plusDays(1) -> "Amanhã"
        else -> date.format(DateTimeFormatter.ofPattern("dd/MM", ptBr))
    }
    return if (hasExplicitTime) {
        "$datePart ${dateTime.toLocalTime().format(DateTimeFormatter.ofPattern("HH:mm"))}"
    } else {
        datePart
    }
}

fun formatSectionDateLabel(date: LocalDate, today: LocalDate = LocalDate.now()): String = when (date) {
    today -> "Hoje"
    today.plusDays(1) -> "Amanhã"
    else -> {
        val weekday = date.dayOfWeek.getDisplayName(TextStyle.SHORT, ptBr)
            .replaceFirstChar { it.uppercase(ptBr) }
        "$weekday, ${date.format(DateTimeFormatter.ofPattern("dd 'de' MMMM", ptBr))}"
    }
}
