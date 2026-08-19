package com.organizador.app.di

import android.content.Context
import androidx.lifecycle.ViewModelProvider
import com.organizador.app.data.backup.BackupRepository
import com.organizador.app.data.calendar.DeviceCalendarSync
import com.organizador.app.data.local.AppDatabase
import com.organizador.app.data.local.SettingsStore
import com.organizador.app.data.location.GeofenceLocationReminderScheduler
import com.organizador.app.data.reminder.AlarmTaskReminderScheduler
import com.organizador.app.data.remote.AuthApi
import com.organizador.app.data.remote.OpenRouterTaskInterpreter
import com.organizador.app.data.remote.TasksSyncApi
import com.organizador.app.data.repository.AuthRepository
import com.organizador.app.data.repository.CategoryRepository
import com.organizador.app.data.repository.TaskRepository
import com.organizador.app.data.sync.TasksSyncRepository
import com.organizador.app.domain.calendar.CalendarSync
import com.organizador.app.domain.location.LocationReminderScheduler
import com.organizador.app.domain.nlp.TaskInterpreter
import com.organizador.app.domain.reminder.TaskReminderScheduler
import com.organizador.app.domain.widget.WidgetRefresher
import com.organizador.app.widget.GlanceWidgetRefresher

/** Minimal manual DI container: wires the database and settings storage to the repositories the ViewModels depend on. */
class AppContainer(context: Context) {

    val appContext: Context = context.applicationContext
    private val database = AppDatabase.getInstance(appContext)

    private val reminderScheduler: TaskReminderScheduler = AlarmTaskReminderScheduler(appContext)
    val settingsStore: SettingsStore = SettingsStore(appContext)
    private val calendarSync: CalendarSync = DeviceCalendarSync(appContext, settingsStore)
    private val widgetRefresher: WidgetRefresher = GlanceWidgetRefresher(appContext)
    private val locationReminderScheduler: LocationReminderScheduler = GeofenceLocationReminderScheduler(appContext)

    val taskRepository: TaskRepository = TaskRepository(
        database.taskDao(),
        database.categoryDao(),
        database.subtaskDao(),
        reminderScheduler,
        calendarSync,
        widgetRefresher,
        locationReminderScheduler,
    )
    val aiTaskInterpreter: TaskInterpreter = OpenRouterTaskInterpreter(settingsStore)
    val backupRepository: BackupRepository = BackupRepository(
        appContext,
        database.taskDao(),
        database.categoryDao(),
        database.subtaskDao(),
    )

    // Login/sincronização com a mesma conta do hub (notas-vps) — a ferramenta "Tarefas" da versão
    // web. Opcional: o app continua 100% funcional offline sem nunca logar.
    private val authApi = AuthApi(baseUrlProvider = { settingsStore.getServerBaseUrl() })
    private val tasksSyncApi = TasksSyncApi(baseUrlProvider = { settingsStore.getServerBaseUrl() })
    val authRepository: AuthRepository = AuthRepository(authApi, settingsStore)
    val tasksSyncRepository: TasksSyncRepository = TasksSyncRepository(
        database.taskDao(),
        database.categoryDao(),
        database.subtaskDao(),
        tasksSyncApi,
        authRepository,
        reminderScheduler,
        locationReminderScheduler,
        widgetRefresher,
    )
    val categoryRepository: CategoryRepository = CategoryRepository(database.categoryDao(), tasksSyncRepository)

    val viewModelFactory: ViewModelProvider.Factory by lazy {
        AppViewModelFactory(
            appContext, taskRepository, categoryRepository, settingsStore, aiTaskInterpreter,
            backupRepository, authRepository, tasksSyncRepository,
        )
    }
}
