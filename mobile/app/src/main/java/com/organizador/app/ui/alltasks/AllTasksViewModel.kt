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
    val filterNoCategory: Boolean = false,
    val filterNoDate: Boolean = false,
    val sortOption: TaskSortOption = TaskSortOption.DUE_DATE,
    val recurringTasks: List<TaskWithCategory> = emptyList(),
    val dateGroups: List<DateGroup> = emptyList(),
    val flatTasks: List<TaskWithCategory> = emptyList(),
    val isLoading: Boolean = true,
) {
    val isEmpty: Boolean get() = !isLoading && recurringTasks.isEmpty() && dateGroups.isEmpty() && flatTasks.isEmpty()
}

private data class Filters(
    val categoryId: Long?,
    val query: String,
    val noCategory: Boolean,
    val noDate: Boolean,
)

class AllTasksViewModel(
    private val taskRepository: TaskRepository,
    private val categoryRepository: CategoryRepository,
) : ViewModel() {

    private val selectedCategoryId = MutableStateFlow<Long?>(null)
    private val searchQuery = MutableStateFlow("")
    private val filterNoCategory = MutableStateFlow(false)
    private val filterNoDate = MutableStateFlow(false)
    private val sortOption = MutableStateFlow(TaskSortOption.DUE_DATE)

    private val filters: kotlinx.coroutines.flow.Flow<Filters> = combine(
        selectedCategoryId,
        searchQuery,
        filterNoCategory,
        filterNoDate,
    ) { categoryId, query, noCategory, noDate -> Filters(categoryId, query, noCategory, noDate) }

    val uiState: StateFlow<AllTasksUiState> = combine(
        taskRepository.allTasks,
        categoryRepository.categories,
        filters,
        sortOption,
    ) { allTasks, categories, f, sort ->
        val selectedId = f.categoryId
        val query = f.query
        var filtered = if (selectedId == null) allTasks else allTasks.filter { it.task.categoryId == selectedId }
        val needle = query.trim()
        if (needle.isNotEmpty()) {
            filtered = filtered.filter {
                it.task.title.contains(needle, ignoreCase = true) ||
                    it.task.description?.contains(needle, ignoreCase = true) == true
            }
        }
        if (f.noCategory) filtered = filtered.filter { it.task.categoryId == null }
        if (f.noDate) filtered = filtered.filter { it.task.dueDate == null }

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
                filterNoCategory = f.noCategory,
                filterNoDate = f.noDate,
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
                filterNoCategory = f.noCategory,
                filterNoDate = f.noDate,
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

    fun onFilterNoCategoryChanged(enabled: Boolean) {
        filterNoCategory.value = enabled
    }

    fun onFilterNoDateChanged(enabled: Boolean) {
        filterNoDate.value = enabled
    }

    fun onDuplicate(task: Task) {
        viewModelScope.launch { taskRepository.duplicate(task) }
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
