package com.organizador.app.ui.trash

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.organizador.app.data.local.entity.Task
import com.organizador.app.data.repository.TaskRepository
import com.organizador.app.domain.model.TaskWithCategory
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class TrashViewModel(
    private val taskRepository: TaskRepository,
) : ViewModel() {

    val trashedTasks: StateFlow<List<TaskWithCategory>> = taskRepository.trashedTasks
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    fun onRestore(task: Task) {
        viewModelScope.launch { taskRepository.restoreFromTrash(task) }
    }

    fun onDeletePermanently(task: Task) {
        viewModelScope.launch { taskRepository.permanentlyDelete(task) }
    }
}
