package com.organizador.app.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Raia (coluna) do Kanban da ferramenta Tarefas — independente de categoria. Mesmo conceito usado
 * na versão web, sincronizado pelo mesmo backend.
 */
@Entity(tableName = "kanban_lanes")
data class KanbanLane(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val name: String,
    val colorHex: String,
    val position: Int = 0,
    /** Id desta raia no backend de sync, null enquanto nunca foi sincronizada. Gerado no cliente (UUID) no primeiro push. */
    val remoteId: String? = null,
    /** Última modificação local, em epoch millis — usado pelo sync para decidir quem vence num conflito. */
    val updatedAt: Long = System.currentTimeMillis(),
)
