package com.organizador.app.di

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.organizador.app.data.repository.CategoryRepository
import com.organizador.app.data.repository.KanbanLaneRepository
import com.organizador.app.data.repository.TaskCommentRepository
import com.organizador.app.data.repository.TaskRepository
import com.organizador.app.data.repository.TaskTemplateRepository
import com.organizador.app.ui.edittask.EditTaskViewModel

/** Separate from [AppViewModelFactory] because EditTaskViewModel needs the taskId being edited, which isn't known until navigation time. */
class EditTaskViewModelFactory(
    private val taskId: Long,
    private val taskRepository: TaskRepository,
    private val categoryRepository: CategoryRepository,
    private val kanbanLaneRepository: KanbanLaneRepository,
    private val taskTemplateRepository: TaskTemplateRepository,
    private val taskCommentRepository: TaskCommentRepository,
    private val appContext: Context,
) : ViewModelProvider.Factory {

    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        require(modelClass.isAssignableFrom(EditTaskViewModel::class.java)) {
            "EditTaskViewModelFactory can only create EditTaskViewModel, got ${modelClass.name}"
        }
        return EditTaskViewModel(
            taskId,
            taskRepository,
            categoryRepository,
            kanbanLaneRepository,
            taskTemplateRepository,
            taskCommentRepository,
            appContext,
        ) as T
    }
}
