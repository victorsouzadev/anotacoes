package com.organizador.app.data.remote

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

data class RemoteCategory(val id: String, val name: String, val colorHex: String, val updatedAt: String)

data class RemoteKanbanLane(val id: String, val name: String, val colorHex: String, val position: Int, val updatedAt: String)

data class RemoteTaskComment(val id: String, val taskId: String, val text: String, val createdAt: String, val updatedAt: String)

data class RemoteTaskItem(
    val id: String,
    val title: String,
    val description: String?,
    val dueDate: String?,
    val priority: String,
    val categoryIds: List<String>,
    val kanbanLaneId: String?,
    val isRecurring: Boolean,
    val recurrenceRule: String?,
    val isCompleted: Boolean,
    val createdAt: String,
    val completedAt: String?,
    val deletedAt: String?,
    val completedPomodoros: Int,
    val position: Int,
    val locationLat: Double?,
    val locationLng: Double?,
    val locationRadiusMeters: Float?,
    val locationLabel: String?,
    val subtasks: String,
    val updatedAt: String,
)

class SyncApiException(message: String) : IOException(message)
class SyncUnauthorizedException : IOException("Sessão expirada.")

/**
 * Cliente HTTP para as rotas /api/tasks/... do backend do hub — mesmas rotas usadas pela ferramenta
 * "Tarefas" da versão web. Cada chamada recebe o access token pronto; quem orquestra
 * (TasksSyncRepository) decide se renova a sessão ao ver um [SyncUnauthorizedException].
 */
class TasksSyncApi(private val baseUrlProvider: () -> String) {

    suspend fun fetchCategories(accessToken: String): List<RemoteCategory> {
        val array = request("GET", "/api/tasks/categories", accessToken, null) as JSONArray
        return (0 until array.length()).map { i -> array.getJSONObject(i).toRemoteCategory() }
    }

    suspend fun fetchTasks(accessToken: String): List<RemoteTaskItem> {
        val array = request("GET", "/api/tasks/items", accessToken, null) as JSONArray
        return (0 until array.length()).map { i -> array.getJSONObject(i).toRemoteTaskItem() }
    }

    suspend fun upsertCategory(accessToken: String, category: RemoteCategory): RemoteCategory {
        val body = JSONObject()
            .put("name", category.name)
            .put("colorHex", category.colorHex)
            .put("updatedAt", category.updatedAt)
        val result = request("PUT", "/api/tasks/categories/${category.id}", accessToken, body) as JSONObject
        return result.toRemoteCategory()
    }

    suspend fun deleteCategory(accessToken: String, id: String) {
        request("DELETE", "/api/tasks/categories/$id", accessToken, null)
    }

    suspend fun fetchKanbanLanes(accessToken: String): List<RemoteKanbanLane> {
        val array = request("GET", "/api/tasks/kanban-lanes", accessToken, null) as JSONArray
        return (0 until array.length()).map { i -> array.getJSONObject(i).toRemoteKanbanLane() }
    }

    suspend fun upsertKanbanLane(accessToken: String, lane: RemoteKanbanLane): RemoteKanbanLane {
        val body = JSONObject()
            .put("name", lane.name)
            .put("colorHex", lane.colorHex)
            .put("position", lane.position)
            .put("updatedAt", lane.updatedAt)
        val result = request("PUT", "/api/tasks/kanban-lanes/${lane.id}", accessToken, body) as JSONObject
        return result.toRemoteKanbanLane()
    }

    suspend fun deleteKanbanLane(accessToken: String, id: String) {
        request("DELETE", "/api/tasks/kanban-lanes/$id", accessToken, null)
    }

    suspend fun fetchComments(accessToken: String, taskId: String): List<RemoteTaskComment> {
        val array = request("GET", "/api/tasks/items/$taskId/comments", accessToken, null) as JSONArray
        return (0 until array.length()).map { i -> array.getJSONObject(i).toRemoteTaskComment() }
    }

    suspend fun postComment(accessToken: String, taskId: String, text: String): RemoteTaskComment {
        val body = JSONObject().put("text", text)
        val result = request("POST", "/api/tasks/items/$taskId/comments", accessToken, body) as JSONObject
        return result.toRemoteTaskComment()
    }

    suspend fun deleteComment(accessToken: String, taskId: String, commentId: String) {
        request("DELETE", "/api/tasks/items/$taskId/comments/$commentId", accessToken, null)
    }

