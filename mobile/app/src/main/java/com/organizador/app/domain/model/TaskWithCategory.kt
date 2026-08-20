package com.organizador.app.domain.model

import com.organizador.app.data.local.entity.Category
import com.organizador.app.data.local.entity.Subtask
import com.organizador.app.data.local.entity.Task

data class TaskWithCategory(
    val task: Task,
    val categories: List<Category> = emptyList(),
    val subtasks: List<Subtask> = emptyList(),
)
