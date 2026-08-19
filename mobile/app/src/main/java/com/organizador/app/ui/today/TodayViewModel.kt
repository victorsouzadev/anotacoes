package com.organizador.app.ui.today

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.organizador.app.data.calendar.CalendarProvider
import com.organizador.app.data.local.SettingsStore
import com.organizador.app.data.local.entity.Task
import com.organizador.app.data.repository.TaskRepository
import com.organizador.app.domain.model.CalendarEventItem
import com.organizador.app.domain.model.TaskWithCategory
import com.organizador.app.domain.common.startOfDayMillis
import java.time.LocalDate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class TodayUiState(
    val overdueTasks: List<TaskWithCategory> = emptyList(),
    val todayTasks: List<TaskWithCategory> = emptyList(),
    val calendarEvents: List<CalendarEventItem> = emptyList(),
    val showCalendarSection: Boolean = false,
    val isLoading: Boolean = true,
) {
    val isEmpty: Boolean get() = !isLoading && overdueTasks.isEmpty() && todayTasks.isEmpty() && calendarEvents.isEmpty()
}

class TodayViewModel(
    private val taskRepository: TaskRepository,
    private val appContext: Context,
    private val settingsStore: SettingsStore,
) : ViewModel() {

    private val calendarEvents = MutableStateFlow<List<CalendarEventItem>>(emptyList())

    val uiState: StateFlow<TodayUiState> = run {
        val today = LocalDate.now()
        combine(
            taskRepository.overdueTasks(today.startOfDayMillis()),
            taskRepository.todayTasks(today.startOfDayMillis(), today.plusDays(1).startOfDayMillis()),
            calendarEvents,
            settingsStore.calendarSyncEnabled,
        ) { overdue, todayList, events, calendarEnabled ->
            TodayUiState(
                overdueTasks = overdue,
                todayTasks = todayList,
                calendarEvents = events,
                showCalendarSection = calendarEnabled,
                isLoading = false,
            )
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), TodayUiState())
    }

    init {
        refreshCalendarEvents()
    }

    /** Calendar Provider reads are one-shot cursor queries, not an observable Flow, so the screen
     * calls this again on resume (e.g. after granting permission in Settings and coming back). */
    fun refreshCalendarEvents() {
        if (!settingsStore.calendarSyncEnabled.value || !CalendarProvider.hasPermission(appContext)) {
            calendarEvents.value = emptyList()
            return
        }
        viewModelScope.launch {
            val today = LocalDate.now()
            val events = withContext(Dispatchers.IO) {
                CalendarProvider.eventsForRange(appContext, today.startOfDayMillis(), today.plusDays(1).startOfDayMillis())
            }
            val visibleIds = settingsStore.visibleCalendarIds.value
            calendarEvents.value = if (visibleIds == null) events else events.filter { it.calendarId in visibleIds }
        }
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
