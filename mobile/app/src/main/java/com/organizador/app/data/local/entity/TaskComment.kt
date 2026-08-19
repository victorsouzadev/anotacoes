package com.organizador.app.data.local.entity

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Comentário de uma tarefa, espelhado do backend (`/api/tasks/items/{taskId}/comments`).
 * Diferente de categoria/raia, comentários não têm upsert idempotente no servidor: cada
 * criação gera um novo id lá, então [remoteId] só é preenchido depois do POST bem-sucedido —
 * não há reconciliação de conflito, é só cache local de algo append-only.
 */
@Entity(
    tableName = "task_comments",
    foreignKeys = [
        ForeignKey(
            entity = Task::class,
            parentColumns = ["id"],
            childColumns = ["taskId"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [Index("taskId")],
)
data class TaskComment(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val taskId: Long,
    val text: String,
    val createdAt: Long = System.currentTimeMillis(),
    /** Id do comentário no backend, null enquanto ainda não foi enviado (ex.: escrito offline). */
    val remoteId: String? = null,
)
