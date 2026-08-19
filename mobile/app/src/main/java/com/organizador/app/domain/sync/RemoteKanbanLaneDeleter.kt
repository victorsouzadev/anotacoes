package com.organizador.app.domain.sync

/**
 * Ponte para o [com.organizador.app.data.repository.KanbanLaneRepository] propagar a exclusão de
 * uma raia do Kanban para o backend de sincronização, sem depender diretamente da camada de
 * rede/login. Assim como categorias, raias não têm tombstone — a exclusão remota é disparada aqui,
 * na hora, best-effort.
 */
interface RemoteKanbanLaneDeleter {
    suspend fun deleteKanbanLane(remoteId: String)
}
