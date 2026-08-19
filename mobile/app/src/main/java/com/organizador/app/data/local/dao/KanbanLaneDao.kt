package com.organizador.app.data.local.dao

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Query
import androidx.room.Upsert
import com.organizador.app.data.local.entity.KanbanLane
import kotlinx.coroutines.flow.Flow

@Dao
interface KanbanLaneDao {

    @Query("SELECT * FROM kanban_lanes ORDER BY position ASC")
    fun getAllLanes(): Flow<List<KanbanLane>>

    @Query("SELECT * FROM kanban_lanes WHERE id = :laneId")
    fun getLaneById(laneId: Long): Flow<KanbanLane?>

    @Query("SELECT * FROM kanban_lanes WHERE name = :name COLLATE NOCASE LIMIT 1")
    suspend fun findByName(name: String): KanbanLane?

    /** Todas as raias, usado pelo sync. */
    @Query("SELECT * FROM kanban_lanes ORDER BY position ASC")
    suspend fun getAllLanesOnce(): List<KanbanLane>

    @Query("SELECT * FROM kanban_lanes WHERE remoteId = :remoteId LIMIT 1")
    suspend fun findByRemoteId(remoteId: String): KanbanLane?

    @Query("UPDATE kanban_lanes SET remoteId = :remoteId WHERE id = :laneId")
    suspend fun setRemoteId(laneId: Long, remoteId: String)

    @Upsert
    suspend fun upsert(lane: KanbanLane): Long

    @Delete
    suspend fun delete(lane: KanbanLane)
}
