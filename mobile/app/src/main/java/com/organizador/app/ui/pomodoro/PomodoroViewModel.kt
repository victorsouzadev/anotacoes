package com.organizador.app.ui.pomodoro

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.organizador.app.data.repository.TaskRepository
import com.organizador.app.pomodoro.PomodoroService
import com.organizador.app.pomodoro.PomodoroState
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class PomodoroUiState(
    val taskId: Long,
    val taskTitle: String,
    val serviceState: PomodoroState? = null,
) {
    /** Whether the app-wide session (if any) is the one for the task this screen was opened for. */
    val isActiveForThisTask: Boolean get() = serviceState?.taskId == taskId
    val isActiveForAnotherTask: Boolean get() = serviceState != null && !isActiveForThisTask
}

/**
 * Binds to the always-running [PomodoroService] to mirror its state, and forwards user actions to
 * it as start/pause/resume/skip/stop commands. Binding (rather than owning the timer here) is what
 * lets the countdown keep running when this screen — and even the ViewModel itself — goes away.
 */
class PomodoroViewModel(
    private val appContext: Context,
    taskId: Long,
    initialTaskTitle: String,
    private val taskRepository: TaskRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(PomodoroUiState(taskId = taskId, taskTitle = initialTaskTitle))
    val uiState: StateFlow<PomodoroUiState> = _uiState.asStateFlow()

    init {
        if (initialTaskTitle.isBlank()) {
            viewModelScope.launch {
                val title = taskRepository.taskDetails(taskId).first()?.task?.title
                if (!title.isNullOrBlank()) {
                    _uiState.update { it.copy(taskTitle = title) }
                }
            }
        }
    }

    private var stateCollectJob: Job? = null
    private var bound = false

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            val service = (binder as? PomodoroService.LocalBinder)?.service ?: return
            stateCollectJob = viewModelScope.launch {
                service.state.collect { serviceState ->
                    _uiState.update { it.copy(serviceState = serviceState) }
                }
            }
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            stateCollectJob?.cancel()
        }
    }

    init {
        bound = appContext.bindService(Intent(appContext, PomodoroService::class.java), connection, Context.BIND_AUTO_CREATE)
    }

    fun onStart() {
        val state = _uiState.value
        appContext.startService(PomodoroService.startIntent(appContext, state.taskId, state.taskTitle))
    }

    fun onPause() = sendAction(PomodoroService.ACTION_PAUSE)
    fun onResume() = sendAction(PomodoroService.ACTION_RESUME)
    fun onSkip() = sendAction(PomodoroService.ACTION_SKIP)
    fun onStop() = sendAction(PomodoroService.ACTION_STOP)

    private fun sendAction(action: String) {
        appContext.startService(Intent(appContext, PomodoroService::class.java).setAction(action))
    }

    override fun onCleared() {
        super.onCleared()
        stateCollectJob?.cancel()
        if (bound) runCatching { appContext.unbindService(connection) }
    }
}
