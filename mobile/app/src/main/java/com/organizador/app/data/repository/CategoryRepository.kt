package com.organizador.app.data.repository

import com.organizador.app.data.local.dao.CategoryDao
import com.organizador.app.data.local.entity.Category
import com.organizador.app.domain.sync.RemoteCategoryDeleter
import kotlinx.coroutines.flow.Flow

class CategoryRepository(
    private val categoryDao: CategoryDao,
    /** Opcional: só definido quando a sincronização com o hub está disponível/logada. */
    private val remoteSync: RemoteCategoryDeleter? = null,
) {
    val categories: Flow<List<Category>> = categoryDao.getAllCategories()

    fun getCategoryById(categoryId: Long): Flow<Category?> = categoryDao.getCategoryById(categoryId)

    suspend fun upsert(category: Category): Long = categoryDao.upsert(category.copy(updatedAt = System.currentTimeMillis()))

    /** Exclui localmente e, se a categoria já foi sincronizada e há sessão ativa, também no servidor
     * (categorias não têm tombstone — a exclusão remota é feita aqui, best-effort, em vez de via sync). */
    suspend fun delete(category: Category) {
        categoryDao.delete(category)
        category.remoteId?.let { remoteSync?.deleteCategory(it) }
    }

    /** Finds a category by name (case-insensitive) or creates it, used by the NL parser's #hashtag matching. */
    suspend fun getOrCreateByName(name: String, defaultColorHex: String): Category {
        categoryDao.findByName(name)?.let { return it }
        val category = Category(name = name, colorHex = defaultColorHex)
        val id = categoryDao.upsert(category)
        return category.copy(id = id)
    }
}
