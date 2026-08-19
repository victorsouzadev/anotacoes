package com.organizador.app.pomodoro

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Binder
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.organizador.app.MainActivity
import com.organizador.app.R
import com.organizador.app.data.repository.TaskRepository
import com.organizador.app.data.repository.buildTaskRepository
import com.organizador.app.domain.model.PomodoroPhase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Runs a single, app-wide pomodoro session tied to one task at a time. Foreground so the countdown
 * survives navigating away from [com.organizador.app.ui.pomodoro.PomodoroScreen] or backgrounding the
 * app entirely; the ongoing notification mirrors the current phase/countdown and offers pause, skip
 * and stop actions so the session is controllable without reopening the app.
 */
class PomodoroService : Service() {

    private val binder = LocalBinder()
    private val scope = CoroutineScope(SupervisorJob())
    private var tickerJob: Job? = null
    private lateinit var repository: TaskRepository

    private val _state = MutableStateFlow<PomodoroState?>(null)
    val state: StateFlow<PomodoroState?> = _state.asStateFlow()

    inner class LocalBinder : Binder() {
        val service: PomodoroService get() = this@PomodoroService
    }

    override fun onCreate() {
        super.onCreate()
        repository = buildTaskRepository(applicationContext)
        ensureChannel()
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val taskId = intent.getLongExtra(EXTRA_TASK_ID, -1L)
                val taskTitle = intent.getStringExtra(EXTRA_TASK_TITLE).orEmpty()
                if (taskId >= 0) startSession(taskId, taskTitle)
            }
            ACTION_PAUSE -> setRunning(false)
            ACTION_RESUME -> setRunning(true)
            ACTION_SKIP -> skipPhase()
            ACTION_STOP -> stopSession()
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        tickerJob?.cancel()
        scope.cancel()
        super.onDestroy()
    }

    private fun startSession(taskId: Long, taskTitle: String) {
        tickerJob?.cancel()
        val phase = PomodoroPhase.FOCUS
        val durationMillis = phase.durationMinutes * MILLIS_PER_MINUTE
        _state.value = PomodoroState(
            taskId = taskId,
            taskTitle = taskTitle,
            phase = phase,
            remainingMillis = durationMillis,
            totalMillis = durationMillis,
            isRunning = true,
            completedFocusCycles = 0,
        )
        startForeground(NOTIFICATION_ID, buildNotification())
        startTicker()
    }

    private fun setRunning(running: Boolean) {
        val current = _state.value ?: return
        if (current.isRunning == running) return
        _state.value = current.copy(isRunning = running)
        updateNotification()
    }

    private fun skipPhase() {
        val current = _state.value ?: return
        scope.launch { advancePhase(current) }
    }

    private fun stopSession() {
        tickerJob?.cancel()
        _state.value = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun startTicker() {
        tickerJob?.cancel()
        tickerJob = scope.launch {
            while (isActive) {
                delay(1_000)
                val current = _state.value ?: break
                if (!current.isRunning) continue
                val remaining = current.remainingMillis - 1_000
                if (remaining <= 0) {
                    advancePhase(current)
                } else {
                    _state.value = current.copy(remainingMillis = remaining)
                    updateNotification()
                }
            }
        }
    }

    private suspend fun advancePhase(current: PomodoroState) {
        var completedCycles = current.completedFocusCycles
        if (current.phase == PomodoroPhase.FOCUS) {
            completedCycles += 1
            repository.incrementPomodoroCount(current.taskId)
        }
        val nextPhase = when (current.phase) {
            PomodoroPhase.FOCUS ->
                if (completedCycles % PomodoroPhase.CYCLES_BEFORE_LONG_BREAK == 0) PomodoroPhase.LONG_BREAK else PomodoroPhase.SHORT_BREAK
            PomodoroPhase.SHORT_BREAK, PomodoroPhase.LONG_BREAK -> PomodoroPhase.FOCUS
        }
        val durationMillis = nextPhase.durationMinutes * MILLIS_PER_MINUTE
        _state.value = current.copy(
            phase = nextPhase,
            remainingMillis = durationMillis,
            totalMillis = durationMillis,
            isRunning = true,
            completedFocusCycles = completedCycles,
        )
        updateNotification(alert = true)
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.pomodoro_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = getString(R.string.pomodoro_channel_description)
        }
        manager.createNotificationChannel(channel)
    }

    private fun updateNotification(alert: Boolean = false) {
        val manager = getSystemService(NotificationManager::class.java) ?: return
        manager.notify(NOTIFICATION_ID, buildNotification(alert))
    }

    private fun buildNotification(alert: Boolean = false): Notification {
        val state = _state.value
        val phaseLabel = when (state?.phase) {
            PomodoroPhase.FOCUS -> getString(R.string.pomodoro_phase_focus)
            PomodoroPhase.SHORT_BREAK -> getString(R.string.pomodoro_phase_short_break)
            PomodoroPhase.LONG_BREAK -> getString(R.string.pomodoro_phase_long_break)
            null -> ""
        }
        val remaining = state?.remainingMillis ?: 0L
        val minutes = remaining / 60_000
        val seconds = (remaining % 60_000) / 1_000
        val timeText = "%02d:%02d".format(minutes, seconds)

        val contentIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(MainActivity.EXTRA_OPEN_POMODORO_TASK_ID, state?.taskId ?: -1L)
        }
        val contentPendingIntent = PendingIntent.getActivity(
            this,
            0,
            contentIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val pauseResumeAction = if (state?.isRunning == true) {
            NotificationCompat.Action(0, getString(R.string.pomodoro_action_pause), servicePendingIntent(ACTION_PAUSE))
        } else {
            NotificationCompat.Action(0, getString(R.string.pomodoro_action_resume), servicePendingIntent(ACTION_RESUME))
        }

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("$phaseLabel · ${state?.taskTitle.orEmpty()}")
            .setContentText(timeText)
            .setOngoing(true)
            .setOnlyAlertOnce(!alert)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setContentIntent(contentPendingIntent)
            .addAction(pauseResumeAction)
            .addAction(NotificationCompat.Action(0, getString(R.string.pomodoro_action_skip), servicePendingIntent(ACTION_SKIP)))
            .addAction(NotificationCompat.Action(0, getString(R.string.pomodoro_action_stop), servicePendingIntent(ACTION_STOP)))
            .build()
    }

    private fun servicePendingIntent(action: String): PendingIntent {
        val intent = Intent(this, PomodoroService::class.java).setAction(action)
        return PendingIntent.getService(
            this,
            action.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    companion object {
        const val CHANNEL_ID = "pomodoro_timer"
        const val NOTIFICATION_ID = 9001
        const val ACTION_START = "com.organizador.app.pomodoro.action.START"
        const val ACTION_PAUSE = "com.organizador.app.pomodoro.action.PAUSE"
        const val ACTION_RESUME = "com.organizador.app.pomodoro.action.RESUME"
        const val ACTION_SKIP = "com.organizador.app.pomodoro.action.SKIP"
        const val ACTION_STOP = "com.organizador.app.pomodoro.action.STOP"
        const val EXTRA_TASK_ID = "task_id"
        const val EXTRA_TASK_TITLE = "task_title"
        private const val MILLIS_PER_MINUTE = 60_000L

        fun startIntent(context: Context, taskId: Long, taskTitle: String) =
            Intent(context, PomodoroService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_TASK_ID, taskId)
                putExtra(EXTRA_TASK_TITLE, taskTitle)
            }
    }
}
