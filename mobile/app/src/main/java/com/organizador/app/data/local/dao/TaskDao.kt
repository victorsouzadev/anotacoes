package com.organizador.app.data.local.dao

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Upsert
import com.organizador.app.data.local.entity.Task
import kotlinx.coroutines.flow.Flow

@Dao
interface TaskDao {

    @Query("SELECT * FROM tasks WHERE deletedAt IS NULL ORDER BY dueDate IS NULL, dueDate ASC, priority DESC")
    fun getAllTasks(): Flow<List<Task>>

    @Query(
        """
        SELECT * FROM tasks
        WHERE isCompleted = 0 AND deletedAt IS NULL AND dueDate IS NOT NULL
              AND dueDate >= :startOfDayMillis AND dueDate < :endOfDayMillis
        ORDER BY dueDate ASC
        """,
    )
    fun getTodayTasks(startOfDayMillis: Long, endOfDayMillis: Long): Flow<List<Task>>

    @Query(
        """
        SELECT * FROM tasks
        WHERE isCompleted = 0 AND deletedAt IS NULL AND dueDate IS NOT NULL AND dueDate < :startOfDayMillis
        ORDER BY dueDate ASC
        """,
    )
    fun getOverdueTasks(startOfDayMillis: Long): Flow<List<Task>>

    @Query("SELECT * FROM tasks WHERE isRecurring = 1 AND deletedAt IS NULL ORDER BY dueDate IS NULL, dueDate ASC")
    fun getRecurringTasks(): Flow<List<Task>>

    @Query("SELECT * FROM tasks WHERE categoryId = :categoryId AND deletedAt IS NULL ORDER BY dueDate IS NULL, dueDate ASC")
    fun getTasksByCategory(categoryId: Long): Flow<List<Task>>

    @Query("SELECT * FROM tasks WHERE id = :taskId")
    fun getTaskById(taskId: Long): Flow<Task?>

    @Query("SELECT * FROM tasks WHERE id = :taskId")
    suspend fun getTaskOnce(taskId: Long): Task?

    @Query("SELECT * FROM tasks WHERE deletedAt IS NOT NULL ORDER BY deletedAt DESC")
    fun getTrashedTasks(): Flow<List<Task>>

    /** Todas as tarefas (inclusive na lixeira), usado pelo sync — que precisa dos tombstones pra propagar exclusões. */
    @Query("SELECT * FROM tasks")
    suspend fun getAllTasksOnce(): List<Task>

    @Query("SELECT * FROM tasks WHERE remoteId = :remoteId LIMIT 1")
    suspend fun findByRemoteId(remoteId: String): Task?

    @Query("UPDATE tasks SET remoteId = :remoteId WHERE id = :taskId")
    suspend fun setRemoteId(taskId: Long, remoteId: String)

    /** Marca a tarefa como modificada agora, sem mudar mais nada — usado quando uma subtarefa dela muda (subtasks vão embutidas no payload de sync da tarefa). */
    @Query("UPDATE tasks SET updatedAt = :updatedAt WHERE id = :taskId")
    suspend fun touchUpdatedAt(taskId: Long, updatedAt: Long = System.currentTimeMillis())

    @Upsert
    suspend fun upsert(task: Task): Long

    @Delete
    suspend fun delete(task: Task)

    @Query("UPDATE tasks SET isCompleted = :isCompleted, completedAt = :completedAt, updatedAt = :updatedAt WHERE id = :taskId")
    suspend fun setCompleted(taskId: Long, isCompleted: Boolean, completedAt: Long?, updatedAt: Long = System.currentTimeMillis())

    @Query("UPDATE tasks SET deletedAt = :deletedAt, updatedAt = :updatedAt WHERE id = :taskId")
    suspend fun setDeletedAt(taskId: Long, deletedAt: Long?, updatedAt: Long = System.currentTimeMillis())

    @Query("DELETE FROM tasks WHERE deletedAt IS NOT NULL AND deletedAt < :beforeMillis")
    suspend fun purgeTrashedBefore(beforeMillis: Long)

    @Query("UPDATE tasks SET completedPomodoros = completedPomodoros + 1, updatedAt = :updatedAt WHERE id = :taskId")
    suspend fun incrementPomodoroCount(taskId: Long, updatedAt: Long = System.currentTimeMillis())

    /** Local ao dispositivo — não é sincronizado, por isso não mexe em updatedAt. */
    @Query("UPDATE tasks SET calendarEventId = :calendarEventId WHERE id = :taskId")
    suspend fun setCalendarEventId(taskId: Long, calendarEventId: Long?)

    @Query("UPDATE tasks SET position = :position, updatedAt = :updatedAt WHERE id = :taskId")
    suspend fun setPosition(taskId: Long, position: Int, updatedAt: Long = System.currentTimeMillis())

    /** Persists a full manual ordering: [orderedTaskIds] is the desired top-to-bottom order, each id given a sequential position. */
    @Transaction
    suspend fun updatePositions(orderedTaskIds: List<Long>) {
        val now = System.currentTimeMillis()
        orderedTaskIds.forEachIndexed { index, taskId -> setPosition(taskId, index, now) }
    }
}
