package com.organizador.app.domain.model

/** A single stage of the pomodoro cycle. [cyclesBeforeLongBreak] focus sessions earn a long break instead of a short one. */
enum class PomodoroPhase(val durationMinutes: Int) {
    FOCUS(25),
    SHORT_BREAK(5),
    LONG_BREAK(15),
    ;

    companion object {
        const val CYCLES_BEFORE_LONG_BREAK = 4
    }
}
