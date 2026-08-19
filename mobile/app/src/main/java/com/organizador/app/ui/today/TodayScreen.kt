package com.organizador.app.ui.today

import android.content.ContentUris
import android.content.Intent
import android.provider.CalendarContract
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.organizador.app.R
import com.organizador.app.domain.common.toLocalDateTime
import com.organizador.app.domain.model.CalendarEventItem
import com.organizador.app.ui.common.rememberViewModelFactory
import com.organizador.app.ui.components.SectionHeader
import com.organizador.app.ui.components.SwipeableTaskCard
import com.organizador.app.ui.navigation.BottomNavBar
import com.organizador.app.ui.navigation.BottomNavItem
import com.organizador.app.ui.theme.Accent
import com.organizador.app.ui.theme.Background
import com.organizador.app.ui.theme.OnSurfaceSecondary
import com.organizador.app.ui.theme.Surface as SurfaceColor
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.launch

@Composable
fun TodayScreen(
    onNewTask: () -> Unit,
    onTaskClick: (Long) -> Unit,
    onNavigate: (BottomNavItem) -> Unit,
    onStartPomodoro: (Long, String) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: TodayViewModel = viewModel(factory = rememberViewModelFactory()),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val coroutineScope = rememberCoroutineScope()
    val completedMessage = stringResource(R.string.undo_task_completed)
    val trashedMessage = stringResource(R.string.undo_task_trashed)
    val undoLabel = stringResource(R.string.undo_action)

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) viewModel.refreshCalendarEvents()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

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

    Scaffold(
        modifier = modifier,
        containerColor = Background,
        topBar = {
            CenterAlignedTopAppBar(
                title = { Text(stringResource(R.string.today_title), style = MaterialTheme.typography.titleLarge) },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = Background),
            )
        },
        bottomBar = { BottomNavBar(currentItem = BottomNavItem.TODAY, onNavigate = onNavigate) },
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
        if (uiState.isEmpty) {
            Box(
                modifier = Modifier.fillMaxSize().padding(paddingValues),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = stringResource(R.string.today_empty),
                    color = OnSurfaceSecondary,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(
                    start = 16.dp,
                    end = 16.dp,
                    top = paddingValues.calculateTopPadding() + 4.dp,
                    bottom = paddingValues.calculateBottomPadding() + 96.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (uiState.showCalendarSection && uiState.calendarEvents.isNotEmpty()) {
                    item { SectionHeader(title = stringResource(R.string.today_section_calendar)) }
                    items(uiState.calendarEvents, key = { "event_${it.id}_${it.startMillis}" }) { event ->
                        CalendarEventRow(event)
                    }
                }
                if (uiState.overdueTasks.isNotEmpty()) {
                    item { SectionHeader(title = stringResource(R.string.today_section_overdue)) }
                    items(uiState.overdueTasks, key = { it.task.id }) { item ->
                        SwipeableTaskCard(
                            taskWithCategory = item,
                            onToggleCompleted = { checked -> onToggleCompletedWithUndo(item.task.id, checked) },
                            onClick = { onTaskClick(item.task.id) },
                            onToggleSubtask = viewModel::onToggleSubtask,
                            onStartPomodoro = { onStartPomodoro(item.task.id, item.task.title) },
                            onSwipeToDelete = {
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
                            },
                        )
                    }
                }
                if (uiState.todayTasks.isNotEmpty()) {
                    item { SectionHeader(title = stringResource(R.string.today_section_today)) }
                    items(uiState.todayTasks, key = { it.task.id }) { item ->
                        SwipeableTaskCard(
                            taskWithCategory = item,
                            onToggleCompleted = { checked -> onToggleCompletedWithUndo(item.task.id, checked) },
                            onClick = { onTaskClick(item.task.id) },
                            onToggleSubtask = viewModel::onToggleSubtask,
                            onStartPomodoro = { onStartPomodoro(item.task.id, item.task.title) },
                            onSwipeToDelete = {
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
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun CalendarEventRow(event: CalendarEventItem) {
    val context = LocalContext.current
    val timeLabel = if (event.allDay) {
        stringResource(R.string.today_calendar_event_all_day)
    } else {
        event.startMillis.toLocalDateTime().format(DateTimeFormatter.ofPattern("HH:mm"))
    }

    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .clickable {
                val uri = ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, event.id)
                context.startActivity(Intent(Intent.ACTION_VIEW, uri))
            },
        color = SurfaceColor,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(Color(event.calendarColor)),
            )
            Spacer(Modifier.width(10.dp))
            Text(
                text = event.title.ifBlank { stringResource(R.string.today_calendar_event_untitled) },
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text = timeLabel,
                style = MaterialTheme.typography.labelMedium,
                color = OnSurfaceSecondary,
            )
        }
    }
}
