package com.organizador.app.domain.nlp

import java.time.LocalDateTime

/**
 * Abstraction over "turn free text into one or more tasks (with subtasks and categories)", so the
 * ViewModel doesn't know whether the answer came from a remote LLM call or another source.
 */
interface TaskInterpreter {
    suspend fun interpret(rawInput: String, reference: LocalDateTime = LocalDateTime.now()): Result<List<ParsedTask>>
}
