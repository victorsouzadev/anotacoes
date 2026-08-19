package com.organizador.app.ui.calendar

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.organizador.app.R
import com.organizador.app.domain.model.TaskWithCategory
import com.organizador.app.ui.common.formatSectionDateLabel
import com.organizador.app.ui.common.rememberViewModelFactory
import com.organizador.app.ui.common.weekdayShortLabel
import com.organizador.app.ui.components.SwipeableTaskCard
import com.organizador.app.ui.navigation.BottomNavBar
import com.organizador.app.ui.navigation.BottomNavItem
import com.organizador.app.ui.theme.Accent
import com.organizador.app.ui.theme.Background
import com.organizador.app.ui.theme.OnBackground
import com.organizador.app.ui.theme.OnSurfaceSecondary
import com.organizador.app.ui.theme.Surface as SurfaceColor
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.TextStyle
import java.util.Locale
import kotlinx.coroutines.launch

private val ptBr = Locale("pt", "BR")

@Composable
fun CalendarScreen(
    onNewTask: () -> Unit,
    onTaskClick: (Long) -> Unit,
    onNavigate: (BottomNavItem) -> Unit,
    onStartPomodoro: (Long, String) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: CalendarViewModel = viewModel(factory = rememberViewModelFactory()),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val coroutineScope = rememberCoroutineScope()
    val completedMessage = stringResource(R.string.undo_task_completed)
    val trashedMessage = stringResource(R.string.undo_task_trashed)
    val undoLabel = stringResource(R.string.undo_action)

    val onToggleCompletedWithUndo: (Long, Boolean) -> Unit = { taskId, checked ->
        viewModel.onToggleCompleted(taskId, checked)
        if (checked) {
            coroutineScope.launch {
                val result = snackbarHostState.showSnackbar(
                    message = completedMessage,
                    actionLabel = undoLabel,
                    duration = SnackbarDuration.Short,
                )
                if (result == SnackbarResult.ActionPerformed) {
                    viewModel.onToggleCompleted(taskId, false)
                }
            }
        }
    }

    val onSwipeToDeleteWithUndo: (TaskWithCategory) -> Unit = { item ->
        viewModel.onMoveToTrash(item.task)
        coroutineScope.launch {
            val result = snackbarHostState.showSnackbar(
                message = trashedMessage,
                actionLabel = undoLabel,
                duration = SnackbarDuration.Short,
            )
            if (result == SnackbarResult.ActionPerformed) {
                viewModel.onRestoreFromTrash(item.task)
            }
        }
    }

    Scaffold(
        modifier = modifier,
        containerColor = Background,
        topBar = {
            CenterAlignedTopAppBar(
                title = { Text(stringResource(R.string.calendar_title), style = MaterialTheme.typography.titleLarge) },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = Background),
            )
        },
        bottomBar = { BottomNavBar(currentItem = BottomNavItem.CALENDAR, onNavigate = onNavigate) },
        floatingActionButton = {
            FloatingActionButton(onClick = onNewTask) {
                Icon(Icons.Filled.Add, contentDescription = stringResource(R.string.new_task_fab))
            }
        },
        snackbarHost = {
            SnackbarHost(snackbarHostState) { data ->
                Snackbar(snackbarData = data, containerColor = SurfaceColor, actionColor = Accent)
            }
        },
    ) { paddingValues ->
        Column(modifier = Modifier.fillMaxSize().padding(top = paddingValues.calculateTopPadding())) {
            MonthHeader(
                month = uiState.visibleMonth,
                onPrevious = viewModel::onPreviousMonth,
                onNext = viewModel::onNextMonth,
            )
            WeekdayHeaderRow()
            MonthGrid(
                month = uiState.visibleMonth,
                selectedDate = uiState.selectedDate,
                tasksByDate = uiState.tasksByDate,
                onDaySelected = viewModel::onDaySelected,
            )

            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(
                    start = 16.dp,
                    end = 16.dp,
                    top = 8.dp,
                    bottom = paddingValues.calculateBottomPadding() + 96.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                item {
                    Text(
                        text = formatSectionDateLabel(uiState.selectedDate),
                        style = MaterialTheme.typography.labelMedium,
                        color = OnSurfaceSecondary,
                    )
                }
                if (uiState.selectedDateTasks.isEmpty()) {
                    item {
                        Text(
                            text = stringResource(R.string.calendar_day_empty),
                            style = MaterialTheme.typography.bodyMedium,
                            color = OnSurfaceSecondary,
                            modifier = Modifier.padding(vertical = 24.dp),
                        )
                    }
                } else {
                    items(uiState.selectedDateTasks, key = { it.task.id }) { item ->
                        SwipeableTaskCard(
                            taskWithCategory = item,
                            onToggleCompleted = { checked -> onToggleCompletedWithUndo(item.task.id, checked) },
                            onClick = { onTaskClick(item.task.id) },
                            onToggleSubtask = viewModel::onToggleSubtask,
                            onStartPomodoro = { onStartPomodoro(item.task.id, item.task.title) },
                            onSwipeToDelete = { onSwipeToDeleteWithUndo(item) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun MonthHeader(month: YearMonth, onPrevious: () -> Unit, onNext: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onPrevious) {
            Icon(Icons.Filled.ChevronLeft, contentDescription = stringResource(R.string.calendar_previous_month), tint = OnBackground)
        }
        val label = month.month.getDisplayName(TextStyle.FULL, ptBr).replaceFirstChar { it.uppercase(ptBr) }
        Text(text = "$label ${month.year}", style = MaterialTheme.typography.titleMedium, color = OnBackground)
        IconButton(onClick = onNext) {
            Icon(Icons.Filled.ChevronRight, contentDescription = stringResource(R.string.calendar_next_month), tint = OnBackground)
        }
    }
}

@Composable
private fun WeekdayHeaderRow() {
    Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
        DayOfWeek.entries.forEach { day ->
            Text(
                text = weekdayShortLabel(day),
                style = MaterialTheme.typography.labelSmall,
                color = OnSurfaceSecondary,
                textAlign = TextAlign.Center,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun MonthGrid(
    month: YearMonth,
    selectedDate: LocalDate,
    tasksByDate: Map<LocalDate, List<TaskWithCategory>>,
    onDaySelected: (LocalDate) -> Unit,
) {
    val today = remember { LocalDate.now() }
    val cells = remember(month) { buildMonthGrid(month) }
    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
        cells.chunked(7).forEach { week ->
            Row(modifier = Modifier.fillMaxWidth()) {
                week.forEach { date ->
                    DayCell(
                        date = date,
                        isSelected = date == selectedDate,
                        isToday = date == today,
                        hasTasks = date != null && !tasksByDate[date].isNullOrEmpty(),
                        onClick = onDaySelected,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
    }
}

@Composable
private fun DayCell(
    date: LocalDate?,
    isSelected: Boolean,
    isToday: Boolean,
    hasTasks: Boolean,
    onClick: (LocalDate) -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .aspectRatio(1f)
            .padding(2.dp)
            .clip(CircleShape)
            .then(if (isSelected) Modifier.background(Accent) else Modifier)
            .then(if (date != null) Modifier.clickable { onClick(date) } else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        if (date != null) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = date.dayOfMonth.toString(),
                    style = MaterialTheme.typography.bodyMedium,
                    color = when {
                        isSelected -> Background
                        isToday -> Accent
                        else -> OnBackground
                    },
                )
                Box(
                    modifier = Modifier
                        .size(4.dp)
                        .clip(CircleShape)
                        .background(if (hasTasks) (if (isSelected) Background else Accent) else Color.Transparent),
                )
            }
        }
    }
}

/** A 42-cell (6-week) grid for [month], Monday-first to match the rest of the app's weekday ordering; `null` marks the leading/trailing cells outside the month. */
private fun buildMonthGrid(month: YearMonth): List<LocalDate?> {
    val firstDay = month.atDay(1)
    val leadingBlanks = (firstDay.dayOfWeek.value - DayOfWeek.MONDAY.value + 7) % 7
    val daysInMonth = month.lengthOfMonth()
    val totalCells = ((leadingBlanks + daysInMonth + 6) / 7) * 7
    return (0 until totalCells).map { index ->
        val dayNum = index - leadingBlanks + 1
        if (dayNum in 1..daysInMonth) month.atDay(dayNum) else null
    }
}
