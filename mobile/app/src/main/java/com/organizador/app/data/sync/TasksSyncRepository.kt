package com.organizador.app.data.sync

import com.organizador.app.data.local.dao.CategoryDao
import com.organizador.app.data.local.dao.KanbanLaneDao
import com.organizador.app.data.local.dao.SubtaskDao
import com.organizador.app.data.local.dao.TaskCategoryCrossRefDao
import com.organizador.app.data.local.dao.TaskCommentDao
import com.organizador.app.data.local.dao.TaskDao
import com.organizador.app.data.local.entity.Category
import com.organizador.app.data.local.entity.KanbanLane
import com.organizador.app.data.local.entity.Subtask
import com.organizador.app.data.local.entity.Task
import com.organizador.app.data.local.entity.TaskComment
import com.organizador.app.data.remote.RemoteCategory
import com.organizador.app.data.remote.RemoteKanbanLane
import com.organizador.app.data.remote.RemoteTaskItem
import com.organizador.app.data.remote.SyncUnauthorizedException
import com.organizador.app.data.remote.TasksSyncApi
import com.organizador.app.data.repository.AuthRepository
import com.organizador.app.domain.location.LocationReminderScheduler
import com.organizador.app.domain.model.Priority
import com.organizador.app.domain.reminder.TaskReminderScheduler
import com.organizador.app.domain.sync.RemoteCategoryDeleter
import com.organizador.app.domain.sync.RemoteKanbanLaneDeleter
import com.organizador.app.domain.widget.WidgetRefresher
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/**
 * Sincronização completa (não incremental) entre o Room local e o backend do hub, pela mesma
 * conta usada no login da versão web. A cada chamada de [sync]: busca tudo do servidor, mescla no
 * Room por [Task.remoteId]/[Category.remoteId] com "quem editou por último vence"
 * ([Task.updatedAt]/[Category.updatedAt]), depois envia tudo que é local — o PUT do backend é
 * idempotente, então reenviar o que não mudou não tem custo de correção, só de rede. Adequado pra
 * escala pessoal (dezenas/poucas centenas de itens); não tenta ser incremental.
 */
