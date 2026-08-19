package com.organizador.app.pomodoro

import com.organizador.app.domain.model.PomodoroPhase

/** Snapshot of the single, app-wide pomodoro session [PomodoroService] runs, always tied to one task. */
data class PomodoroState(
    val taskId: Long,
    val taskTitle: String,
    val phase: PomodoroPhase,
    val remainingMillis: Long,
    val totalMillis: Long,
    val isRunning: Boolean,
    /** Focus sessions completed so far in this run, used to decide when the next break is the long one. */
    val completedFocusCycles: Int,
)
