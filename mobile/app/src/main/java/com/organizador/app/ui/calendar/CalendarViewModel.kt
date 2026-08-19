package com.organizador.app.ui.calendar

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.organizador.app.data.local.entity.Task
import com.organizador.app.data.repository.TaskRepository
import com.organizador.app.domain.common.toLocalDateTime
import com.organizador.app.domain.model.TaskWithCategory
import java.time.LocalDate
import java.time.YearMonth
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class CalendarUiState(
    val visibleMonth: YearMonth = YearMonth.now(),
    val selectedDate: LocalDate = LocalDate.now(),
    val tasksByDate: Map<LocalDate, List<TaskWithCategory>> = emptyMap(),
    val isLoading: Boolean = true,
) {
    val selectedDateTasks: List<TaskWithCategory> get() = tasksByDate[selectedDate].orEmpty()
}

class CalendarViewModel(
    private val taskRepository: TaskRepository,
) : ViewModel() {

    private val visibleMonth = MutableStateFlow(YearMonth.now())
    private val selectedDate = MutableStateFlow(LocalDate.now())

    val uiState: StateFlow<CalendarUiState> = combine(
        taskRepository.allTasks,
        visibleMonth,
        selectedDate,
    ) { allTasks, month, selected ->
        val tasksByDate = allTasks
            .filter { it.task.dueDate != null }
            .groupBy { it.task.dueDate!!.toLocalDateTime().toLocalDate() }
        CalendarUiState(
            visibleMonth = month,
            selectedDate = selected,
            tasksByDate = tasksByDate,
            isLoading = false,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), CalendarUiState())

    fun onPreviousMonth() {
        visibleMonth.update { it.minusMonths(1) }
    }

    fun onNextMonth() {
        visibleMonth.update { it.plusMonths(1) }
    }

    fun onDaySelected(date: LocalDate) {
        selectedDate.value = date
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
}
