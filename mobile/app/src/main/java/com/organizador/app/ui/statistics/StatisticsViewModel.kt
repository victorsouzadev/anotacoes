package com.organizador.app.ui.statistics

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.organizador.app.data.repository.TaskRepository
import com.organizador.app.domain.common.toLocalDateTime
import com.organizador.app.domain.model.TaskWithCategory
import java.time.DayOfWeek
import java.time.LocalDate
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

data class DayCount(val date: LocalDate, val dayOfWeek: DayOfWeek, val count: Int)

data class CategoryStat(val name: String?, val colorHex: String?, val completed: Int, val total: Int)

data class StatisticsUiState(
    val totalActive: Int = 0,
    val totalCompleted: Int = 0,
    val totalPomodoros: Int = 0,
    val currentStreakDays: Int = 0,
    val last7Days: List<DayCount> = emptyList(),
    val categoryStats: List<CategoryStat> = emptyList(),
    val isLoading: Boolean = true,
)

class StatisticsViewModel(taskRepository: TaskRepository) : ViewModel() {

    val uiState: StateFlow<StatisticsUiState> = taskRepository.allTasks
        .map(::computeStats)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), StatisticsUiState())

    private fun computeStats(tasks: List<TaskWithCategory>): StatisticsUiState {
        val completedDatesCount: Map<LocalDate, Int> = tasks
            .filter { it.task.isCompleted }
            .mapNotNull { it.task.completedAt?.toLocalDateTime()?.toLocalDate() }
            .groupingBy { it }
            .eachCount()

        val today = LocalDate.now()
        val last7Days = (6 downTo 0).map { offset ->
            val date = today.minusDays(offset.toLong())
            DayCount(date = date, dayOfWeek = date.dayOfWeek, count = completedDatesCount[date] ?: 0)
        }

        // If today has no completions yet, count the streak up to yesterday instead of showing a
        // premature 0 just because the day isn't over.
        var cursor = if ((completedDatesCount[today] ?: 0) > 0) today else today.minusDays(1)
        var streak = 0
        while ((completedDatesCount[cursor] ?: 0) > 0) {
            streak++
            cursor = cursor.minusDays(1)
        }

        // Tarefa com várias categorias entra na contagem de cada uma; sem nenhuma entra em "sem categoria".
        val categoryStats = tasks
            .flatMap { item -> if (item.categories.isEmpty()) listOf(null to item) else item.categories.map { it to item } }
            .groupBy { (category, _) -> category?.id }
            .map { (_, entries) ->
                val category = entries.first().first
                CategoryStat(
                    name = category?.name,
                    colorHex = category?.colorHex,
                    completed = entries.count { (_, item) -> item.task.isCompleted },
                    total = entries.size,
                )
            }
            .sortedByDescending { it.total }

        return StatisticsUiState(
            totalActive = tasks.count { !it.task.isCompleted },
            totalCompleted = tasks.count { it.task.isCompleted },
            totalPomodoros = tasks.sumOf { it.task.completedPomodoros },
            currentStreakDays = streak,
            last7Days = last7Days,
            categoryStats = categoryStats,
            isLoading = false,
        )
    }
}
