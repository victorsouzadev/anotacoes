package com.organizador.app.di

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.organizador.app.data.repository.TaskRepository
import com.organizador.app.ui.pomodoro.PomodoroViewModel

/** Separate from [AppViewModelFactory] because PomodoroViewModel needs the taskId/title being timed
 * (known only at navigation time) plus a [Context] to bind [com.organizador.app.pomodoro.PomodoroService]. */
class PomodoroViewModelFactory(
    private val appContext: Context,
    private val taskId: Long,
    private val initialTaskTitle: String,
    private val taskRepository: TaskRepository,
) : ViewModelProvider.Factory {

    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        require(modelClass.isAssignableFrom(PomodoroViewModel::class.java)) {
            "PomodoroViewModelFactory can only create PomodoroViewModel, got ${modelClass.name}"
        }
        return PomodoroViewModel(appContext, taskId, initialTaskTitle, taskRepository) as T
    }
}
