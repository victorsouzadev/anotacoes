package com.organizador.app.data.local.entity

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index

/** Associação N:N entre tarefa e categoria — uma tarefa pode ter várias categorias. */
@Entity(
    tableName = "task_category_cross_refs",
    primaryKeys = ["taskId", "categoryId"],
    foreignKeys = [
        ForeignKey(entity = Task::class, parentColumns = ["id"], childColumns = ["taskId"], onDelete = ForeignKey.CASCADE),
        ForeignKey(entity = Category::class, parentColumns = ["id"], childColumns = ["categoryId"], onDelete = ForeignKey.CASCADE),
    ],
    indices = [Index("taskId"), Index("categoryId")],
)
data class TaskCategoryCrossRef(
    val taskId: Long,
    val categoryId: Long,
)
