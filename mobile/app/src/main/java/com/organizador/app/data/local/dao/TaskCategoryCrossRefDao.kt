package com.organizador.app.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import androidx.room.Transaction
import com.organizador.app.data.local.entity.TaskCategoryCrossRef
import kotlinx.coroutines.flow.Flow

@Dao
interface TaskCategoryCrossRefDao {

    @Query("SELECT * FROM task_category_cross_refs")
    fun getAllCrossRefs(): Flow<List<TaskCategoryCrossRef>>

    @Query("SELECT * FROM task_category_cross_refs")
    suspend fun getAllCrossRefsOnce(): List<TaskCategoryCrossRef>

    @Query("SELECT categoryId FROM task_category_cross_refs WHERE taskId = :taskId")
    suspend fun getCategoryIdsForTaskOnce(taskId: Long): List<Long>

    @Insert
    suspend fun insertAll(refs: List<TaskCategoryCrossRef>)

    @Query("DELETE FROM task_category_cross_refs WHERE taskId = :taskId")
    suspend fun deleteForTask(taskId: Long)

    /** Substitui todas as categorias de uma tarefa pela lista dada. */
    @Transaction
    suspend fun replaceForTask(taskId: Long, categoryIds: List<Long>) {
        deleteForTask(taskId)
        if (categoryIds.isNotEmpty()) insertAll(categoryIds.map { TaskCategoryCrossRef(taskId, it) })
    }
}
