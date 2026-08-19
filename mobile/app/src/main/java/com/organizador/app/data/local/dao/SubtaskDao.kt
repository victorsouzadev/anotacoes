package com.organizador.app.data.local.dao

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Query
import androidx.room.Upsert
import com.organizador.app.data.local.entity.Subtask
import kotlinx.coroutines.flow.Flow

@Dao
interface SubtaskDao {

    /** All subtasks across all tasks; grouped by taskId in the repository so a single collector covers every task list/detail screen. */
    @Query("SELECT * FROM subtasks ORDER BY position ASC, id ASC")
    fun getAllSubtasks(): Flow<List<Subtask>>

    @Query("SELECT * FROM subtasks WHERE taskId = :taskId ORDER BY position ASC, id ASC")
    fun getSubtasksForTask(taskId: Long): Flow<List<Subtask>>

    @Upsert
    suspend fun upsert(subtask: Subtask): Long

    @Upsert
    suspend fun upsertAll(subtasks: List<Subtask>)

    @Delete
    suspend fun delete(subtask: Subtask)

    @Query("DELETE FROM subtasks WHERE taskId = :taskId")
    suspend fun deleteAllForTask(taskId: Long)

    @Query("UPDATE subtasks SET isCompleted = :isCompleted WHERE id = :subtaskId")
    suspend fun setCompleted(subtaskId: Long, isCompleted: Boolean)

    @Query("SELECT taskId FROM subtasks WHERE id = :subtaskId")
    suspend fun getTaskIdForSubtask(subtaskId: Long): Long?
}
