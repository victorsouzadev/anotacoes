package com.organizador.app.widget

import android.content.Context
import androidx.glance.GlanceId
import androidx.glance.action.ActionParameters
import androidx.glance.appwidget.action.ActionCallback
import com.organizador.app.data.repository.buildTaskRepository

/** Marks a task complete from a tap on the home screen widget; [com.organizador.app.data.repository.TaskRepository] refreshes the widget itself. */
class CompleteTaskAction : ActionCallback {

    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val taskId = parameters[taskIdActionKey] ?: return
        buildTaskRepository(context).setCompleted(taskId, true)
    }
}
