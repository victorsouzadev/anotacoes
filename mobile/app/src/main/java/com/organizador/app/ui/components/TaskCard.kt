package com.organizador.app.ui.components

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Photo
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.organizador.app.R
import com.organizador.app.data.local.entity.Subtask
import com.organizador.app.domain.model.TaskWithCategory
import com.organizador.app.ui.common.priorityColor
import com.organizador.app.ui.theme.Accent
import com.organizador.app.ui.theme.OnSurfaceSecondary
import com.organizador.app.ui.theme.Surface as SurfaceColor

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun TaskCard(
    taskWithCategory: TaskWithCategory,
    onToggleCompleted: (Boolean) -> Unit,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    onToggleSubtask: (subtaskId: Long, isCompleted: Boolean) -> Unit = { _, _ -> },
    onStartPomodoro: (() -> Unit)? = null,
    /** Long-press ação: duplicar a tarefa. Null quando o card não deve suportar isso (ex.: lixeira). */
    onDuplicate: (() -> Unit)? = null,
) {
    val task = taskWithCategory.task
    val category = taskWithCategory.category
    val subtasks = taskWithCategory.subtasks
    val borderColor = priorityColor(task.priority)
    var areSubtasksExpanded by remember(task.id) { mutableStateOf(false) }

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .combinedClickable(onClick = onClick, onLongClick = onDuplicate),
        color = SurfaceColor,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(IntrinsicSize.Min),
        ) {
            Spacer(
                modifier = Modifier
                    .fillMaxHeight()
                    .width(4.dp)
                    .background(borderColor),
            )
            Row(
                modifier = Modifier
                    .weight(1f)
                    .padding(start = 12.dp, end = 16.dp, top = 12.dp, bottom = 12.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Checkbox(
                    checked = task.isCompleted,
                    onCheckedChange = onToggleCompleted,
                    colors = CheckboxDefaults.colors(
                        checkedColor = Accent,
                        uncheckedColor = OnSurfaceSecondary,
                        checkmarkColor = MaterialTheme.colorScheme.background,
                    ),
                )
                Spacer(Modifier.width(4.dp))
                Column(modifier = Modifier.weight(1f).padding(top = 10.dp)) {
                    Text(
                        text = task.title,
                        style = MaterialTheme.typography.titleSmall,
                        color = if (task.isCompleted) OnSurfaceSecondary else MaterialTheme.colorScheme.onBackground,
                        textDecoration = if (task.isCompleted) TextDecoration.LineThrough else null,
                    )
                    Spacer(Modifier.height(8.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        DueDateChip(dueDateMillis = task.dueDate, isCompleted = task.isCompleted)
                        if (category != null) {
                            Spacer(Modifier.width(8.dp))
                            CategoryChip(name = category.name, colorHex = category.colorHex)
                        }
                        if (task.photoPath != null) {
                            Spacer(Modifier.width(8.dp))
                            Icon(
                                imageVector = Icons.Filled.Photo,
                                contentDescription = null,
                                tint = OnSurfaceSecondary,
                                modifier = Modifier.size(16.dp),
                            )
                        }
                        if (onStartPomodoro != null) {
                            Spacer(Modifier.weight(1f))
                            if (task.completedPomodoros > 0) {
                                Text(
                                    text = task.completedPomodoros.toString(),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = OnSurfaceSecondary,
                                )
                                Spacer(Modifier.width(2.dp))
                            }
                            IconButton(onClick = onStartPomodoro, modifier = Modifier.size(28.dp)) {
                                Icon(
                                    imageVector = Icons.Filled.Timer,
                                    contentDescription = stringResource(R.string.task_card_start_pomodoro),
                                    tint = Accent,
                                    modifier = Modifier.size(18.dp),
                                )
                            }
                        }
                    }
                    if (subtasks.isNotEmpty()) {
                        Spacer(Modifier.height(8.dp))
                        SubtaskProgressRow(
                            subtasks = subtasks,
                            expanded = areSubtasksExpanded,
                            onToggleExpanded = { areSubtasksExpanded = !areSubtasksExpanded },
                        )
                        if (areSubtasksExpanded) {
                            Column(modifier = Modifier.padding(top = 4.dp)) {
                                subtasks.forEach { subtask ->
                                    SubtaskItemRow(
                                        subtask = subtask,
                                        onToggle = { checked -> onToggleSubtask(subtask.id, checked) },
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SubtaskProgressRow(subtasks: List<Subtask>, expanded: Boolean, onToggleExpanded: () -> Unit) {
    val completedCount = subtasks.count { it.isCompleted }
    Row(
        modifier = Modifier.clickable(onClick = onToggleExpanded),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = "$completedCount/${subtasks.size} subtarefas",
            style = MaterialTheme.typography.labelSmall,
            color = OnSurfaceSecondary,
        )
        Icon(
            imageVector = if (expanded) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
            contentDescription = null,
            tint = OnSurfaceSecondary,
            modifier = Modifier.size(16.dp),
        )
    }
}

@Composable
private fun SubtaskItemRow(subtask: Subtask, onToggle: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Checkbox(
            checked = subtask.isCompleted,
            onCheckedChange = onToggle,
            modifier = Modifier.size(32.dp),
            colors = CheckboxDefaults.colors(
                checkedColor = Accent,
                uncheckedColor = OnSurfaceSecondary,
                checkmarkColor = MaterialTheme.colorScheme.background,
            ),
        )
        Spacer(Modifier.width(4.dp))
        Text(
            text = subtask.title,
            style = MaterialTheme.typography.bodySmall,
            color = if (subtask.isCompleted) OnSurfaceSecondary else MaterialTheme.colorScheme.onBackground,
            textDecoration = if (subtask.isCompleted) TextDecoration.LineThrough else null,
        )
    }
}
