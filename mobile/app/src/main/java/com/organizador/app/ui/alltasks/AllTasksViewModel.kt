package com.organizador.app.ui.alltasks

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.organizador.app.data.local.entity.Category
import com.organizador.app.data.local.entity.Task
import com.organizador.app.data.repository.CategoryRepository
import com.organizador.app.data.repository.TaskRepository
import com.organizador.app.domain.common.toLocalDateTime
import com.organizador.app.domain.model.TaskWithCategory
import java.time.LocalDate
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class DateGroup(
    val date: LocalDate?,
    val tasks: List<TaskWithCategory>,
)

enum class TaskSortOption { DUE_DATE, PRIORITY, ALPHABETICAL, MANUAL }

data class AllTasksUiState(
    val categories: List<Category> = emptyList(),
    val selectedCategoryId: Long? = null,
    val searchQuery: String = "",
    val sortOption: TaskSortOption = TaskSortOption.DUE_DATE,
    val recurringTasks: List<TaskWithCategory> = emptyList(),
    val dateGroups: List<DateGroup> = emptyList(),
    val flatTasks: List<TaskWithCategory> = emptyList(),
    val isLoading: Boolean = true,
) {
    val isEmpty: Boolean get() = !isLoading && recurringTasks.isEmpty() && dateGroups.isEmpty() && flatTasks.isEmpty()
}

class AllTasksViewModel(
    private val taskRepository: TaskRepository,
    private val categoryRepository: CategoryRepository,
) : ViewModel() {

    private val selectedCategoryId = MutableStateFlow<Long?>(null)
    private val searchQuery = MutableStateFlow("")
    private val sortOption = MutableStateFlow(TaskSortOption.DUE_DATE)

    val uiState: StateFlow<AllTasksUiState> = combine(
        taskRepository.allTasks,
        categoryRepository.categories,
        selectedCategoryId,
        searchQuery,
        sortOption,
    ) { allTasks, categories, selectedId, query, sort ->
        var filtered = if (selectedId == null) allTasks else allTasks.filter { it.task.categoryId == selectedId }
        val needle = query.trim()
        if (needle.isNotEmpty()) {
            filtered = filtered.filter { it.task.title.contains(needle, ignoreCase = true) }
        }

        val recurring = filtered.filter { it.task.isRecurring }
        val dated = filtered.filter { !it.task.isRecurring }

        if (sort == TaskSortOption.DUE_DATE) {
            val (withDueDate, withoutDueDate) = dated.partition { it.task.dueDate != null }
            val groupsByDate = withDueDate
                .groupBy { it.task.dueDate!!.toLocalDateTime().toLocalDate() }
                .toSortedMap()
                .map { (date, tasks) -> DateGroup(date, tasks) }
            val groups = if (withoutDueDate.isNotEmpty()) groupsByDate + DateGroup(null, withoutDueDate) else groupsByDate

            AllTasksUiState(
                categories = categories,
                selectedCategoryId = selectedId,
                searchQuery = query,
                sortOption = sort,
                recurringTasks = recurring,
                dateGroups = groups,
                isLoading = false,
            )
        } else {
            val sorted = when (sort) {
                TaskSortOption.PRIORITY -> dated.sortedByDescending { it.task.priority.ordinal }
                TaskSortOption.MANUAL -> dated.sortedWith(compareBy({ it.task.position }, { it.task.id }))
                else -> dated.sortedBy { it.task.title.lowercase() }
            }
            AllTasksUiState(
                categories = categories,
                selectedCategoryId = selectedId,
                searchQuery = query,
                sortOption = sort,
                recurringTasks = recurring,
                flatTasks = sorted,
                isLoading = false,
            )
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), AllTasksUiState())

    fun onSelectCategory(categoryId: Long?) {
        selectedCategoryId.value = categoryId
    }

    fun onSearchQueryChanged(query: String) {
        searchQuery.value = query
    }

    fun onSortOptionSelected(option: TaskSortOption) {
        sortOption.value = option
    }

    fun onToggleCompleted(taskId: Long, isCompleted: Boolean) {
        viewModelScope.launch { taskRepository.setCompleted(taskId, isCompleted) }
    }

    fun onToggleSubtask(subtaskId: Long, isCompleted: Boolean) {
        viewModelScope.launch { taskRepository.setSubtaskCompleted(subtaskId, isCompleted) }
    }

    fun onMoveToTrash(task: Task) {
        viewModelScope.launch { taskRepository.moveToTrash(task) }
    }

    fun onRestoreFromTrash(task: Task) {
        viewModelScope.launch { taskRepository.restoreFromTrash(task) }
    }

    /** Persists a drag-reordered manual list; [orderedTaskIds] is the full top-to-bottom order the user just arranged. */
    fun onReorder(orderedTaskIds: List<Long>) {
        viewModelScope.launch { taskRepository.reorderTasks(orderedTaskIds) }
    }
}
