package com.organizador.app.data.local.dao

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.Query
import com.organizador.app.data.local.entity.TaskComment
import kotlinx.coroutines.flow.Flow

@Dao
interface TaskCommentDao {

    @Query("SELECT * FROM task_comments WHERE taskId = :taskId ORDER BY createdAt ASC")
    fun getCommentsForTask(taskId: Long): Flow<List<TaskComment>>

    @Query("SELECT * FROM task_comments WHERE taskId = :taskId ORDER BY createdAt ASC")
    suspend fun getCommentsForTaskOnce(taskId: Long): List<TaskComment>

    @Insert
    suspend fun insert(comment: TaskComment): Long

    @Query("UPDATE task_comments SET remoteId = :remoteId WHERE id = :commentId")
    suspend fun setRemoteId(commentId: Long, remoteId: String)

    @Delete
    suspend fun delete(comment: TaskComment)

    @Query("DELETE FROM task_comments WHERE taskId = :taskId AND remoteId IS NOT NULL")
    suspend fun clearSyncedForTask(taskId: Long)
}
