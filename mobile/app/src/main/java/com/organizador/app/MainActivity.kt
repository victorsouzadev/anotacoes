package com.organizador.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.organizador.app.ui.navigation.OrganizadorNavHost
import com.organizador.app.ui.theme.OrganizadorTheme

class MainActivity : ComponentActivity() {

    private var pendingTaskId by mutableStateOf<Long?>(null)
    private var pendingNewTaskRequests by mutableIntStateOf(0)
    private var pendingPomodoroTaskId by mutableStateOf<Long?>(null)

    private val requestNotificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { /* no-op: reminders simply won't post if denied, no extra UI needed */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        consumeIntentExtras(intent)
        requestNotificationPermissionIfNeeded()

        val settingsStore = (application as OrganizadorApplication).container.settingsStore

        setContent {
            val themeMode by settingsStore.themeMode.collectAsStateWithLifecycle()
            val accentTheme by settingsStore.accentTheme.collectAsStateWithLifecycle()
            val useDynamicColor by settingsStore.useDynamicColor.collectAsStateWithLifecycle()

            OrganizadorTheme(themeMode = themeMode, accentTheme = accentTheme, useDynamicColor = useDynamicColor) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    OrganizadorNavHost(
                        initialTaskId = pendingTaskId,
                        onInitialTaskConsumed = { pendingTaskId = null },
                        newTaskRequests = pendingNewTaskRequests,
                        initialPomodoroTaskId = pendingPomodoroTaskId,
                        onInitialPomodoroTaskConsumed = { pendingPomodoroTaskId = null },
                    )
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        consumeIntentExtras(intent)
    }

    private fun consumeIntentExtras(intent: Intent?) {
        pendingTaskId = intent?.taskIdExtra()
        pendingPomodoroTaskId = intent?.pomodoroTaskIdExtra()
        if (intent?.getStringExtra(EXTRA_SHORTCUT_ACTION) == SHORTCUT_ACTION_NEW_TASK) {
            pendingNewTaskRequests++
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        if (!granted) {
            requestNotificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    private fun Intent.taskIdExtra(): Long? {
        val id = getLongExtra(EXTRA_OPEN_TASK_ID, -1L)
        return id.takeIf { it >= 0 }
    }

    private fun Intent.pomodoroTaskIdExtra(): Long? {
        val id = getLongExtra(EXTRA_OPEN_POMODORO_TASK_ID, -1L)
        return id.takeIf { it >= 0 }
    }

    companion object {
        const val EXTRA_OPEN_TASK_ID = "open_task_id"
        const val EXTRA_OPEN_POMODORO_TASK_ID = "open_pomodoro_task_id"
        const val EXTRA_SHORTCUT_ACTION = "shortcut_action"
        const val SHORTCUT_ACTION_NEW_TASK = "new_task"
    }
}
