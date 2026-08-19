package com.organizador.app.ui.common

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.ViewModelProvider
import com.organizador.app.OrganizadorApplication
import com.organizador.app.di.EditTaskViewModelFactory
import com.organizador.app.di.PomodoroViewModelFactory

@Composable
fun rememberViewModelFactory(): ViewModelProvider.Factory {
    val context = LocalContext.current
    return remember(context) {
        (context.applicationContext as OrganizadorApplication).container.viewModelFactory
    }
}

@Composable
fun rememberEditTaskViewModelFactory(taskId: Long): ViewModelProvider.Factory {
    val context = LocalContext.current
    return remember(context, taskId) {
        val container = (context.applicationContext as OrganizadorApplication).container
        EditTaskViewModelFactory(taskId, container.taskRepository, container.categoryRepository, container.appContext)
    }
}

@Composable
fun rememberPomodoroViewModelFactory(taskId: Long, taskTitle: String): ViewModelProvider.Factory {
    val context = LocalContext.current
    return remember(context, taskId, taskTitle) {
        val container = (context.applicationContext as OrganizadorApplication).container
        PomodoroViewModelFactory(container.appContext, taskId, taskTitle, container.taskRepository)
    }
}
