package com.organizador.app.data.repository

import com.organizador.app.data.local.dao.TaskCommentDao
import com.organizador.app.data.local.entity.Task
import com.organizador.app.data.local.entity.TaskComment
import com.organizador.app.data.sync.TasksSyncRepository
import kotlinx.coroutines.flow.Flow

/**
 * Comentários de tarefa: cache local (Room) + sincronização sob demanda com o backend, via
 * [TasksSyncRepository]. Diferente de categoria/raia/tarefa, não há upsert idempotente pra
 * comentário no servidor — é só busca (na abertura da tela) e postagem/exclusão diretas.
 */
class TaskCommentRepository(
    private val taskCommentDao: TaskCommentDao,
    private val syncRepository: TasksSyncRepository,
) {
    fun commentsForTask(taskId: Long): Flow<List<TaskComment>> = taskCommentDao.getCommentsForTask(taskId)

    /** Busca os comentários do servidor e atualiza o cache local; sem efeito se a tarefa nunca sincronizou. */
    suspend fun refresh(task: Task) {
        val remoteId = task.remoteId ?: return
        syncRepository.fetchComments(task.id, remoteId)
    }

    suspend fun post(task: Task, text: String): Result<TaskComment> {
        val remoteId = task.remoteId
            ?: return Result.failure(IllegalStateException("Tarefa ainda não sincronizada."))
        return syncRepository.postComment(task.id, remoteId, text)
    }

    suspend fun delete(task: Task, comment: TaskComment) {
        val remoteId = task.remoteId ?: return
        syncRepository.deleteComment(remoteId, comment)
    }
}
