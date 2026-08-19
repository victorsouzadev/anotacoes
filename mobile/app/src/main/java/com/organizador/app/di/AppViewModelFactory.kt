package com.organizador.app.di

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.organizador.app.data.backup.BackupRepository
import com.organizador.app.data.local.SettingsStore
import com.organizador.app.data.repository.AuthRepository
import com.organizador.app.data.repository.CategoryRepository
import com.organizador.app.data.repository.TaskRepository
import com.organizador.app.data.sync.TasksSyncRepository
import com.organizador.app.domain.nlp.TaskInterpreter
import com.organizador.app.ui.alltasks.AllTasksViewModel
import com.organizador.app.ui.calendar.CalendarViewModel
import com.organizador.app.ui.categories.CategoriesViewModel
import com.organizador.app.ui.newtask.NewTaskViewModel
import com.organizador.app.ui.settings.SettingsViewModel
import com.organizador.app.ui.statistics.StatisticsViewModel
import com.organizador.app.ui.today.TodayViewModel
import com.organizador.app.ui.trash.TrashViewModel

class AppViewModelFactory(
    private val appContext: Context,
    private val taskRepository: TaskRepository,
    private val categoryRepository: CategoryRepository,
    private val settingsStore: SettingsStore,
    private val aiTaskInterpreter: TaskInterpreter,
    private val backupRepository: BackupRepository,
    private val authRepository: AuthRepository,
    private val tasksSyncRepository: TasksSyncRepository,
) : ViewModelProvider.Factory {

    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return when {
            modelClass.isAssignableFrom(TodayViewModel::class.java) ->
                TodayViewModel(taskRepository, appContext, settingsStore) as T
            modelClass.isAssignableFrom(AllTasksViewModel::class.java) ->
                AllTasksViewModel(taskRepository, categoryRepository) as T
            modelClass.isAssignableFrom(CalendarViewModel::class.java) ->
                CalendarViewModel(taskRepository) as T
            modelClass.isAssignableFrom(NewTaskViewModel::class.java) ->
                NewTaskViewModel(taskRepository, categoryRepository, aiTaskInterpreter) as T
            modelClass.isAssignableFrom(CategoriesViewModel::class.java) ->
                CategoriesViewModel(categoryRepository) as T
            modelClass.isAssignableFrom(SettingsViewModel::class.java) ->
                SettingsViewModel(settingsStore, backupRepository, authRepository, tasksSyncRepository) as T
            modelClass.isAssignableFrom(TrashViewModel::class.java) ->
                TrashViewModel(taskRepository) as T
            modelClass.isAssignableFrom(StatisticsViewModel::class.java) ->
                StatisticsViewModel(taskRepository) as T
            else -> throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
        }
    }
}
