package com.organizador.app.data.repository

import com.organizador.app.data.local.dao.CategoryDao
import com.organizador.app.data.local.dao.SubtaskDao
import com.organizador.app.data.local.dao.TaskCategoryCrossRefDao
import com.organizador.app.data.local.dao.TaskDao
import com.organizador.app.data.local.entity.Category
import com.organizador.app.data.local.entity.Subtask
import com.organizador.app.data.local.entity.Task
import com.organizador.app.data.local.entity.TaskCategoryCrossRef
import com.organizador.app.data.photo.PhotoStorage
import com.organizador.app.domain.calendar.CalendarSync
import com.organizador.app.domain.common.toEpochMillis
import com.organizador.app.domain.common.toLocalDateTime
import com.organizador.app.domain.location.LocationReminderScheduler
import com.organizador.app.domain.model.RecurrenceRule
import com.organizador.app.domain.model.TaskWithCategory
import com.organizador.app.domain.model.nextOccurrence
import com.organizador.app.domain.reminder.TaskReminderScheduler
import com.organizador.app.domain.widget.WidgetRefresher
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first

class TaskRepository(
    private val taskDao: TaskDao,
    private val categoryDao: CategoryDao,
    private val taskCategoryCrossRefDao: TaskCategoryCrossRefDao,
    private val subtaskDao: SubtaskDao,
    private val reminderScheduler: TaskReminderScheduler,
    private val calendarSync: CalendarSync,
    private val widgetRefresher: WidgetRefresher,
    private val locationReminderScheduler: LocationReminderScheduler,
) {

    val allTasks: Flow<List<TaskWithCategory>> =
        combine(taskDao.getAllTasks(), categoryDao.getAllCategories(), taskCategoryCrossRefDao.getAllCrossRefs(), subtaskDao.getAllSubtasks(), ::attachDetails)

    val recurringTasks: Flow<List<TaskWithCategory>> =
        combine(taskDao.getRecurringTasks(), categoryDao.getAllCategories(), taskCategoryCrossRefDao.getAllCrossRefs(), subtaskDao.getAllSubtasks(), ::attachDetails)

    fun todayTasks(startOfDayMillis: Long, endOfDayMillis: Long): Flow<List<TaskWithCategory>> =
        combine(
            taskDao.getTodayTasks(startOfDayMillis, endOfDayMillis),
            categoryDao.getAllCategories(),
            taskCategoryCrossRefDao.getAllCrossRefs(),
            subtaskDao.getAllSubtasks(),
            ::attachDetails,
        )

    fun overdueTasks(startOfDayMillis: Long): Flow<List<TaskWithCategory>> =
        combine(
            taskDao.getOverdueTasks(startOfDayMillis),
            categoryDao.getAllCategories(),
            taskCategoryCrossRefDao.getAllCrossRefs(),
            subtaskDao.getAllSubtasks(),
            ::attachDetails,
        )

    /** Single task with its categories and subtasks, for the edit screen. Emits null once the task no longer exists (e.g. deleted). */
    fun taskDetails(taskId: Long): Flow<TaskWithCategory?> =
        combine(
            taskDao.getTaskById(taskId),
            categoryDao.getAllCategories(),
            taskCategoryCrossRefDao.getAllCrossRefs(),
            subtaskDao.getSubtasksForTask(taskId),
        ) { task, categories, crossRefs, subtasks ->
            task?.let {
                val categoriesById = categories.associateBy { c -> c.id }
                TaskWithCategory(
                    task = it,
                    categories = crossRefs.filter { ref -> ref.taskId == it.id }.mapNotNull { ref -> categoriesById[ref.categoryId] },
                    subtasks = subtasks,
                )
            }
        }

    val trashedTasks: Flow<List<TaskWithCategory>> =
        combine(taskDao.getTrashedTasks(), categoryDao.getAllCategories(), taskCategoryCrossRefDao.getAllCrossRefs(), subtaskDao.getAllSubtasks(), ::attachDetails)

    /** Soft-deletes a task (recoverable from the trash), cancels its reminder and removes its calendar event. */
    suspend fun moveToTrash(task: Task) {
        taskDao.setDeletedAt(task.id, System.currentTimeMillis())
        reminderScheduler.cancel(task.id)
        locationReminderScheduler.cancel(task.id)
        calendarSync.remove(task.calendarEventId)
        taskDao.setCalendarEventId(task.id, null)
        widgetRefresher.refresh()
    }

    suspend fun restoreFromTrash(task: Task) {
        val restored = task.copy(deletedAt = null, calendarEventId = null)
        taskDao.setDeletedAt(task.id, null)
        reminderScheduler.schedule(restored)
        locationReminderScheduler.schedule(restored)
        syncCalendarEvent(restored)
        widgetRefresher.refresh()
    }

    /** Irreversibly removes a task, used by the trash screen. An alias for [delete] kept for readability at call sites. */
    suspend fun permanentlyDelete(task: Task) = delete(task)

    suspend fun purgeOldTrash(retentionDays: Int = 30) {
        val cutoff = System.currentTimeMillis() - retentionDays * 24L * 60 * 60 * 1000
        taskDao.purgeTrashedBefore(cutoff)
    }

    suspend fun incrementPomodoroCount(taskId: Long) = taskDao.incrementPomodoroCount(taskId)

    suspend fun upsert(task: Task, categoryIds: List<Long>? = null): Long {
        // Room's @Upsert returns -1 when it takes the update branch (task.id already exists) —
        // only a genuine insert produces a real generated id, so trust task.id whenever it's set.
        val generatedId = taskDao.upsert(task.copy(updatedAt = System.currentTimeMillis()))
        val taskId = if (task.id != 0L) task.id else generatedId
        if (categoryIds != null) taskCategoryCrossRefDao.replaceForTask(taskId, categoryIds)
        val withId = task.copy(id = taskId)
        reminderScheduler.schedule(withId)
        locationReminderScheduler.schedule(withId)
        syncCalendarEvent(withId)
        widgetRefresher.refresh()
        return taskId
    }

    suspend fun delete(task: Task) {
        taskDao.delete(task)
        reminderScheduler.cancel(task.id)
        locationReminderScheduler.cancel(task.id)
        calendarSync.remove(task.calendarEventId)
        PhotoStorage.delete(task.photoPath)
        widgetRefresher.refresh()
    }

    suspend fun setCompleted(taskId: Long, isCompleted: Boolean) {
        taskDao.setCompleted(taskId, isCompleted, if (isCompleted) System.currentTimeMillis() else null)
        val task = taskDao.getTaskOnce(taskId) ?: return

        if (!isCompleted) {
            reminderScheduler.schedule(task)
            locationReminderScheduler.schedule(task)
            widgetRefresher.refresh()
            return
        }

        reminderScheduler.cancel(taskId)
        locationReminderScheduler.cancel(taskId)
        val rule = task.recurrenceRule?.let { RecurrenceRule.decode(it) }
        if (task.isRecurring && rule != null) {
            createNextOccurrence(task, rule)
        }
        widgetRefresher.refresh()
    }

    /**
     * Skips this occurrence of a recurring task without counting it as done: creates the next
     * occurrence (same as completing it would) but sends this instance to the trash instead of
     * marking it completed, so it doesn't inflate completion stats.
     */
    suspend fun skipCurrentOccurrence(task: Task) {
        val rule = task.recurrenceRule?.let { RecurrenceRule.decode(it) } ?: return
        createNextOccurrence(task, rule)
        taskDao.setDeletedAt(task.id, System.currentTimeMillis())
        reminderScheduler.cancel(task.id)
        locationReminderScheduler.cancel(task.id)
        calendarSync.remove(task.calendarEventId)
        taskDao.setCalendarEventId(task.id, null)
        widgetRefresher.refresh()
    }

    private suspend fun createNextOccurrence(completedTask: Task, rule: RecurrenceRule) {
        val baseDateTime = (completedTask.dueDate ?: System.currentTimeMillis()).toLocalDateTime()
        val nextDueMillis = rule.nextOccurrence(baseDateTime).toEpochMillis()

        val nextTask = completedTask.copy(
            id = 0,
            dueDate = nextDueMillis,
            isCompleted = false,
            completedAt = null,
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis(),
            // The completed instance's calendar event (if any) stays on the calendar as a historical
            // record; the next occurrence needs its own, so it must not inherit that id.
            calendarEventId = null,
            // Genuinely a new task server-side too — must not inherit the completed instance's remoteId.
            remoteId = null,
        )
        val nextTaskId = taskDao.upsert(nextTask)
        val categoryIds = taskCategoryCrossRefDao.getCategoryIdsForTaskOnce(completedTask.id)
        if (categoryIds.isNotEmpty()) taskCategoryCrossRefDao.replaceForTask(nextTaskId, categoryIds)

        val originalSubtasks = subtaskDao.getSubtasksForTask(completedTask.id).first()
        if (originalSubtasks.isNotEmpty()) {
            val freshSubtasks = originalSubtasks.map { it.copy(id = 0, taskId = nextTaskId, isCompleted = false) }
            subtaskDao.upsertAll(freshSubtasks)
        }

        val withId = nextTask.copy(id = nextTaskId)
        reminderScheduler.schedule(withId)
        locationReminderScheduler.schedule(withId)
        syncCalendarEvent(withId)
    }

    /** Cria uma cópia independente de [task] (novo id local, sem remoteId/calendarEventId/photoPath
     * — cada tarefa precisa dos seus), preservando as subtarefas (zeradas) e o restante dos campos. */
    suspend fun duplicate(task: Task): Long {
        val now = System.currentTimeMillis()
        val copy = task.copy(
            id = 0,
            title = "${task.title} (cópia)",
            isCompleted = false,
            completedAt = null,
            deletedAt = null,
            completedPomodoros = 0,
            calendarEventId = null,
            photoPath = null,
            remoteId = null,
            createdAt = now,
            updatedAt = now,
        )
        val subtaskTitles = subtaskDao.getSubtasksForTask(task.id).first().sortedBy { it.position }.map { it.title }
        val categoryIds = taskCategoryCrossRefDao.getCategoryIdsForTaskOnce(task.id)
        return createTaskWithSubtasks(copy, subtaskTitles, categoryIds)
    }

    /** Persists a drag-reordered task list (manual sort mode). No side-effects (reminders/calendar/widget) needed — only display order changes. */
    suspend fun reorderTasks(orderedTaskIds: List<Long>) = taskDao.updatePositions(orderedTaskIds)

    suspend fun setSubtaskCompleted(subtaskId: Long, isCompleted: Boolean) {
        subtaskDao.setCompleted(subtaskId, isCompleted)
        subtaskDao.getTaskIdForSubtask(subtaskId)?.let { taskDao.touchUpdatedAt(it) }
    }

    /** Creates a task and its checklist items together, used by the "new task" flow which can produce several tasks at once. */
    suspend fun createTaskWithSubtasks(task: Task, subtaskTitles: List<String>, categoryIds: List<Long> = emptyList()): Long {
        val taskId = taskDao.upsert(task.copy(updatedAt = System.currentTimeMillis()))
        if (subtaskTitles.isNotEmpty()) {
            val subtasks = subtaskTitles.mapIndexed { index, title ->
                Subtask(taskId = taskId, title = title, position = index)
            }
            subtaskDao.upsertAll(subtasks)
        }
        if (categoryIds.isNotEmpty()) taskCategoryCrossRefDao.replaceForTask(taskId, categoryIds)
        val withId = task.copy(id = taskId)
        reminderScheduler.schedule(withId)
        locationReminderScheduler.schedule(withId)
        syncCalendarEvent(withId)
        widgetRefresher.refresh()
        return taskId
    }

    /** Creates/updates or removes [task]'s device calendar event to match its current due date and
     * the user's calendar-sync setting, persisting whichever event id results. */
    private suspend fun syncCalendarEvent(task: Task) {
        val newEventId = calendarSync.sync(task)
        if (newEventId == null && task.calendarEventId != null) {
            calendarSync.remove(task.calendarEventId)
        }
        if (newEventId != task.calendarEventId) {
            taskDao.setCalendarEventId(task.id, newEventId)
        }
    }

    /** Replaces every subtask of [taskId] with [subtasks], used by the edit screen where items can be added, edited or removed freely. */
    suspend fun replaceSubtasks(taskId: Long, subtasks: List<Subtask>) {
        subtaskDao.deleteAllForTask(taskId)
        if (subtasks.isNotEmpty()) {
            val positioned = subtasks.mapIndexed { index, subtask ->
                subtask.copy(id = 0, taskId = taskId, position = index)
            }
            subtaskDao.upsertAll(positioned)
        }
        taskDao.touchUpdatedAt(taskId)
    }

    private fun attachDetails(
        tasks: List<Task>,
        categories: List<Category>,
        crossRefs: List<TaskCategoryCrossRef>,
        subtasks: List<Subtask>,
    ): List<TaskWithCategory> {
        val categoriesById = categories.associateBy { it.id }
        val categoryIdsByTaskId = crossRefs.groupBy({ it.taskId }, { it.categoryId })
        val subtasksByTaskId = subtasks.groupBy { it.taskId }
        return tasks.map { task ->
            TaskWithCategory(
                task = task,
                categories = categoryIdsByTaskId[task.id].orEmpty().mapNotNull(categoriesById::get),
                subtasks = subtasksByTaskId[task.id].orEmpty(),
            )
        }
    }
}
