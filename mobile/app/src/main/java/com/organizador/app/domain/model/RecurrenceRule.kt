package com.organizador.app.domain.model

import java.time.DayOfWeek
import java.time.LocalDateTime

/** How a task repeats once completed. */
sealed class RecurrenceRule {
    /** Every [intervalDays] days (1 = every day). */
    data class Daily(val intervalDays: Int) : RecurrenceRule()

    /** On the given days of the week (e.g. Mon/Wed/Fri). Always non-empty. */
    data class Weekly(val daysOfWeek: Set<DayOfWeek>) : RecurrenceRule()

    /** Same day of the month, every month. */
    data object Monthly : RecurrenceRule()

    /** Compact string persisted in [com.organizador.app.data.local.entity.Task.recurrenceRule]. */
    fun encode(): String = when (this) {
        is Daily -> "DAILY:$intervalDays"
        is Weekly -> "WEEKLY:${daysOfWeek.sortedBy { it.value }.joinToString(",") { it.name }}"
        Monthly -> "MONTHLY"
    }

    companion object {
        fun decode(raw: String): RecurrenceRule? {
            val parts = raw.split(":", limit = 2)
            val param = parts.getOrNull(1)
            return when (parts.getOrNull(0)) {
                "DAILY" -> Daily((param?.toIntOrNull() ?: 1).coerceAtLeast(1))
                "WEEKLY" -> param
                    ?.split(",")
                    ?.mapNotNull { name -> runCatching { DayOfWeek.valueOf(name) }.getOrNull() }
                    ?.toSet()
                    ?.takeIf { it.isNotEmpty() }
                    ?.let { Weekly(it) }
                "MONTHLY" -> Monthly
                else -> null
            }
        }
    }
}

/** Pure date math for "what's the next occurrence after this one completes", kept separate from persistence so it's trivial to unit test. */
fun RecurrenceRule.nextOccurrence(from: LocalDateTime): LocalDateTime = when (this) {
    is RecurrenceRule.Daily -> from.plusDays(intervalDays.toLong())
    is RecurrenceRule.Weekly -> {
        var next = from.plusDays(1)
        while (next.dayOfWeek !in daysOfWeek) next = next.plusDays(1)
        next
    }
    RecurrenceRule.Monthly -> from.plusMonths(1)
}
