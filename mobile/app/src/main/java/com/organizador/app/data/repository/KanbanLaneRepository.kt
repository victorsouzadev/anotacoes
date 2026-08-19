package com.organizador.app.data.repository

import com.organizador.app.data.local.dao.KanbanLaneDao
import com.organizador.app.data.local.entity.KanbanLane
import com.organizador.app.domain.sync.RemoteKanbanLaneDeleter
import kotlinx.coroutines.flow.Flow

class KanbanLaneRepository(
    private val kanbanLaneDao: KanbanLaneDao,
    /** Opcional: só definido quando a sincronização com o hub está disponível/logada. */
    private val remoteSync: RemoteKanbanLaneDeleter? = null,
) {
    val lanes: Flow<List<KanbanLane>> = kanbanLaneDao.getAllLanes()

    fun getLaneById(laneId: Long): Flow<KanbanLane?> = kanbanLaneDao.getLaneById(laneId)

    suspend fun upsert(lane: KanbanLane): Long = kanbanLaneDao.upsert(lane.copy(updatedAt = System.currentTimeMillis()))

    suspend fun create(name: String, colorHex: String): KanbanLane {
        val position = (kanbanLaneDao.getAllLanesOnce().maxOfOrNull { it.position } ?: -1) + 1
        val lane = KanbanLane(name = name, colorHex = colorHex, position = position)
        val id = kanbanLaneDao.upsert(lane)
        return lane.copy(id = id)
    }

    /** Exclui localmente e, se a raia já foi sincronizada e há sessão ativa, também no servidor
     * (raias não têm tombstone — a exclusão remota é feita aqui, best-effort, em vez de via sync). */
    suspend fun delete(lane: KanbanLane) {
        kanbanLaneDao.delete(lane)
        lane.remoteId?.let { remoteSync?.deleteKanbanLane(it) }
    }
}
