package com.organizador.app.ui.edittask

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.organizador.app.data.local.entity.Category
import com.organizador.app.data.local.entity.KanbanLane
import com.organizador.app.data.local.entity.Subtask
import com.organizador.app.data.local.entity.Task
import com.organizador.app.data.local.entity.TaskComment
import com.organizador.app.data.local.entity.TaskTemplate
import com.organizador.app.data.location.GeocodingHelper
import com.organizador.app.data.photo.PhotoStorage
import com.organizador.app.data.repository.CategoryRepository
import com.organizador.app.data.repository.KanbanLaneRepository
import com.organizador.app.data.repository.TaskCommentRepository
import com.organizador.app.data.repository.TaskRepository
import com.organizador.app.data.repository.TaskTemplateRepository
import com.organizador.app.domain.model.Priority
import com.organizador.app.domain.model.RecurrenceRule
import com.organizador.app.domain.common.toEpochMillis
import com.organizador.app.domain.common.toLocalDateTime
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Local, not-yet-persisted view of a subtask; [id] is null for items the user just added. */
data class SubtaskDraft(
    val id: Long?,
    val title: String,
    val isCompleted: Boolean,
)

data class EditTaskUiState(
    val isLoading: Boolean = true,
    val notFound: Boolean = false,
    val originalTask: Task? = null,
    val title: String = "",
    val description: String = "",
    val dueDate: LocalDate? = null,
    val dueTime: LocalTime? = null,
    val priority: Priority = Priority.MEDIUM,
    val selectedCategoryIds: List<Long> = emptyList(),
    val categories: List<Category> = emptyList(),
    val kanbanLaneId: Long? = null,
    val kanbanLanes: List<KanbanLane> = emptyList(),
    val comments: List<TaskComment> = emptyList(),
    val newCommentText: String = "",
    val isSendingComment: Boolean = false,
    val templateSaved: Boolean = false,
    val recurrence: RecurrenceRule? = null,
    val subtasks: List<SubtaskDraft> = emptyList(),
    val completedPomodoros: Int = 0,
    val photoPath: String? = null,
    val locationLabel: String? = null,
    val locationLat: Double? = null,
    val locationLng: Double? = null,
    val locationRadiusMeters: Float = DEFAULT_LOCATION_RADIUS_METERS,
    val locationSearchQuery: String = "",
    val isSearchingLocation: Boolean = false,
    val locationSearchError: Boolean = false,
    val isSaving: Boolean = false,
    val isPendingDelete: Boolean = false,
    val isDeleted: Boolean = false,
    val isSkipped: Boolean = false,
    val savedSuccessfully: Boolean = false,
) {
    val canSave: Boolean get() = title.isNotBlank() && !isSaving
    /** The sentinel time the app uses for "date only, no explicit time" due dates. */
    val hasExplicitTime: Boolean get() = dueTime != null
    val hasLocation: Boolean get() = locationLat != null && locationLng != null

    companion object {
        const val DEFAULT_LOCATION_RADIUS_METERS = 300f
    }
}

