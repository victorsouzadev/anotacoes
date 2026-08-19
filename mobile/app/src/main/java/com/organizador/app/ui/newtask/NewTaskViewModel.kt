package com.organizador.app.ui.newtask

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.organizador.app.data.local.entity.Task
import com.organizador.app.data.repository.CategoryRepository
import com.organizador.app.data.repository.TaskRepository
import com.organizador.app.domain.model.Priority
import com.organizador.app.domain.model.RecurrenceRule
import com.organizador.app.domain.nlp.NaturalLanguageTaskParser
import com.organizador.app.domain.nlp.ParsedTask
import com.organizador.app.domain.nlp.TaskInterpreter
import com.organizador.app.domain.common.toEpochMillis
import kotlin.math.absoluteValue
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class InterpretationSource { LOCAL, AI }

data class NewTaskUiState(
    val rawInput: String = "",
    val parsedItems: List<ParsedTask> = emptyList(),
    val interpretationSource: InterpretationSource = InterpretationSource.LOCAL,
    val isInterpretingWithAi: Boolean = false,
    val aiError: String? = null,
    val priority: Priority = Priority.MEDIUM,
    val priorityManuallySet: Boolean = false,
    val recurrence: RecurrenceRule? = null,
    val isSaving: Boolean = false,
    val savedSuccessfully: Boolean = false,
) {
    /** How many tasks "Salvar" will actually create: every parsed item, or a single manual task from the raw text when nothing parsed. */
    val taskCount: Int get() = if (parsedItems.isNotEmpty()) parsedItems.size else if (rawInput.isNotBlank()) 1 else 0
    val canSave: Boolean get() = taskCount > 0 && !isSaving
    val canInterpretWithAi: Boolean get() = rawInput.isNotBlank() && !isInterpretingWithAi
}

/** Palette offered when a #hashtag introduces a brand new category, cycled deterministically by name. */
private val autoCategoryColors = listOf("#3ED9C3", "#6E7BFF", "#F2B84B", "#FF6161", "#8A93A3")

class NewTaskViewModel(
    private val taskRepository: TaskRepository,
    private val categoryRepository: CategoryRepository,
    private val aiTaskInterpreter: TaskInterpreter,
) : ViewModel() {

    private val _uiState = MutableStateFlow(NewTaskUiState())
    val uiState: StateFlow<NewTaskUiState> = _uiState.asStateFlow()

    fun onRawInputChanged(text: String) {
        val parsedItems = NaturalLanguageTaskParser.parseBatch(text)
        _uiState.update { state ->
            state.copy(
                rawInput = text,
                parsedItems = parsedItems,
                interpretationSource = InterpretationSource.LOCAL,
                aiError = null,
                priority = fallbackPriority(state, parsedItems),
            )
        }
    }

    fun onInterpretWithAi() {
        val state = _uiState.value
        if (!state.canInterpretWithAi) return

        _uiState.update { it.copy(isInterpretingWithAi = true, aiError = null) }
        viewModelScope.launch {
            aiTaskInterpreter.interpret(state.rawInput)
                .onSuccess { parsedItems ->
                    _uiState.update { current ->
                        current.copy(
                            parsedItems = parsedItems,
                            interpretationSource = InterpretationSource.AI,
                            isInterpretingWithAi = false,
                            priority = fallbackPriority(current, parsedItems),
                        )
                    }
                }
                .onFailure { error ->
                    _uiState.update {
                        it.copy(
                            isInterpretingWithAi = false,
                            aiError = error.message ?: "Não foi possível interpretar o texto com IA",
                        )
                    }
                }
        }
    }

    fun onRemoveParsedItem(index: Int) {
        _uiState.update { state ->
            state.copy(parsedItems = state.parsedItems.filterIndexed { i, _ -> i != index })
        }
    }

    private fun fallbackPriority(state: NewTaskUiState, parsedItems: List<ParsedTask>): Priority {
        if (state.priorityManuallySet) return state.priority
        return parsedItems.firstNotNullOfOrNull { it.priority } ?: state.priority
    }

    fun onPrioritySelected(priority: Priority) {
        _uiState.update { it.copy(priority = priority, priorityManuallySet = true) }
    }

    fun onRecurrenceSelected(rule: RecurrenceRule?) {
        _uiState.update { it.copy(recurrence = rule) }
    }

    fun onSave() {
        val state = _uiState.value
        if (!state.canSave) return

        val items = state.parsedItems.ifEmpty {
            listOf(
                ParsedTask(
                    cleanTitle = state.rawInput.trim(),
                    dueDateTime = null,
                    hasExplicitTime = false,
                    categoryName = null,
                    priority = null,
                    hints = emptyList(),
                ),
            )
        }

        _uiState.update { it.copy(isSaving = true) }
        viewModelScope.launch {
            for (item in items) {
                val title = item.cleanTitle.ifBlank { state.rawInput.trim() }
                if (title.isBlank()) continue

                val categoryId = item.categoryName?.let { name ->
                    categoryRepository.getOrCreateByName(name, autoColorFor(name)).id
                }
                val task = Task(
                    title = title,
                    dueDate = item.dueDateTime?.toEpochMillis(),
                    priority = item.priority ?: state.priority,
                    categoryId = categoryId,
                    isRecurring = state.recurrence != null,
                    recurrenceRule = state.recurrence?.encode(),
                )
                taskRepository.createTaskWithSubtasks(task, item.subtasks)
            }
            _uiState.update { it.copy(isSaving = false, savedSuccessfully = true) }
        }
    }

    fun onSavedHandled() {
        _uiState.update { NewTaskUiState() }
    }

    private fun autoColorFor(categoryName: String): String {
        val index = categoryName.lowercase().hashCode().absoluteValue % autoCategoryColors.size
        return autoCategoryColors[index]
    }
}
