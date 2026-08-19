package com.organizador.app.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.organizador.app.ui.alltasks.AllTasksScreen
import com.organizador.app.ui.calendar.CalendarScreen
import com.organizador.app.ui.categories.CategoriesScreen
import com.organizador.app.ui.edittask.EditTaskScreen
import com.organizador.app.ui.newtask.NewTaskScreen
import com.organizador.app.ui.pomodoro.PomodoroScreen
import com.organizador.app.ui.settings.SettingsScreen
import com.organizador.app.ui.statistics.StatisticsScreen
import com.organizador.app.ui.today.TodayScreen
import com.organizador.app.ui.trash.TrashScreen

@Composable
fun OrganizadorNavHost(
    navController: NavHostController = rememberNavController(),
    initialTaskId: Long? = null,
    onInitialTaskConsumed: () -> Unit = {},
    newTaskRequests: Int = 0,
    initialPomodoroTaskId: Long? = null,
    onInitialPomodoroTaskConsumed: () -> Unit = {},
) {
    LaunchedEffect(initialTaskId) {
        if (initialTaskId != null) {
            navController.navigate(Routes.editTask(initialTaskId))
            onInitialTaskConsumed()
        }
    }

    LaunchedEffect(newTaskRequests) {
        if (newTaskRequests > 0) {
            navController.navigate(Routes.NEW_TASK)
        }
    }

    LaunchedEffect(initialPomodoroTaskId) {
        if (initialPomodoroTaskId != null) {
            navController.navigate(Routes.pomodoro(initialPomodoroTaskId))
            onInitialPomodoroTaskConsumed()
        }
    }

    NavHost(navController = navController, startDestination = Routes.TODAY) {
        composable(Routes.TODAY) {
            TodayScreen(
                onNewTask = { navController.navigate(Routes.NEW_TASK) },
                onTaskClick = { taskId -> navController.navigate(Routes.editTask(taskId)) },
                onNavigate = { item -> navController.navigateToBottomItem(item) },
                onStartPomodoro = { taskId, title -> navController.navigate(Routes.pomodoro(taskId, title)) },
            )
        }
        composable(Routes.ALL_TASKS) {
            AllTasksScreen(
                onNewTask = { navController.navigate(Routes.NEW_TASK) },
                onTaskClick = { taskId -> navController.navigate(Routes.editTask(taskId)) },
                onNavigate = { item -> navController.navigateToBottomItem(item) },
                onStartPomodoro = { taskId, title -> navController.navigate(Routes.pomodoro(taskId, title)) },
            )
        }
        composable(Routes.CALENDAR) {
            CalendarScreen(
                onNewTask = { navController.navigate(Routes.NEW_TASK) },
                onTaskClick = { taskId -> navController.navigate(Routes.editTask(taskId)) },
                onNavigate = { item -> navController.navigateToBottomItem(item) },
                onStartPomodoro = { taskId, title -> navController.navigate(Routes.pomodoro(taskId, title)) },
            )
        }
        composable(Routes.CATEGORIES) {
            CategoriesScreen(onNavigate = { item -> navController.navigateToBottomItem(item) })
        }
        composable(Routes.SETTINGS) {
            SettingsScreen(
                onNavigate = { item -> navController.navigateToBottomItem(item) },
                onOpenTrash = { navController.navigate(Routes.TRASH) },
                onOpenStatistics = { navController.navigate(Routes.STATISTICS) },
            )
        }
        composable(Routes.TRASH) {
            TrashScreen(onBack = { navController.popBackStack() })
        }
        composable(Routes.STATISTICS) {
            StatisticsScreen(onBack = { navController.popBackStack() })
        }
        composable(Routes.NEW_TASK) {
            NewTaskScreen(
                onBack = { navController.popBackStack() },
                onSaved = { navController.popBackStack() },
            )
        }
        composable(
            route = Routes.EDIT_TASK_PATTERN,
            arguments = listOf(navArgument(Routes.EDIT_TASK_ARG_TASK_ID) { type = NavType.LongType }),
        ) { backStackEntry ->
            val taskId = backStackEntry.arguments?.getLong(Routes.EDIT_TASK_ARG_TASK_ID) ?: return@composable
            EditTaskScreen(
                taskId = taskId,
                onBack = { navController.popBackStack() },
                onSaved = { navController.popBackStack() },
                onDeleted = { navController.popBackStack() },
                onStartPomodoro = { navController.navigate(Routes.pomodoro(taskId)) },
            )
        }
        composable(
            route = Routes.POMODORO_PATTERN,
            arguments = listOf(
                navArgument(Routes.POMODORO_ARG_TASK_ID) { type = NavType.LongType },
                navArgument(Routes.POMODORO_ARG_TASK_TITLE) {
                    type = NavType.StringType
                    defaultValue = ""
                },
            ),
        ) { backStackEntry ->
            val taskId = backStackEntry.arguments?.getLong(Routes.POMODORO_ARG_TASK_ID) ?: return@composable
            val taskTitle = backStackEntry.arguments?.getString(Routes.POMODORO_ARG_TASK_TITLE).orEmpty()
            PomodoroScreen(
                taskId = taskId,
                taskTitle = taskTitle,
                onBack = { navController.popBackStack() },
            )
        }
    }
}

private fun NavHostController.navigateToBottomItem(item: BottomNavItem) {
    navigate(item.route) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}
