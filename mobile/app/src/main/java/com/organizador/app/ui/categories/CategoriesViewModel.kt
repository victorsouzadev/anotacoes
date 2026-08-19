package com.organizador.app.ui.categories

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.organizador.app.data.local.entity.Category
import com.organizador.app.data.repository.CategoryRepository
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class CategoriesViewModel(
    private val categoryRepository: CategoryRepository,
) : ViewModel() {

    val categories: StateFlow<List<Category>> = categoryRepository.categories
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    fun onSaveCategory(id: Long?, name: String, colorHex: String) {
        val trimmedName = name.trim()
        if (trimmedName.isBlank()) return
        viewModelScope.launch {
            categoryRepository.upsert(Category(id = id ?: 0, name = trimmedName, colorHex = colorHex))
        }
    }

    fun onDeleteCategory(category: Category) {
        viewModelScope.launch { categoryRepository.delete(category) }
    }
}