class TasksSyncRepository(
    private val taskDao: TaskDao,
    private val categoryDao: CategoryDao,
    private val taskCategoryCrossRefDao: TaskCategoryCrossRefDao,
    private val kanbanLaneDao: KanbanLaneDao,
    private val taskCommentDao: TaskCommentDao,
    private val subtaskDao: SubtaskDao,
    private val api: TasksSyncApi,
    private val authRepository: AuthRepository,
    private val reminderScheduler: TaskReminderScheduler,
    private val locationReminderScheduler: LocationReminderScheduler,
    private val widgetRefresher: WidgetRefresher,
) : RemoteCategoryDeleter, RemoteKanbanLaneDeleter {

    suspend fun sync(): Result<Unit> = withContext(Dispatchers.IO) {
        val token = authRepository.currentAccessToken()
            ?: return@withContext Result.failure(IllegalStateException("Não conectado."))
        runCatching { runSync(token) }
            .recoverCatching { error ->
                if (error !is SyncUnauthorizedException) throw error
                val refreshed = authRepository.refreshAccessToken()
                    ?: throw IllegalStateException("Sessão expirada — entre novamente.")
                runSync(refreshed)
            }
    }

    override suspend fun deleteCategory(remoteId: String) {
        val token = authRepository.currentAccessToken() ?: return
        runCatching { api.deleteCategory(token, remoteId) }
    }

    override suspend fun deleteKanbanLane(remoteId: String) {
        val token = authRepository.currentAccessToken() ?: return
        runCatching { api.deleteKanbanLane(token, remoteId) }
    }

    /** Busca (e cacheia localmente) os comentários de uma tarefa. Chamado sob demanda ao abrir a
     * tela de edição, não faz parte do [sync] periódico — comentário é só append/consulta, sem
     * conflito a resolver. */
    suspend fun fetchComments(localTaskId: Long, taskRemoteId: String): Result<Unit> = runCatching {
        val token = authRepository.currentAccessToken() ?: throw IllegalStateException("Não conectado.")
        val remote = runCatching { api.fetchComments(token, taskRemoteId) }
            .recoverCatching { error ->
                if (error !is SyncUnauthorizedException) throw error
                val refreshed = authRepository.refreshAccessToken() ?: throw IllegalStateException("Sessão expirada.")
                api.fetchComments(refreshed, taskRemoteId)
            }
            .getOrThrow()
        taskCommentDao.clearSyncedForTask(localTaskId)
        for (r in remote) {
            taskCommentDao.insert(
                TaskComment(taskId = localTaskId, text = r.text, createdAt = r.createdAt.toEpochMillis(), remoteId = r.id),
            )
        }
    }

    suspend fun postComment(localTaskId: Long, taskRemoteId: String, text: String): Result<TaskComment> = runCatching {
        val token = authRepository.currentAccessToken() ?: throw IllegalStateException("Não conectado.")
        val saved = runCatching { api.postComment(token, taskRemoteId, text) }
            .recoverCatching { error ->
                if (error !is SyncUnauthorizedException) throw error
                val refreshed = authRepository.refreshAccessToken() ?: throw IllegalStateException("Sessão expirada.")
                api.postComment(refreshed, taskRemoteId, text)
            }
            .getOrThrow()
        val comment = TaskComment(taskId = localTaskId, text = saved.text, createdAt = saved.createdAt.toEpochMillis(), remoteId = saved.id)
        val id = taskCommentDao.insert(comment)
        comment.copy(id = id)
    }

    suspend fun deleteComment(taskRemoteId: String, comment: TaskComment) {
        taskCommentDao.delete(comment)
        val remoteId = comment.remoteId ?: return
        val token = authRepository.currentAccessToken() ?: return
        runCatching { api.deleteComment(token, taskRemoteId, remoteId) }
    }

    private suspend fun runSync(token: String) {
        syncCategories(token)
        syncKanbanLanes(token)
        syncTasks(token)
        widgetRefresher.refresh()
    }

    private suspend fun syncKanbanLanes(token: String) {
        val remote = api.fetchKanbanLanes(token)
        for (r in remote) {
            val local = kanbanLaneDao.findByRemoteId(r.id)
            val remoteMillis = r.updatedAt.toEpochMillis()
            if (local == null) {
                kanbanLaneDao.upsert(KanbanLane(name = r.name, colorHex = r.colorHex, position = r.position, remoteId = r.id, updatedAt = remoteMillis))
            } else if (remoteMillis > local.updatedAt) {
                kanbanLaneDao.upsert(local.copy(name = r.name, colorHex = r.colorHex, position = r.position, updatedAt = remoteMillis))
            }
        }

        for (l in kanbanLaneDao.getAllLanesOnce()) {
            val remoteId = l.remoteId ?: UUID.randomUUID().toString()
            val saved = api.upsertKanbanLane(token, RemoteKanbanLane(remoteId, l.name, l.colorHex, l.position, l.updatedAt.toIso()))
            if (l.remoteId == null) kanbanLaneDao.setRemoteId(l.id, remoteId)
            val savedMillis = saved.updatedAt.toEpochMillis()
            if (savedMillis > l.updatedAt) {
                kanbanLaneDao.upsert(l.copy(remoteId = remoteId, name = saved.name, colorHex = saved.colorHex, position = saved.position, updatedAt = savedMillis))
            }
        }
    }

    private suspend fun syncCategories(token: String) {
        // Pull: aplica o que veio do servidor localmente (servidor vence se for mais novo).
        val remote = api.fetchCategories(token)
        for (r in remote) {
            val local = categoryDao.findByRemoteId(r.id)
            val remoteMillis = r.updatedAt.toEpochMillis()
            if (local == null) {
                categoryDao.upsert(Category(name = r.name, colorHex = r.colorHex, remoteId = r.id, updatedAt = remoteMillis))
            } else if (remoteMillis > local.updatedAt) {
                categoryDao.upsert(local.copy(name = r.name, colorHex = r.colorHex, updatedAt = remoteMillis))
            }
        }

        // Push: manda tudo que é local. Upsert idempotente no servidor — reenviar o que já está
        // igual não tem efeito, só custo de rede.
        for (c in categoryDao.getAllCategoriesOnce()) {
            val remoteId = c.remoteId ?: UUID.randomUUID().toString()
            val saved = api.upsertCategory(token, RemoteCategory(remoteId, c.name, c.colorHex, c.updatedAt.toIso()))
            if (c.remoteId == null) categoryDao.setRemoteId(c.id, remoteId)
            val savedMillis = saved.updatedAt.toEpochMillis()
            // O servidor pode ter "vencido" o conflito (alguém mexeu nela em outro lugar entre o
            // pull e o push desta rodada) — reflete o resultado de volta no Room.
            if (savedMillis > c.updatedAt) {
                categoryDao.upsert(c.copy(remoteId = remoteId, name = saved.name, colorHex = saved.colorHex, updatedAt = savedMillis))
            }
        }
    }

    private suspend fun syncTasks(token: String) {
        // Resolvidos DEPOIS do syncCategories acima, então todo remoteId de categoria já existe.
        val syncedCategories = categoryDao.getAllCategoriesOnce().filter { it.remoteId != null }
        val categoriesByRemoteId = syncedCategories.associateBy { it.remoteId!! }
        val categoryRemoteIdByLocalId = syncedCategories.associateBy({ it.id }, { it.remoteId!! })

        val syncedLanes = kanbanLaneDao.getAllLanesOnce().filter { it.remoteId != null }
        val lanesByRemoteId = syncedLanes.associateBy { it.remoteId!! }
        val laneRemoteIdByLocalId = syncedLanes.associateBy({ it.id }, { it.remoteId!! })

        val remote = api.fetchTasks(token)
        for (r in remote) {
            val local = taskDao.findByRemoteId(r.id)
            val remoteMillis = r.updatedAt.toEpochMillis()
            val categoryLocalIds = r.categoryIds.mapNotNull { categoriesByRemoteId[it]?.id }
            val laneLocalId = r.kanbanLaneId?.let { lanesByRemoteId[it]?.id }

            val localId = when {
                local == null -> taskDao.upsert(r.toLocalTask(id = 0, kanbanLaneId = laneLocalId))
                remoteMillis > local.updatedAt -> {
                    taskDao.upsert(
                        r.toLocalTask(id = local.id, kanbanLaneId = laneLocalId).copy(
                            // Estado só-do-aparelho: cada dispositivo tem o seu, não vem do servidor.
                            calendarEventId = local.calendarEventId,
                            photoPath = local.photoPath,
                        ),
                    )
                    local.id
                }
                else -> null // local está igual ou mais novo — nada a aplicar do pull pra esta tarefa
            }

            if (localId != null) {
                taskCategoryCrossRefDao.replaceForTask(localId, categoryLocalIds)
                applyRemoteSubtasks(localId, r.subtasks)
                val applied = taskDao.getTaskOnce(localId) ?: continue
                reminderScheduler.schedule(applied)
                locationReminderScheduler.schedule(applied)
            }
        }

        for (t in taskDao.getAllTasksOnce()) {
            val remoteId = t.remoteId ?: UUID.randomUUID().toString()
            val categoryRemoteIds = taskCategoryCrossRefDao.getCategoryIdsForTaskOnce(t.id).mapNotNull { categoryRemoteIdByLocalId[it] }
            val payload = RemoteTaskItem(
                id = remoteId,
                title = t.title,
                description = t.description,
                dueDate = t.dueDate?.toIso(),
                priority = t.priority.toWire(),
                categoryIds = categoryRemoteIds,
                kanbanLaneId = t.kanbanLaneId?.let { laneRemoteIdByLocalId[it] },
                isRecurring = t.isRecurring,
                recurrenceRule = t.recurrenceRule,
                isCompleted = t.isCompleted,
                createdAt = t.createdAt.toIso(),
                completedAt = t.completedAt?.toIso(),
                deletedAt = t.deletedAt?.toIso(),
                completedPomodoros = t.completedPomodoros,
                position = t.position,
                locationLat = t.locationLat,
                locationLng = t.locationLng,
                locationRadiusMeters = t.locationRadiusMeters,
                locationLabel = t.locationLabel,
                subtasks = subtaskDao.getSubtasksForTask(t.id).first().toSubtasksJson(),
                updatedAt = t.updatedAt.toIso(),
            )
            val saved = api.upsertTask(token, payload)
            if (t.remoteId == null) taskDao.setRemoteId(t.id, remoteId)

            val savedMillis = saved.updatedAt.toEpochMillis()
            if (savedMillis > t.updatedAt) {
                // Corrida rara: outro dispositivo sincronizou uma versão mais nova entre o pull e
                // o push desta rodada — o servidor "venceu", reflete o resultado de volta.
                val laneLocalId = saved.kanbanLaneId?.let { lanesByRemoteId[it]?.id }
                taskDao.upsert(saved.toLocalTask(id = t.id, kanbanLaneId = laneLocalId).copy(
                    calendarEventId = t.calendarEventId,
                    photoPath = t.photoPath,
                ))
                val categoryLocalIds = saved.categoryIds.mapNotNull { categoriesByRemoteId[it]?.id }
                taskCategoryCrossRefDao.replaceForTask(t.id, categoryLocalIds)
                applyRemoteSubtasks(t.id, saved.subtasks)
                val applied = taskDao.getTaskOnce(t.id) ?: continue
                reminderScheduler.schedule(applied)
                locationReminderScheduler.schedule(applied)
            }
        }
    }

    private suspend fun applyRemoteSubtasks(taskId: Long, subtasksJson: String) {
        subtaskDao.deleteAllForTask(taskId)
        val parsed = parseSubtasksJson(subtasksJson)
        if (parsed.isNotEmpty()) {
            subtaskDao.upsertAll(
                parsed.mapIndexed { index, (title, isCompleted) ->
                    Subtask(taskId = taskId, title = title, isCompleted = isCompleted, position = index)
                },
            )
        }
    }
}

