package com.organizador.app.data.repository

import com.organizador.app.data.local.dao.TaskTemplateDao
import com.organizador.app.data.local.entity.TaskTemplate
import kotlinx.coroutines.flow.Flow

class TaskTemplateRepository(
    private val taskTemplateDao: TaskTemplateDao,
) {
    val templates: Flow<List<TaskTemplate>> = taskTemplateDao.getAllTemplates()

    suspend fun save(template: TaskTemplate): Long = taskTemplateDao.upsert(template)

    suspend fun delete(template: TaskTemplate) = taskTemplateDao.delete(template)
}
