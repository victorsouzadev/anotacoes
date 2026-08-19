package com.organizador.app.domain.common

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

/**
 * Epoch-millis <-> java.time conversions shared by the data layer (Room stores millis) and the UI
 * layer (screens work with LocalDate/LocalDateTime). Kept dependency-free of both so either side
 * can use it without an inverted layering dependency.
 */
private val zoneId: ZoneId get() = ZoneId.systemDefault()

fun Long.toLocalDateTime(): LocalDateTime = Instant.ofEpochMilli(this).atZone(zoneId).toLocalDateTime()

fun LocalDateTime.toEpochMillis(): Long = atZone(zoneId).toInstant().toEpochMilli()

fun LocalDate.startOfDayMillis(): Long = atStartOfDay(zoneId).toInstant().toEpochMilli()
