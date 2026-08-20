package com.organizador.app.data.backup

import android.content.Context
import android.net.Uri
import com.organizador.app.data.local.dao.CategoryDao
import com.organizador.app.data.local.dao.SubtaskDao
import com.organizador.app.data.local.dao.TaskCategoryCrossRefDao
import com.organizador.app.data.local.dao.TaskDao
import com.organizador.app.data.local.entity.Category
import com.organizador.app.data.local.entity.Subtask
import com.organizador.app.data.local.entity.Task
import com.organizador.app.domain.model.Priority
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/**
 * Exports/imports every task, category and subtask as a single JSON document via the Storage
 * Access Framework, so backups live wherever the user picks (Downloads, Drive, etc.) with no
 * storage permission needed.
 */
class BackupRepository(
    private val context: Context,
    private val taskDao: TaskDao,
    private val categoryDao: CategoryDao,
    private val taskCategoryCrossRefDao: TaskCategoryCrossRefDao,
    private val subtaskDao: SubtaskDao,
) {
    suspend fun exportToUri(uri: Uri): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val json = buildJson()
            context.contentResolver.openOutputStream(uri)?.use { stream ->
                stream.write(json.toByteArray(Charsets.UTF_8))
            } ?: throw IllegalStateException("Não foi possível abrir o arquivo para escrita")
        }
    }

    suspend fun importFromUri(uri: Uri): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val json = context.contentResolver.openInputStream(uri)?.use { stream ->
                stream.bufferedReader().readText()
            } ?: throw IllegalStateException("Não foi possível abrir o arquivo para leitura")
            applyJson(json)
        }
    }

    private suspend fun buildJson(): String {
        val categories = categoryDao.getAllCategories().first()
        val tasks = taskDao.getAllTasks().first()
        val subtasks = subtaskDao.getAllSubtasks().first()
        val crossRefs = taskCategoryCrossRefDao.getAllCrossRefsOnce()
        val categoryIdsByTaskId = crossRefs.groupBy({ it.taskId }, { it.categoryId })

        val categoriesJson = JSONArray()
        categories.forEach { category ->
            categoriesJson.put(
                JSONObject()
                    .put("id", category.id)
                    .put("name", category.name)
                    .put("colorHex", category.colorHex),
            )
        }

        val tasksJson = JSONArray()
        tasks.forEach { task ->
            val categoryIdsJson = JSONArray()
            categoryIdsByTaskId[task.id].orEmpty().forEach { categoryIdsJson.put(it) }
            tasksJson.put(
                JSONObject()
                    .put("id", task.id)
                    .put("title", task.title)
                    .putOrNull("description", task.description)
                    .putOrNull("dueDate", task.dueDate)
                    .put("priority", task.priority.name)
                    .put("categoryIds", categoryIdsJson)
                    .put("isRecurring", task.isRecurring)
                    .putOrNull("recurrenceRule", task.recurrenceRule)
                    .put("isCompleted", task.isCompleted)
                    .put("createdAt", task.createdAt)
                    .putOrNull("completedAt", task.completedAt),
            )
        }

        val subtasksJson = JSONArray()
        subtasks.forEach { subtask ->
            subtasksJson.put(
                JSONObject()
                    .put("taskId", subtask.taskId)
                    .put("title", subtask.title)
                    .put("isCompleted", subtask.isCompleted)
                    .put("position", subtask.position),
            )
        }

        return JSONObject()
            .put("version", BACKUP_VERSION)
            .put("exportedAt", System.currentTimeMillis())
            .put("categories", categoriesJson)
            .put("tasks", tasksJson)
            .put("subtasks", subtasksJson)
            .toString(2)
    }

    private suspend fun applyJson(json: String) {
        val root = JSONObject(json)

        // Categories are matched by name (not raw id) so importing into a device that already has
        // some categories merges instead of creating duplicates or colliding with existing ids.
        val categoryIdRemap = mutableMapOf<Long, Long>()
        val categoriesArray = root.optJSONArray("categories") ?: JSONArray()
        for (i in 0 until categoriesArray.length()) {
            val obj = categoriesArray.getJSONObject(i)
            val oldId = obj.getLong("id")
            val name = obj.getString("name")
            val existing = categoryDao.findByName(name)
            val newId = existing?.id ?: categoryDao.upsert(
                Category(name = name, colorHex = obj.optString("colorHex", "#3ED9C3")),
            )
            categoryIdRemap[oldId] = newId
        }

        val taskIdRemap = mutableMapOf<Long, Long>()
        val tasksArray = root.optJSONArray("tasks") ?: JSONArray()
        for (i in 0 until tasksArray.length()) {
            val obj = tasksArray.getJSONObject(i)
            val oldId = obj.getLong("id")
            // Formato antigo (versões anteriores da ferramenta) tinha uma única `categoryId`; o novo
            // tem `categoryIds` — aceita os dois pra importar backups antigos sem perder a categoria.
            val oldCategoryIds = obj.optJSONArray("categoryIds")?.let { arr -> (0 until arr.length()).map { arr.getLong(it) } }
                ?: obj.optLongOrNull("categoryId")?.let { listOf(it) }
                ?: emptyList()
            val task = Task(
                title = obj.getString("title"),
                description = obj.optStringOrNull("description"),
                dueDate = obj.optLongOrNull("dueDate"),
                priority = runCatching { Priority.valueOf(obj.getString("priority")) }.getOrDefault(Priority.MEDIUM),
                isRecurring = obj.optBoolean("isRecurring", false),
                recurrenceRule = obj.optStringOrNull("recurrenceRule"),
                isCompleted = obj.optBoolean("isCompleted", false),
                createdAt = obj.optLong("createdAt", System.currentTimeMillis()),
                completedAt = obj.optLongOrNull("completedAt"),
            )
            val newTaskId = taskDao.upsert(task)
            taskIdRemap[oldId] = newTaskId
            val newCategoryIds = oldCategoryIds.mapNotNull { categoryIdRemap[it] }
            if (newCategoryIds.isNotEmpty()) taskCategoryCrossRefDao.replaceForTask(newTaskId, newCategoryIds)
        }

        val subtasksArray = root.optJSONArray("subtasks") ?: JSONArray()
        val subtasksToInsert = mutableListOf<Subtask>()
        for (i in 0 until subtasksArray.length()) {
            val obj = subtasksArray.getJSONObject(i)
            val newTaskId = taskIdRemap[obj.getLong("taskId")] ?: continue
            subtasksToInsert += Subtask(
                taskId = newTaskId,
                title = obj.getString("title"),
                isCompleted = obj.optBoolean("isCompleted", false),
                position = obj.optInt("position", 0),
            )
        }
        if (subtasksToInsert.isNotEmpty()) subtaskDao.upsertAll(subtasksToInsert)
    }

    private fun JSONObject.putOrNull(key: String, value: Any?): JSONObject = put(key, value ?: JSONObject.NULL)

    private fun JSONObject.optLongOrNull(key: String): Long? = if (isNull(key)) null else optLong(key)

    private fun JSONObject.optStringOrNull(key: String): String? =
        if (isNull(key)) null else optString(key).takeIf { it.isNotBlank() }

    companion object {
        private const val BACKUP_VERSION = 1
    }
}