class EditTaskViewModel(
    private val taskId: Long,
    private val taskRepository: TaskRepository,
    private val categoryRepository: CategoryRepository,
    private val kanbanLaneRepository: KanbanLaneRepository,
    private val taskTemplateRepository: TaskTemplateRepository,
    private val taskCommentRepository: TaskCommentRepository,
    private val appContext: Context,
) : ViewModel() {

    private val _uiState = MutableStateFlow(EditTaskUiState())
    val uiState: StateFlow<EditTaskUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            val details = taskRepository.taskDetails(taskId).first()
            val categories = categoryRepository.categories.first()
            val lanes = kanbanLaneRepository.lanes.first()
            if (details == null) {
                _uiState.update { it.copy(isLoading = false, notFound = true, categories = categories, kanbanLanes = lanes) }
                return@launch
            }
            val task = details.task
            val dateTime = task.dueDate?.toLocalDateTime()
            val hasExplicitTime = dateTime != null && dateTime.toLocalTime() != LocalTime.of(23, 59)
            _uiState.update {
                it.copy(
                    isLoading = false,
                    originalTask = task,
                    title = task.title,
                    description = task.description.orEmpty(),
                    dueDate = dateTime?.toLocalDate(),
                    dueTime = if (hasExplicitTime) dateTime?.toLocalTime() else null,
                    priority = task.priority,
                    selectedCategoryIds = details.categories.map { it.id },
                    categories = categories,
                    kanbanLaneId = task.kanbanLaneId,
                    kanbanLanes = lanes,
                    recurrence = task.recurrenceRule?.let { RecurrenceRule.decode(it) },
                    subtasks = details.subtasks.map { subtask ->
                        SubtaskDraft(id = subtask.id, title = subtask.title, isCompleted = subtask.isCompleted)
                    },
                    completedPomodoros = task.completedPomodoros,
                    photoPath = task.photoPath,
                    locationLabel = task.locationLabel,
                    locationLat = task.locationLat,
                    locationLng = task.locationLng,
                    locationRadiusMeters = task.locationRadiusMeters ?: EditTaskUiState.DEFAULT_LOCATION_RADIUS_METERS,
                )
            }
            taskCommentRepository.commentsForTask(task.id)
                .onEach { comments -> _uiState.update { it.copy(comments = comments) } }
                .launchIn(viewModelScope)
            viewModelScope.launch { taskCommentRepository.refresh(task) }
        }
    }

    fun onTitleChanged(value: String) = _uiState.update { it.copy(title = value) }

    fun onDescriptionChanged(value: String) = _uiState.update { it.copy(description = value) }

    fun onDueDateSelected(date: LocalDate?) = _uiState.update {
        it.copy(dueDate = date, dueTime = if (date == null) null else it.dueTime)
    }

    fun onDueTimeSelected(time: LocalTime?) = _uiState.update { it.copy(dueTime = time) }

    fun onPrioritySelected(priority: Priority) = _uiState.update { it.copy(priority = priority) }

    fun onCategoryToggled(categoryId: Long) = _uiState.update {
        it.copy(
            selectedCategoryIds = if (it.selectedCategoryIds.contains(categoryId)) {
                it.selectedCategoryIds - categoryId
            } else {
                it.selectedCategoryIds + categoryId
            },
        )
    }

    fun onKanbanLaneSelected(laneId: Long?) = _uiState.update { it.copy(kanbanLaneId = laneId) }

    fun onNewCommentTextChanged(text: String) = _uiState.update { it.copy(newCommentText = text) }

    fun onSendComment() {
        val state = _uiState.value
        val task = state.originalTask ?: return
        val text = state.newCommentText.trim()
        if (text.isBlank() || state.isSendingComment) return
        _uiState.update { it.copy(isSendingComment = true) }
        viewModelScope.launch {
            taskCommentRepository.post(task, text)
            _uiState.update { it.copy(isSendingComment = false, newCommentText = "") }
        }
    }

    fun onDeleteComment(comment: TaskComment) {
        val task = _uiState.value.originalTask ?: return
        viewModelScope.launch { taskCommentRepository.delete(task, comment) }
    }

    /** Salva o estado atual do formulário como template reutilizável, sem afetar a tarefa em si. */
    fun onSaveAsTemplate(name: String) {
        val trimmedName = name.trim()
        if (trimmedName.isBlank()) return
        val state = _uiState.value
        viewModelScope.launch {
            taskTemplateRepository.save(
                TaskTemplate(
                    name = trimmedName,
                    title = state.title.trim(),
                    description = state.description.trim().ifBlank { null },
                    priority = state.priority,
                    categoryIds = TaskTemplate.encodeCategoryIds(state.selectedCategoryIds),
                    isRecurring = state.recurrence != null,
                    recurrenceRule = state.recurrence?.encode(),
                    subtaskTitles = state.subtasks.mapNotNull { it.title.trim().ifBlank { null } }.joinToString("\n"),
                ),
            )
            _uiState.update { it.copy(templateSaved = true) }
        }
    }

    fun onTemplateSavedAcknowledged() = _uiState.update { it.copy(templateSaved = false) }

    fun onRecurrenceSelected(rule: RecurrenceRule?) = _uiState.update { it.copy(recurrence = rule) }

    fun onPhotoPicked(path: String) = _uiState.update { it.copy(photoPath = path) }

    fun onPhotoRemoved() = _uiState.update { it.copy(photoPath = null) }

    fun onLocationSearchQueryChanged(query: String) = _uiState.update { it.copy(locationSearchQuery = query, locationSearchError = false) }

    fun onSearchLocation() {
        val query = _uiState.value.locationSearchQuery.trim()
        if (query.isBlank()) return
        _uiState.update { it.copy(isSearchingLocation = true, locationSearchError = false) }
        viewModelScope.launch {
            val address = GeocodingHelper.search(appContext, query)
            if (address == null) {
                _uiState.update { it.copy(isSearchingLocation = false, locationSearchError = true) }
                return@launch
            }
            val label = address.getAddressLine(0) ?: address.featureName ?: query
            _uiState.update {
                it.copy(
                    isSearchingLocation = false,
                    locationLabel = label,
                    locationLat = address.latitude,
                    locationLng = address.longitude,
                )
            }
        }
    }

    fun onLocationRadiusSelected(radiusMeters: Float) = _uiState.update { it.copy(locationRadiusMeters = radiusMeters) }

    fun onLocationRemoved() = _uiState.update {
        it.copy(locationLabel = null, locationLat = null, locationLng = null, locationSearchQuery = "")
    }

    fun onAddSubtask(title: String) {
        val trimmed = title.trim()
        if (trimmed.isBlank()) return
        _uiState.update { it.copy(subtasks = it.subtasks + SubtaskDraft(id = null, title = trimmed, isCompleted = false)) }
    }

    fun onSubtaskToggled(index: Int, isCompleted: Boolean) {
        _uiState.update { state ->
            state.copy(subtasks = state.subtasks.mapIndexed { i, s -> if (i == index) s.copy(isCompleted = isCompleted) else s })
        }
    }

    fun onSubtaskTitleChanged(index: Int, title: String) {
        _uiState.update { state ->
            state.copy(subtasks = state.subtasks.mapIndexed { i, s -> if (i == index) s.copy(title = title) else s })
        }
    }

    fun onRemoveSubtask(index: Int) {
        _uiState.update { state -> state.copy(subtasks = state.subtasks.filterIndexed { i, _ -> i != index }) }
    }

    fun onSave() {
        val state = _uiState.value
        val original = state.originalTask ?: return
        if (!state.canSave) return

        _uiState.update { it.copy(isSaving = true) }
        viewModelScope.launch {
            val dueDateTime = state.dueDate?.let { date ->
                LocalDateTime.of(date, state.dueTime ?: LocalTime.of(23, 59))
            }
            val task = original.copy(
                title = state.title.trim(),
                description = state.description.trim().ifBlank { null },
                dueDate = dueDateTime?.toEpochMillis(),
                priority = state.priority,
                kanbanLaneId = state.kanbanLaneId,
                isRecurring = state.recurrence != null,
                recurrenceRule = state.recurrence?.encode(),
                photoPath = state.photoPath,
                locationLat = state.locationLat,
                locationLng = state.locationLng,
                locationRadiusMeters = if (state.hasLocation) state.locationRadiusMeters else null,
                locationLabel = state.locationLabel,
            )
            if (original.photoPath != null && original.photoPath != state.photoPath) {
                PhotoStorage.delete(original.photoPath)
            }
            taskRepository.upsert(task, state.selectedCategoryIds)
            val subtasks = state.subtasks
                .filter { it.title.isNotBlank() }
                .map { Subtask(id = it.id ?: 0, taskId = taskId, title = it.title.trim(), isCompleted = it.isCompleted) }
            taskRepository.replaceSubtasks(taskId, subtasks)
            _uiState.update { it.copy(isSaving = false, savedSuccessfully = true) }
        }
    }

    /** Marks the task for deletion; the screen shows an undo snackbar and calls [onConfirmDelete] or [onCancelPendingDelete] once it resolves. */
    fun onRequestDelete() {
        _uiState.update { it.copy(isPendingDelete = true) }
    }

    fun onCancelPendingDelete() {
        _uiState.update { it.copy(isPendingDelete = false) }
    }

    fun onConfirmDelete() {
        val original = _uiState.value.originalTask ?: return
        viewModelScope.launch {
            taskRepository.moveToTrash(original)
            _uiState.update { it.copy(isPendingDelete = false, isDeleted = true) }
        }
    }

    /** Skips the currently saved occurrence of a recurring task: the next occurrence is created and this one is trashed without counting as completed. */
    fun onSkipOccurrence() {
        val original = _uiState.value.originalTask ?: return
        if (!original.isRecurring) return
        viewModelScope.launch {
            taskRepository.skipCurrentOccurrence(original)
            _uiState.update { it.copy(isSkipped = true) }
        }
    }
}
