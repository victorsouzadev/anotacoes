package com.organizador.app.domain.model

import java.time.DayOfWeek
import java.time.LocalDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RecurrenceRuleTest {

    @Test
    fun `daily with interval 1 advances by exactly one day`() {
        val from = LocalDateTime.of(2026, 8, 10, 18, 0)
        assertEquals(LocalDateTime.of(2026, 8, 11, 18, 0), RecurrenceRule.Daily(1).nextOccurrence(from))
    }

    @Test
    fun `daily with interval N advances by N days`() {
        val from = LocalDateTime.of(2026, 8, 10, 18, 0)
        assertEquals(LocalDateTime.of(2026, 8, 13, 18, 0), RecurrenceRule.Daily(3).nextOccurrence(from))
    }

    @Test
    fun `weekly advances to the next matching day of week`() {
        // Monday 2026-08-10; next Mon/Wed/Fri occurrence after it is Wednesday.
        val from = LocalDateTime.of(2026, 8, 10, 18, 0)
        val rule = RecurrenceRule.Weekly(setOf(DayOfWeek.MONDAY, DayOfWeek.WEDNESDAY, DayOfWeek.FRIDAY))
        assertEquals(LocalDateTime.of(2026, 8, 12, 18, 0), rule.nextOccurrence(from))
    }

    @Test
    fun `weekly with a single day wraps to the following week`() {
        val from = LocalDateTime.of(2026, 8, 10, 18, 0) // Monday
        val rule = RecurrenceRule.Weekly(setOf(DayOfWeek.MONDAY))
        assertEquals(LocalDateTime.of(2026, 8, 17, 18, 0), rule.nextOccurrence(from))
    }

    @Test
    fun `monthly advances by one calendar month`() {
        val from = LocalDateTime.of(2026, 8, 10, 9, 0)
        assertEquals(LocalDateTime.of(2026, 9, 10, 9, 0), RecurrenceRule.Monthly.nextOccurrence(from))
    }

    @Test
    fun `monthly clamps to the last valid day when the next month is shorter`() {
        // Jan 31 + 1 month has no Feb 31, so java-time clamps to the last day of February.
        val from = LocalDateTime.of(2026, 1, 31, 9, 0)
        assertEquals(LocalDateTime.of(2026, 2, 28, 9, 0), RecurrenceRule.Monthly.nextOccurrence(from))
    }

    @Test
    fun `encode and decode round-trip for every variant`() {
        val daily = RecurrenceRule.Daily(4)
        val weekly = RecurrenceRule.Weekly(setOf(DayOfWeek.TUESDAY, DayOfWeek.THURSDAY))
        val monthly = RecurrenceRule.Monthly

        assertEquals(daily, RecurrenceRule.decode(daily.encode()))
        assertEquals(weekly, RecurrenceRule.decode(weekly.encode()))
        assertEquals(monthly, RecurrenceRule.decode(monthly.encode()))
    }

    @Test
    fun `decode returns null for garbage input`() {
        assertNull(RecurrenceRule.decode("NOT_A_RULE"))
        assertNull(RecurrenceRule.decode("WEEKLY:"))
    }
}
