package com.organizador.app.domain.nlp

import com.organizador.app.domain.model.Priority
import java.time.LocalDateTime

data class ParsedTask(
    val cleanTitle: String,
    val dueDateTime: LocalDateTime?,
    val hasExplicitTime: Boolean,
    val categoryName: String?,
    val priority: Priority?,
    val hints: List<String>,
    val subtasks: List<String> = emptyList(),
)
