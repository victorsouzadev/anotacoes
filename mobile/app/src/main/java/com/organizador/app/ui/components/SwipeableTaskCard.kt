package com.organizador.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.organizador.app.domain.model.TaskWithCategory
import com.organizador.app.ui.theme.Background
import com.organizador.app.ui.theme.PriorityHigh
import com.organizador.app.ui.theme.Accent as AccentColor

/**
 * [TaskCard] wrapped with swipe gestures: swipe right marks the task complete (reusing
 * [onToggleCompleted], same as the checkbox), swipe left removes it via [onSwipeToDelete]. Neither
 * gesture is allowed to settle into the dismissed state — the row always springs back, and the
 * underlying data change (which removes/updates the item once its Flow re-emits) is what actually
 * makes it disappear, avoiding double animations.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SwipeableTaskCard(
    taskWithCategory: TaskWithCategory,
    onToggleCompleted: (Boolean) -> Unit,
    onClick: () -> Unit,
    onSwipeToDelete: () -> Unit,
    modifier: Modifier = Modifier,
    onToggleSubtask: (subtaskId: Long, isCompleted: Boolean) -> Unit = { _, _ -> },
    onStartPomodoro: (() -> Unit)? = null,
) {
    val dismissState = rememberSwipeToDismissBoxState(
        confirmValueChange = { value ->
            when (value) {
                SwipeToDismissBoxValue.StartToEnd -> onToggleCompleted(true)
                SwipeToDismissBoxValue.EndToStart -> onSwipeToDelete()
                SwipeToDismissBoxValue.Settled -> Unit
            }
            false
        },
    )

    SwipeToDismissBox(
        state = dismissState,
        modifier = modifier,
        backgroundContent = { SwipeActionBackground(dismissState.targetValue) },
    ) {
        TaskCard(
            taskWithCategory = taskWithCategory,
            onToggleCompleted = onToggleCompleted,
            onClick = onClick,
            onToggleSubtask = onToggleSubtask,
            onStartPomodoro = onStartPomodoro,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SwipeActionBackground(direction: SwipeToDismissBoxValue) {
    val color = when (direction) {
        SwipeToDismissBoxValue.StartToEnd -> AccentColor
        SwipeToDismissBoxValue.EndToStart -> PriorityHigh
        SwipeToDismissBoxValue.Settled -> Color.Transparent
    }
    val alignment = when (direction) {
        SwipeToDismissBoxValue.StartToEnd -> Alignment.CenterStart
        SwipeToDismissBoxValue.EndToStart -> Alignment.CenterEnd
        SwipeToDismissBoxValue.Settled -> Alignment.Center
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .clip(RoundedCornerShape(14.dp))
            .background(color.copy(alpha = 0.85f))
            .padding(horizontal = 24.dp),
        contentAlignment = alignment,
    ) {
        val icon = when (direction) {
            SwipeToDismissBoxValue.StartToEnd -> Icons.Filled.Check
            SwipeToDismissBoxValue.EndToStart -> Icons.Filled.Delete
            SwipeToDismissBoxValue.Settled -> null
        }
        if (icon != null) {
            Icon(imageVector = icon, contentDescription = null, tint = Background)
        }
    }
}