    suspend fun upsertTask(accessToken: String, task: RemoteTaskItem): RemoteTaskItem {
        val body = JSONObject()
            .put("title", task.title)
            .put("description", task.description)
            .put("dueDate", task.dueDate)
            .put("priority", task.priority)
            .put("categoryIds", JSONArray(task.categoryIds))
            .put("kanbanLaneId", task.kanbanLaneId)
            .put("isRecurring", task.isRecurring)
            .put("recurrenceRule", task.recurrenceRule)
            .put("isCompleted", task.isCompleted)
            .put("createdAt", task.createdAt)
            .put("completedAt", task.completedAt)
            .put("deletedAt", task.deletedAt)
            .put("completedPomodoros", task.completedPomodoros)
            .put("position", task.position)
            .put("locationLat", task.locationLat)
            .put("locationLng", task.locationLng)
            .put("locationRadiusMeters", task.locationRadiusMeters)
            .put("locationLabel", task.locationLabel)
            .put("subtasks", task.subtasks)
            .put("updatedAt", task.updatedAt)
        val result = request("PUT", "/api/tasks/items/${task.id}", accessToken, body) as JSONObject
        return result.toRemoteTaskItem()
    }

    private suspend fun request(method: String, path: String, accessToken: String, body: JSONObject?): Any =
        withContext(Dispatchers.IO) {
            val connection = URL(baseUrlProvider() + path).openConnection() as HttpURLConnection
            try {
                connection.requestMethod = method
                connection.connectTimeout = 15_000
                connection.readTimeout = 20_000
                connection.setRequestProperty("Authorization", "Bearer $accessToken")
                if (body != null) {
                    connection.doOutput = true
                    connection.setRequestProperty("content-type", "application/json")
                    connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                }

                val responseCode = connection.responseCode
                if (responseCode == 401) throw SyncUnauthorizedException()

                val stream = if (responseCode in 200..299) connection.inputStream else connection.errorStream
                val responseBody = stream?.bufferedReader()?.use { it.readText() }.orEmpty()

                if (responseCode !in 200..299) {
                    val message = runCatching { JSONObject(responseBody).optString("error") }.getOrNull()
                    throw SyncApiException(message?.takeIf { it.isNotBlank() } ?: "Falha ao sincronizar ($responseCode).")
                }
                if (responseCode == 204 || responseBody.isBlank()) return@withContext JSONObject()

                if (responseBody.trimStart().startsWith("[")) JSONArray(responseBody) else JSONObject(responseBody)
            } finally {
                connection.disconnect()
            }
        }
}

private fun JSONObject.toRemoteCategory() = RemoteCategory(
    id = getString("id"),
    name = getString("name"),
    colorHex = getString("colorHex"),
    updatedAt = getString("updatedAt"),
)

private fun JSONObject.toRemoteKanbanLane() = RemoteKanbanLane(
    id = getString("id"),
    name = getString("name"),
    colorHex = getString("colorHex"),
    position = optInt("position", 0),
    updatedAt = getString("updatedAt"),
)

private fun JSONObject.toRemoteTaskComment() = RemoteTaskComment(
    id = getString("id"),
    taskId = getString("taskId"),
    text = getString("text"),
    createdAt = getString("createdAt"),
    updatedAt = getString("updatedAt"),
)

private fun JSONObject.toRemoteTaskItem() = RemoteTaskItem(
    id = getString("id"),
    title = getString("title"),
    description = optStringOrNull("description"),
    dueDate = optStringOrNull("dueDate"),
    priority = getString("priority"),
    categoryIds = optJSONArray("categoryIds")?.let { arr -> (0 until arr.length()).map { arr.getString(it) } } ?: emptyList(),
    kanbanLaneId = optStringOrNull("kanbanLaneId"),
    isRecurring = getBoolean("isRecurring"),
    recurrenceRule = optStringOrNull("recurrenceRule"),
    isCompleted = getBoolean("isCompleted"),
    createdAt = getString("createdAt"),
    completedAt = optStringOrNull("completedAt"),
    deletedAt = optStringOrNull("deletedAt"),
    completedPomodoros = optInt("completedPomodoros", 0),
    position = optInt("position", 0),
    locationLat = if (has("locationLat") && !isNull("locationLat")) getDouble("locationLat") else null,
    locationLng = if (has("locationLng") && !isNull("locationLng")) getDouble("locationLng") else null,
    locationRadiusMeters = if (has("locationRadiusMeters") && !isNull("locationRadiusMeters")) getDouble("locationRadiusMeters").toFloat() else null,
    locationLabel = optStringOrNull("locationLabel"),
    subtasks = optString("subtasks", "[]"),
    updatedAt = getString("updatedAt"),
)

private fun JSONObject.optStringOrNull(name: String): String? =
    if (has(name) && !isNull(name)) getString(name) else null
