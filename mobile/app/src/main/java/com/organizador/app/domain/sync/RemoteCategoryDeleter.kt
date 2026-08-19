package com.organizador.app.domain.sync

/**
 * Ponte para o [com.organizador.app.data.repository.CategoryRepository] propagar a exclusão de
 * uma categoria para o backend de sincronização, sem depender diretamente da camada de rede/login.
 * Categorias não têm tombstone (ao contrário de tarefas, que reaproveitam a lixeira como tal) —
 * a exclusão remota é disparada aqui, na hora, best-effort.
 */
interface RemoteCategoryDeleter {
    suspend fun deleteCategory(remoteId: String)
}
