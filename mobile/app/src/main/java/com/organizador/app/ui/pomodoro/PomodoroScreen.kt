package com.organizador.app.ui.pomodoro

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.organizador.app.R
import com.organizador.app.domain.model.PomodoroPhase
import com.organizador.app.pomodoro.PomodoroState
import com.organizador.app.ui.common.rememberPomodoroViewModelFactory
import com.organizador.app.ui.theme.Accent
import com.organizador.app.ui.theme.Background
import com.organizador.app.ui.theme.OnSurfaceSecondary
import com.organizador.app.ui.theme.Surface as SurfaceColor
import com.organizador.app.ui.theme.SurfaceVariant

@Composable
fun PomodoroScreen(
    taskId: Long,
    taskTitle: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: PomodoroViewModel = viewModel(factory = rememberPomodoroViewModelFactory(taskId, taskTitle)),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val serviceState = uiState.serviceState

    Scaffold(
        modifier = modifier,
        containerColor = Background,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.pomodoro_title), style = MaterialTheme.typography.titleMedium) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Background),
            )
        },
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                text = uiState.taskTitle,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Spacer(Modifier.height(32.dp))

            if (uiState.isActiveForAnotherTask && serviceState != null) {
                SwitchTaskBanner(runningTaskTitle = serviceState.taskTitle, onSwitch = viewModel::onStart)
            } else {
                val activeState = serviceState?.takeIf { uiState.isActiveForThisTask }
                TimerRing(state = activeState)
                Spacer(Modifier.height(16.dp))
                PhaseLabel(phase = activeState?.phase)
                Spacer(Modifier.height(8.dp))
                CycleDots(completedFocusCycles = activeState?.completedFocusCycles ?: 0)
                Spacer(Modifier.height(40.dp))
                Controls(
                    state = activeState,
                    onStart = viewModel::onStart,
                    onPause = viewModel::onPause,
                    onResume = viewModel::onResume,
                    onSkip = viewModel::onSkip,
                    onStop = viewModel::onStop,
                )
            }
        }
    }
}

@Composable
private fun TimerRing(state: PomodoroState?) {
    val totalMillis = state?.totalMillis?.takeIf { it > 0 } ?: (PomodoroPhase.FOCUS.durationMinutes * 60_000L)
    val remainingMillis = state?.remainingMillis ?: totalMillis
    val progress = (remainingMillis.toFloat() / totalMillis.toFloat()).coerceIn(0f, 1f)
    val minutes = remainingMillis / 60_000
    val seconds = (remainingMillis % 60_000) / 1_000

    Box(modifier = Modifier.size(220.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(
            progress = { progress },
            modifier = Modifier.fillMaxSize(),
            color = Accent,
            trackColor = SurfaceVariant,
            strokeWidth = 8.dp,
        )
        Text(
            text = "%02d:%02d".format(minutes, seconds),
            style = MaterialTheme.typography.displayMedium,
            color = MaterialTheme.colorScheme.onBackground,
        )
    }
}

@Composable
private fun PhaseLabel(phase: PomodoroPhase?) {
    val label = when (phase) {
        PomodoroPhase.FOCUS, null -> stringResource(R.string.pomodoro_phase_focus)
        PomodoroPhase.SHORT_BREAK -> stringResource(R.string.pomodoro_phase_short_break)
        PomodoroPhase.LONG_BREAK -> stringResource(R.string.pomodoro_phase_long_break)
    }
    Text(text = label, style = MaterialTheme.typography.titleSmall, color = Accent)
}

@Composable
private fun CycleDots(completedFocusCycles: Int) {
    val current = completedFocusCycles % PomodoroPhase.CYCLES_BEFORE_LONG_BREAK
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        repeat(PomodoroPhase.CYCLES_BEFORE_LONG_BREAK) { index ->
            val filled = index < current
            Surface(
                modifier = Modifier.size(8.dp),
                color = if (filled) Accent else SurfaceVariant,
                shape = CircleShape,
            ) {}
        }
    }
}

@Composable
private fun Controls(
    state: PomodoroState?,
    onStart: () -> Unit,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onSkip: () -> Unit,
    onStop: () -> Unit,
) {
    if (state == null) {
        Button(
            onClick = onStart,
            modifier = Modifier.height(52.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = Background),
        ) {
            Icon(Icons.Filled.PlayArrow, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.pomodoro_start))
        }
        return
    }

    Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
        OutlinedButton(onClick = onStop) {
            Icon(Icons.Filled.Stop, contentDescription = stringResource(R.string.pomodoro_stop))
        }
        Button(
            onClick = if (state.isRunning) onPause else onResume,
            modifier = Modifier.height(56.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = Background),
        ) {
            Icon(if (state.isRunning) Icons.Filled.Pause else Icons.Filled.PlayArrow, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(if (state.isRunning) stringResource(R.string.pomodoro_pause) else stringResource(R.string.pomodoro_resume))
        }
        OutlinedButton(onClick = onSkip) {
            Icon(Icons.Filled.SkipNext, contentDescription = stringResource(R.string.pomodoro_skip))
        }
    }
}

@Composable
private fun SwitchTaskBanner(runningTaskTitle: String, onSwitch: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .padding(1.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Surface(color = SurfaceColor, shape = RoundedCornerShape(14.dp)) {
            Column(modifier = Modifier.padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = stringResource(R.string.pomodoro_running_elsewhere, runningTaskTitle),
                    style = MaterialTheme.typography.bodyMedium,
                    color = OnSurfaceSecondary,
                )
                Spacer(Modifier.height(16.dp))
                Button(
                    onClick = onSwitch,
                    colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = Background),
                ) {
                    Text(stringResource(R.string.pomodoro_switch_task))
                }
            }
        }
    }
}
