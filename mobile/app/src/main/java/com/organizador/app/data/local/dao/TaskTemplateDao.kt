package com.organizador.app.data.local.dao

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Query
import androidx.room.Upsert
import com.organizador.app.data.local.entity.TaskTemplate
import kotlinx.coroutines.flow.Flow

@Dao
interface TaskTemplateDao {

    @Query("SELECT * FROM task_templates ORDER BY name ASC")
    fun getAllTemplates(): Flow<List<TaskTemplate>>

    @Query("SELECT * FROM task_templates WHERE id = :templateId")
    suspend fun getTemplateById(templateId: Long): TaskTemplate?

    @Upsert
    suspend fun upsert(template: TaskTemplate): Long

    @Delete
    suspend fun delete(template: TaskTemplate)
}