private fun RemoteTaskItem.toLocalTask(id: Long, kanbanLaneId: Long?): Task = Task(
    id = id,
    title = title,
    description = description,
    dueDate = dueDate?.toEpochMillisOrNull(),
    priority = priority.toPriority(),
    kanbanLaneId = kanbanLaneId,
    isRecurring = isRecurring,
    recurrenceRule = recurrenceRule,
    isCompleted = isCompleted,
    createdAt = createdAt.toEpochMillis(),
    completedAt = completedAt?.toEpochMillisOrNull(),
    deletedAt = deletedAt?.toEpochMillisOrNull(),
    completedPomodoros = completedPomodoros,
    position = position,
    remoteId = this.id,
    updatedAt = updatedAt.toEpochMillis(),
    locationLat = locationLat,
    locationLng = locationLng,
    locationRadiusMeters = locationRadiusMeters,
    locationLabel = locationLabel,
)

private fun Long.toIso(): String = Instant.ofEpochMilli(this).toString()
private fun String.toEpochMillis(): Long = Instant.parse(this).toEpochMilli()
private fun String?.toEpochMillisOrNull(): Long? = this?.let { Instant.parse(it).toEpochMilli() }

private fun Priority.toWire(): String = when (this) {
    Priority.LOW -> "Low"
    Priority.MEDIUM -> "Medium"
    Priority.HIGH -> "High"
}

private fun String.toPriority(): Priority = when (lowercase()) {
    "low" -> Priority.LOW
    "high" -> Priority.HIGH
    else -> Priority.MEDIUM
}

private fun List<Subtask>.toSubtasksJson(): String {
    val array = JSONArray()
    for (s in sortedBy { it.position }) {
        array.put(JSONObject().put("title", s.title).put("isCompleted", s.isCompleted).put("position", s.position))
    }
    return array.toString()
}

private fun parseSubtasksJson(json: String): List<Pair<String, Boolean>> = try {
    val array = JSONArray(json)
    (0 until array.length()).map { i ->
        val obj = array.getJSONObject(i)
        obj.getString("title") to obj.optBoolean("isCompleted", false)
    }
} catch (e: Exception) {
    emptyList()
}
