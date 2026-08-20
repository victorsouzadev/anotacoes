package com.organizador.app.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.organizador.app.domain.model.Priority

/**
 * Template de tarefa — só local, sem sync (mesmo comportamento da versão web, que guarda
 * templates em localStorage e não expõe endpoint no backend).
 */
@Entity(tableName = "task_templates")
data class TaskTemplate(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val name: String,
    val title: String,
    val description: String? = null,
    val priority: Priority = Priority.MEDIUM,
    /** Ids de categoria, separados por vírgula. */
    val categoryIds: String = "",
    val isRecurring: Boolean = false,
    val recurrenceRule: String? = null,
    /** Títulos das subtarefas, um por linha. */
    val subtaskTitles: String = "",
) {
    val categoryIdList: List<Long> get() = categoryIds.split(",").mapNotNull { it.trim().toLongOrNull() }

    companion object {
        fun encodeCategoryIds(ids: List<Long>): String = ids.joinToString(",")
    }
}
