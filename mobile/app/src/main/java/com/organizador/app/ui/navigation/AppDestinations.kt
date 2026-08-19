package com.organizador.app.ui.navigation

import android.net.Uri
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Label
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CalendarViewMonth
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Today
import androidx.compose.ui.graphics.vector.ImageVector

/** Routes reachable from anywhere, kept as plain constants so NavHost and screens agree on them. */
object Routes {
    const val TODAY = "today"
    const val ALL_TASKS = "all_tasks"
    const val CALENDAR = "calendar"
    const val CATEGORIES = "categories"
    const val SETTINGS = "settings"
    const val NEW_TASK = "new_task"
    const val EDIT_TASK = "edit_task"
    const val EDIT_TASK_ARG_TASK_ID = "taskId"
    const val EDIT_TASK_PATTERN = "$EDIT_TASK/{$EDIT_TASK_ARG_TASK_ID}"
    const val TRASH = "trash"
    const val STATISTICS = "statistics"
    const val POMODORO = "pomodoro"
    const val POMODORO_ARG_TASK_ID = "taskId"
    const val POMODORO_ARG_TASK_TITLE = "title"
    const val POMODORO_PATTERN = "$POMODORO/{$POMODORO_ARG_TASK_ID}?$POMODORO_ARG_TASK_TITLE={$POMODORO_ARG_TASK_TITLE}"

    fun editTask(taskId: Long) = "$EDIT_TASK/$taskId"

    /** [taskTitle] is optional — the notification deep link only knows the taskId, and the screen falls back to loading it. */
    fun pomodoro(taskId: Long, taskTitle: String = "") = "$POMODORO/$taskId?$POMODORO_ARG_TASK_TITLE=${Uri.encode(taskTitle)}"
}

enum class BottomNavItem(val route: String, val label: String, val icon: ImageVector) {
    TODAY(Routes.TODAY, "Hoje", Icons.Filled.Today),
    ALL_TASKS(Routes.ALL_TASKS, "Todas", Icons.Filled.CalendarMonth),
    CALENDAR(Routes.CALENDAR, "Calendário", Icons.Filled.CalendarViewMonth),
    CATEGORIES(Routes.CATEGORIES, "Categorias", Icons.AutoMirrored.Filled.Label),
    SETTINGS(Routes.SETTINGS, "Config", Icons.Filled.Settings),
}
