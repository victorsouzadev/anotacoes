package com.organizador.app.ui.alltasks

import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.DragHandle
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.organizador.app.R
import com.organizador.app.domain.common.movedItem
import com.organizador.app.domain.model.TaskWithCategory
import com.organizador.app.ui.common.formatSectionDateLabel
import com.organizador.app.ui.common.rememberViewModelFactory
import com.organizador.app.ui.components.CategoryFilterRow
import com.organizador.app.ui.components.SectionHeader
import com.organizador.app.ui.components.SwipeableTaskCard
import com.organizador.app.ui.components.rememberDragDropListState
import com.organizador.app.ui.navigation.BottomNavBar
import com.organizador.app.ui.navigation.BottomNavItem
import com.organizador.app.ui.theme.Accent
import com.organizador.app.ui.theme.Background
import com.organizador.app.ui.theme.OnSurfaceSecondary
import com.organizador.app.ui.theme.Surface as SurfaceColor
import com.organizador.app.ui.theme.SurfaceVariant
import kotlinx.coroutines.launch

@Composable
fun AllTasksScreen(
    onNewTask: () -> Unit,
    onTaskClick: (Long) -> Unit,
    onNavigate: (BottomNavItem) -> Unit,
    onStartPomodoro: (Long, String) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: AllTasksViewModel = viewModel(factory = rememberViewModelFactory()),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val noDateLabel = stringResource(R.string.due_no_date)
    val snackbarHostState = remember { SnackbarHostState() }
    val coroutineScope = rememberCoroutineScope()
    val completedMessage = stringResource(R.string.undo_task_completed)
    val trashedMessage = stringResource(R.string.undo_task_trashed)
    val undoLabel = stringResource(R.string.undo_action)
    val dragHandleDescription = stringResource(R.string.all_tasks_manual_drag_handle)

    // Local optimistic order shown while dragging in TaskSortOption.MANUAL; re-keyed on
    // uiState.flatTasks so it only resets when the repository's order actually changes (i.e. once
    // a drag is persisted), never mid-gesture — see DragDropListState's kdoc for why that's safe.
    var manualTasks by remember(uiState.flatTasks) { mutableStateOf(uiState.flatTasks) }
    val lazyListState = rememberLazyListState()
    val dragDropState = rememberDragDropListState(lazyListState)

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
                title = { Text(stringResource(R.string.all_tasks_title), style = MaterialTheme.typography.titleLarge) },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = Background),
            )
        },
        bottomBar = { BottomNavBar(currentItem = BottomNavItem.ALL_TASKS, onNavigate = onNavigate) },
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
            TextField(
                value = uiState.searchQuery,
                onValueChange = viewModel::onSearchQueryChanged,
                placeholder = {
                    Text(
                        stringResource(R.string.all_tasks_search_placeholder),
                        color = OnSurfaceSecondary,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                },
                leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null, tint = OnSurfaceSecondary, modifier = Modifier.size(20.dp)) },
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyMedium,
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).height(48.dp),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = SurfaceVariant,
                    unfocusedContainerColor = SurfaceVariant,
                    disabledContainerColor = SurfaceVariant,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                    disabledIndicatorColor = Color.Transparent,
                    cursorColor = Accent,
                ),
            )

            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 16.dp, top = 10.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CategoryFilterRow(
                    categories = uiState.categories,
                    selectedCategoryId = uiState.selectedCategoryId,
                    onSelect = viewModel::onSelectCategory,
                    allLabel = stringResource(R.string.all_tasks_filter_all),
                    modifier = Modifier.weight(1f),
                )
                SortMenuButton(
                    selected = uiState.sortOption,
                    onSelect = viewModel::onSortOptionSelected,
                )
            }

            if (uiState.isEmpty) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        text = stringResource(R.string.all_tasks_empty),
                        color = OnSurfaceSecondary,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            } else {
                LazyColumn(
                    state = lazyListState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(
                        start = 16.dp,
                        end = 16.dp,
                        top = 4.dp,
                        bottom = paddingValues.calculateBottomPadding() + 96.dp,
                    ),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    if (uiState.recurringTasks.isNotEmpty()) {
                        item { SectionHeader(title = stringResource(R.string.all_tasks_section_recurring)) }
                        items(uiState.recurringTasks, key = { it.task.id }) { item ->
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
                    if (uiState.sortOption == TaskSortOption.DUE_DATE) {
                        uiState.dateGroups.forEach { group ->
                            val label = group.date?.let { formatSectionDateLabel(it) } ?: noDateLabel
                            item(key = "header_${group.date}") { SectionHeader(title = label) }
                            items(group.tasks, key = { it.task.id }) { item ->
                                SwipeableTaskCard(
                                    taskWithCategory = item,
                                    onToggleCompleted = { checked -> onToggleCompletedWithUndo(item.task.id, checked) },
                                    onClick = { onTaskClick(item.task.id) },
                                    onToggleSubtask = viewModel::onToggleSubtask,
                                    onSwipeToDelete = { onSwipeToDeleteWithUndo(item) },
                                )
                            }
                        }
                    } else if (uiState.sortOption == TaskSortOption.MANUAL) {
                        itemsIndexed(manualTasks, key = { _, item -> item.task.id }) { index, item ->
                            val currentIndex by rememberUpdatedState(index)
                            val isDragging = dragDropState.draggingItemIndex == index
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier
                                    .zIndex(if (isDragging) 1f else 0f)
                                    .graphicsLayer { translationY = if (isDragging) dragDropState.draggingItemOffset else 0f }
                                    .alpha(if (isDragging) 0.92f else 1f),
                            ) {
                                Box(modifier = Modifier.weight(1f)) {
                                    SwipeableTaskCard(
                                        taskWithCategory = item,
                                        onToggleCompleted = { checked -> onToggleCompletedWithUndo(item.task.id, checked) },
                                        onClick = { onTaskClick(item.task.id) },
                                        onToggleSubtask = viewModel::onToggleSubtask,
                                        onStartPomodoro = { onStartPomodoro(item.task.id, item.task.title) },
                                        onSwipeToDelete = { onSwipeToDeleteWithUndo(item) },
                                    )
                                }
                                Icon(
                                    imageVector = Icons.Filled.DragHandle,
                                    contentDescription = dragHandleDescription,
                                    tint = OnSurfaceSecondary,
                                    modifier = Modifier
                                        .padding(start = 4.dp)
                                        .size(24.dp)
                                        .pointerInput(item.task.id) {
                                            detectDragGestures(
                                                onDragStart = { dragDropState.onDragStart(currentIndex) },
                                                onDragEnd = {
                                                    dragDropState.onDragEnd()
                                                    viewModel.onReorder(manualTasks.map { it.task.id })
                                                },
                                                onDragCancel = { dragDropState.onDragEnd() },
                                                onDrag = { change, dragAmount ->
                                                    change.consume()
                                                    dragDropState.onDrag(dragAmount.y) { from, to ->
                                                        manualTasks = manualTasks.movedItem(from, to)
                                                    }
                                                },
                                            )
                                        },
                                )
                            }
                        }
                    } else {
                        items(uiState.flatTasks, key = { it.task.id }) { item ->
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
}

@Composable
private fun SortMenuButton(
    selected: TaskSortOption,
    onSelect: (TaskSortOption) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val options = listOf(
        TaskSortOption.DUE_DATE to stringResource(R.string.all_tasks_sort_due_date),
        TaskSortOption.PRIORITY to stringResource(R.string.all_tasks_sort_priority),
        TaskSortOption.ALPHABETICAL to stringResource(R.string.all_tasks_sort_alphabetical),
        TaskSortOption.MANUAL to stringResource(R.string.all_tasks_sort_manual),
    )

    Box {
        IconButton(onClick = { expanded = true }) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.Sort,
                contentDescription = stringResource(R.string.all_tasks_sort_label),
                tint = if (selected != TaskSortOption.DUE_DATE) Accent else OnSurfaceSecondary,
            )
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { (option, label) ->
                val isSelected = option == selected
                DropdownMenuItem(
                    text = { Text(label, color = if (isSelected) Accent else MaterialTheme.colorScheme.onSurface) },
                    onClick = {
                        onSelect(option)
                        expanded = false
                    },
                    trailingIcon = if (isSelected) {
                        { Icon(Icons.Filled.Check, contentDescription = null, tint = Accent) }
                    } else {
                        null
                    },
                )
            }
        }
    }
}
