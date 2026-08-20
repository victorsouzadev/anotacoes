package com.organizador.app.ui.edittask

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.BookmarkAdd
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Photo
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.organizador.app.R
import com.organizador.app.data.local.entity.TaskComment
import com.organizador.app.data.photo.PhotoStorage
import com.organizador.app.ui.common.rememberEditTaskViewModelFactory
import com.organizador.app.ui.components.PrioritySelector
import com.organizador.app.ui.components.RecurrenceSelector
import com.organizador.app.ui.theme.Accent
import com.organizador.app.ui.theme.Background
import com.organizador.app.ui.theme.OnSurfaceSecondary
import com.organizador.app.ui.theme.Outline
import com.organizador.app.ui.theme.PriorityHigh
import com.organizador.app.ui.theme.Surface as SurfaceColor
import com.organizador.app.ui.theme.SurfaceVariant
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

@Composable
fun EditTaskScreen(
    taskId: Long,
    onBack: () -> Unit,
    onSaved: () -> Unit,
    onDeleted: () -> Unit,
    onStartPomodoro: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: EditTaskViewModel = viewModel(factory = rememberEditTaskViewModelFactory(taskId)),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bitmap ->
        val path = bitmap?.let { PhotoStorage.saveBitmap(context, it) }
        if (path != null) viewModel.onPhotoPicked(path)
    }
    val galleryLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        val path = uri?.let { PhotoStorage.saveFromUri(context, it) }
        if (path != null) viewModel.onPhotoPicked(path)
    }
    var showDeleteConfirm by remember { mutableStateOf(false) }
    var showSkipConfirm by remember { mutableStateOf(false) }
    var showDatePicker by remember { mutableStateOf(false) }
    var showTimePicker by remember { mutableStateOf(false) }
    var showSaveTemplateDialog by remember { mutableStateOf(false) }
    var newSubtaskText by remember { mutableStateOf("") }
    val snackbarHostState = remember { SnackbarHostState() }
    val deletingMessage = stringResource(R.string.undo_task_deleting)
    val undoLabel = stringResource(R.string.undo_action)
    val templateSavedMessage = stringResource(R.string.task_template_saved)

    LaunchedEffect(uiState.savedSuccessfully) { if (uiState.savedSuccessfully) onSaved() }
    LaunchedEffect(uiState.isDeleted) { if (uiState.isDeleted) onDeleted() }
    LaunchedEffect(uiState.isSkipped) { if (uiState.isSkipped) onDeleted() }
    LaunchedEffect(uiState.templateSaved) {
        if (uiState.templateSaved) {
            snackbarHostState.showSnackbar(message = templateSavedMessage, duration = SnackbarDuration.Short)
            viewModel.onTemplateSavedAcknowledged()
        }
    }
    LaunchedEffect(uiState.isPendingDelete) {
        if (uiState.isPendingDelete) {
            val result = snackbarHostState.showSnackbar(
                message = deletingMessage,
                actionLabel = undoLabel,
                duration = SnackbarDuration.Short,
            )
            if (result == SnackbarResult.ActionPerformed) {
                viewModel.onCancelPendingDelete()
            } else {
                viewModel.onConfirmDelete()
            }
        }
    }

    val canEdit = !uiState.isLoading && !uiState.notFound

    Scaffold(
        modifier = modifier,
        containerColor = Background,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.edit_task_title), style = MaterialTheme.typography.titleMedium) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null)
                    }
                },
                actions = {
                    if (canEdit) {
                        IconButton(onClick = { showSaveTemplateDialog = true }) {
                            Icon(
                                imageVector = Icons.Filled.BookmarkAdd,
                                contentDescription = stringResource(R.string.task_template_save),
                            )
                        }
                        IconButton(onClick = { shareTask(context, uiState) }) {
                            Icon(
                                imageVector = Icons.Filled.Share,
                                contentDescription = stringResource(R.string.edit_task_share),
                            )
                        }
                    }
                    if (canEdit && !uiState.isPendingDelete) {
                        IconButton(onClick = { showDeleteConfirm = true }) {
                            Icon(
                                imageVector = Icons.Filled.Delete,
                                contentDescription = stringResource(R.string.edit_task_delete),
                                tint = PriorityHigh,
                            )
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Background),
            )
        },
        snackbarHost = {
            SnackbarHost(snackbarHostState) { data ->
                Snackbar(snackbarData = data, containerColor = SurfaceColor, actionColor = Accent)
            }
        },
        bottomBar = {
            if (canEdit) {
                Surface(color = Background) {
                    Button(
                        onClick = viewModel::onSave,
                        enabled = uiState.canSave,
                        modifier = Modifier
                            .fillMaxWidth()
                            .navigationBarsPadding()
                            .padding(16.dp)
                            .heightIn(min = 52.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Accent,
                            contentColor = Background,
                            disabledContainerColor = SurfaceVariant,
                            disabledContentColor = OnSurfaceSecondary,
                        ),
                    ) {
                        Text(stringResource(R.string.edit_task_save), style = MaterialTheme.typography.titleSmall)
                    }
                }
            }
        },
    ) { paddingValues ->
        when {
            uiState.isLoading -> Box(
                modifier = Modifier.fillMaxSize().padding(paddingValues),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator(color = Accent)
            }
            uiState.notFound -> Box(
                modifier = Modifier.fillMaxSize().padding(paddingValues),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = stringResource(R.string.edit_task_not_found),
                    color = OnSurfaceSecondary,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            else -> Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(24.dp),
            ) {
                OutlinedTextField(
                    value = uiState.title,
                    onValueChange = viewModel::onTitleChanged,
                    label = { Text(stringResource(R.string.edit_task_title_label)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    colors = fieldColors(),
                )

                OutlinedTextField(
                    value = uiState.description,
                    onValueChange = viewModel::onDescriptionChanged,
                    label = { Text(stringResource(R.string.edit_task_description_label)) },
                    minLines = 2,
                    modifier = Modifier.fillMaxWidth(),
                    colors = fieldColors(),
                )

                OutlinedButton(
                    onClick = onStartPomodoro,
                    modifier = Modifier.fillMaxWidth(),
                    border = BorderStroke(1.dp, Accent),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Accent),
                ) {
                    Icon(Icons.Filled.Timer, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(
                        if (uiState.completedPomodoros > 0) {
                            stringResource(R.string.edit_task_pomodoro_start_with_count, uiState.completedPomodoros)
                        } else {
                            stringResource(R.string.edit_task_pomodoro_start)
                        },
                    )
                }

                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.edit_task_photo_label), style = MaterialTheme.typography.titleSmall)
                    val photoPath = uiState.photoPath
                    if (photoPath != null) {
                        val imageBitmap = remember(photoPath) { BitmapFactory.decodeFile(photoPath)?.asImageBitmap() }
                        Box(modifier = Modifier.fillMaxWidth()) {
                            if (imageBitmap != null) {
                                Image(
                                    bitmap = imageBitmap,
                                    contentDescription = null,
                                    contentScale = ContentScale.Crop,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .heightIn(max = 200.dp)
                                        .clip(RoundedCornerShape(12.dp)),
                                )
                            }
                            IconButton(
                                onClick = viewModel::onPhotoRemoved,
                                modifier = Modifier
                                    .align(Alignment.TopEnd)
                                    .padding(6.dp)
                                    .clip(RoundedCornerShape(50))
                                    .background(Color.Black.copy(alpha = 0.5f)),
                            ) {
                                Icon(
                                    imageVector = Icons.Filled.Close,
                                    contentDescription = stringResource(R.string.edit_task_photo_remove),
                                    tint = Color.White,
                                )
                            }
                        }
                    } else {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            OutlinedButton(onClick = { cameraLauncher.launch(null) }) {
                                Icon(Icons.Filled.PhotoCamera, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(6.dp))
                                Text(stringResource(R.string.edit_task_photo_camera))
                            }
                            OutlinedButton(onClick = { galleryLauncher.launch("image/*") }) {
                                Icon(Icons.Filled.Photo, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(6.dp))
                                Text(stringResource(R.string.edit_task_photo_gallery))
                            }
                        }
                    }
                }

                LocationReminderSection(
                    uiState = uiState,
                    onQueryChanged = viewModel::onLocationSearchQueryChanged,
                    onSearch = viewModel::onSearchLocation,
                    onRadiusSelected = viewModel::onLocationRadiusSelected,
                    onRemove = viewModel::onLocationRemoved,
                )

                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.edit_task_due_label), style = MaterialTheme.typography.titleSmall)
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        ActionChip(
                            label = uiState.dueDate?.format(DateTimeFormatter.ofPattern("dd/MM/yyyy"))
                                ?: stringResource(R.string.edit_task_due_none),
                            onClick = { showDatePicker = true },
                        )
                        if (uiState.dueDate != null) {
                            ActionChip(
                                label = uiState.dueTime?.format(DateTimeFormatter.ofPattern("HH:mm"))
                                    ?: stringResource(R.string.edit_task_time_none),
                                onClick = { showTimePicker = true },
                            )
                            IconButton(onClick = { viewModel.onDueDateSelected(null) }, modifier = Modifier.heightIn(max = 36.dp)) {
                                Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.edit_task_due_none), tint = OnSurfaceSecondary)
                            }
                        }
                    }
                }

                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.new_task_priority_label), style = MaterialTheme.typography.titleSmall)
                    PrioritySelector(selected = uiState.priority, onSelect = viewModel::onPrioritySelected)
                }

                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.edit_task_category_label), style = MaterialTheme.typography.titleSmall)
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                    ) {
                        uiState.categories.forEach { category ->
                            ActionChip(
                                label = category.name,
                                onClick = { viewModel.onCategoryToggled(category.id) },
                                isSelected = uiState.selectedCategoryIds.contains(category.id),
                            )
                        }
                    }
                }

                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.kanban_lane_label), style = MaterialTheme.typography.titleSmall)
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                    ) {
                        ActionChip(
                            label = stringResource(R.string.kanban_lane_none),
                            onClick = { viewModel.onKanbanLaneSelected(null) },
                            isSelected = uiState.kanbanLaneId == null,
                        )
                        uiState.kanbanLanes.forEach { lane ->
                            ActionChip(
                                label = lane.name,
                                onClick = { viewModel.onKanbanLaneSelected(lane.id) },
                                isSelected = uiState.kanbanLaneId == lane.id,
                            )
                        }
                    }
                }

                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.new_task_recurrence_label), style = MaterialTheme.typography.titleSmall)
                    RecurrenceSelector(selected = uiState.recurrence, onSelect = viewModel::onRecurrenceSelected)
                    if (uiState.originalTask?.isRecurring == true) {
                        ActionChip(
                            label = stringResource(R.string.edit_task_skip_occurrence_action),
                            onClick = { showSkipConfirm = true },
                        )
                    }
                }

                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.edit_task_subtasks_label), style = MaterialTheme.typography.titleSmall)
                    uiState.subtasks.forEachIndexed { index, draft ->
                        EditableSubtaskRow(
                            draft = draft,
                            onToggle = { checked -> viewModel.onSubtaskToggled(index, checked) },
                            onTitleChange = { text -> viewModel.onSubtaskTitleChanged(index, text) },
                            onRemove = { viewModel.onRemoveSubtask(index) },
                        )
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(
                            value = newSubtaskText,
                            onValueChange = { newSubtaskText = it },
                            placeholder = { Text(stringResource(R.string.edit_task_add_subtask_placeholder), color = OnSurfaceSecondary) },
                            singleLine = true,
                            modifier = Modifier.weight(1f),
                            colors = fieldColors(),
                        )
                        IconButton(
                            onClick = {
                                viewModel.onAddSubtask(newSubtaskText)
                                newSubtaskText = ""
                            },
                        ) {
                            Icon(
                                imageVector = Icons.Filled.Add,
                                contentDescription = stringResource(R.string.edit_task_add_subtask_action),
                                tint = Accent,
                            )
                        }
                    }
                }

                CommentsSection(
                    comments = uiState.comments,
                    newCommentText = uiState.newCommentText,
                    isSending = uiState.isSendingComment,
                    onTextChanged = viewModel::onNewCommentTextChanged,
                    onSend = viewModel::onSendComment,
                    onDelete = viewModel::onDeleteComment,
                    loginRequired = uiState.originalTask?.remoteId == null,
                )
            }
        }
    }

    if (showSaveTemplateDialog) {
        var templateName by remember { mutableStateOf(uiState.title) }
        AlertDialog(
            onDismissRequest = { showSaveTemplateDialog = false },
            containerColor = SurfaceColor,
            title = { Text(stringResource(R.string.task_template_save_title)) },
            text = {
                OutlinedTextField(
                    value = templateName,
                    onValueChange = { templateName = it },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    colors = fieldColors(),
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showSaveTemplateDialog = false
                        viewModel.onSaveAsTemplate(templateName)
                    },
                ) { Text(stringResource(R.string.task_template_save), color = Accent) }
            },
            dismissButton = {
                TextButton(onClick = { showSaveTemplateDialog = false }) { Text(stringResource(R.string.common_cancel), color = OnSurfaceSecondary) }
            },
        )
    }

    if (showDatePicker) {
        val initialMillis = (uiState.dueDate ?: LocalDate.now())
            .atStartOfDay(ZoneOffset.UTC)
            .toInstant()
            .toEpochMilli()
        val datePickerState = rememberDatePickerState(initialSelectedDateMillis = initialMillis)
        DatePickerDialog(
            onDismissRequest = { showDatePicker = false },
            confirmButton = {
                TextButton(
                    onClick = {
                        val millis = datePickerState.selectedDateMillis
                        if (millis != null) {
                            viewModel.onDueDateSelected(Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate())
                        }
                        showDatePicker = false
                    },
                ) { Text(stringResource(R.string.common_ok), color = Accent) }
            },
            dismissButton = {
                TextButton(onClick = { showDatePicker = false }) { Text(stringResource(R.string.common_cancel), color = OnSurfaceSecondary) }
            },
        ) {
            DatePicker(state = datePickerState)
        }
    }

    if (showTimePicker) {
        SimpleTimePickerDialog(
            initial = uiState.dueTime ?: LocalTime.of(18, 0),
            onDismiss = { showTimePicker = false },
            onClearTime = {
                viewModel.onDueTimeSelected(null)
                showTimePicker = false
            },
            onConfirm = { time ->
                viewModel.onDueTimeSelected(time)
                showTimePicker = false
            },
        )
    }

    if (showDeleteConfirm) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            containerColor = SurfaceColor,
            title = { Text(stringResource(R.string.edit_task_delete_confirm_title)) },
            text = { Text(stringResource(R.string.edit_task_delete_confirm_message), color = OnSurfaceSecondary) },
            confirmButton = {
                TextButton(
                    onClick = {
                        showDeleteConfirm = false
                        viewModel.onRequestDelete()
                    },
                ) { Text(stringResource(R.string.edit_task_delete_confirm_action), color = PriorityHigh) }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirm = false }) { Text(stringResource(R.string.common_cancel), color = OnSurfaceSecondary) }
            },
        )
    }

    if (showSkipConfirm) {
        AlertDialog(
            onDismissRequest = { showSkipConfirm = false },
            containerColor = SurfaceColor,
            title = { Text(stringResource(R.string.edit_task_skip_confirm_title)) },
            text = { Text(stringResource(R.string.edit_task_skip_confirm_message), color = OnSurfaceSecondary) },
            confirmButton = {
                TextButton(
                    onClick = {
                        showSkipConfirm = false
                        viewModel.onSkipOccurrence()
                    },
                ) { Text(stringResource(R.string.edit_task_skip_confirm_action), color = Accent) }
            },
            dismissButton = {
                TextButton(onClick = { showSkipConfirm = false }) { Text(stringResource(R.string.common_cancel), color = OnSurfaceSecondary) }
            },
        )
    }
}

private fun shareTask(context: Context, uiState: EditTaskUiState) {
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, buildShareText(uiState))
    }
    context.startActivity(Intent.createChooser(intent, null))
}

private fun buildShareText(uiState: EditTaskUiState): String {
    val builder = StringBuilder(uiState.title)
    if (uiState.dueDate != null) {
        builder.append('\n').append(uiState.dueDate.format(DateTimeFormatter.ofPattern("dd/MM/yyyy")))
        if (uiState.dueTime != null) {
            builder.append(' ').append(uiState.dueTime.format(DateTimeFormatter.ofPattern("HH:mm")))
        }
    }
    if (uiState.description.isNotBlank()) {
        builder.append("\n\n").append(uiState.description)
    }
    if (uiState.subtasks.isNotEmpty()) {
        builder.append("\n\n")
        uiState.subtasks.forEach { subtask ->
            builder.append(if (subtask.isCompleted) "☑ " else "☐ ").append(subtask.title).append('\n')
        }
    }
    return builder.toString().trim()
}

@Composable
private fun fieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = Accent,
    unfocusedBorderColor = Outline,
    cursorColor = Accent,
    focusedLabelColor = Accent,
    unfocusedLabelColor = OnSurfaceSecondary,
)

private val locationRadiusOptions = listOf(100f, 300f, 500f, 1000f)

@Composable
private fun LocationReminderSection(
    uiState: EditTaskUiState,
    onQueryChanged: (String) -> Unit,
    onSearch: () -> Unit,
    onRadiusSelected: (Float) -> Unit,
    onRemove: () -> Unit,
) {
    val context = LocalContext.current
    var hasFineLocationPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED,
        )
    }
    val foregroundPermissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { results ->
        hasFineLocationPermission = results[Manifest.permission.ACCESS_FINE_LOCATION] == true
    }
    var hasBackgroundLocationPermission by remember {
        mutableStateOf(
            Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
                ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED,
        )
    }
    val backgroundPermissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        hasBackgroundLocationPermission = granted
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.edit_task_location_label), style = MaterialTheme.typography.titleSmall)

        when {
            uiState.hasLocation -> {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Place, contentDescription = null, tint = Accent, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(
                        text = uiState.locationLabel.orEmpty(),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onBackground,
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(onClick = onRemove) {
                        Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.edit_task_location_remove), tint = OnSurfaceSecondary)
                    }
                }
                Text(
                    text = stringResource(R.string.edit_task_location_radius_label),
                    style = MaterialTheme.typography.labelMedium,
                    color = OnSurfaceSecondary,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    locationRadiusOptions.forEach { radius ->
                        val label = if (radius >= 1000f) "${(radius / 1000).toInt()} km" else "${radius.toInt()} m"
                        ActionChip(label = label, onClick = { onRadiusSelected(radius) }, isSelected = uiState.locationRadiusMeters == radius)
                    }
                }
                if (!hasBackgroundLocationPermission) {
                    Text(
                        text = stringResource(R.string.edit_task_location_background_hint),
                        style = MaterialTheme.typography.bodySmall,
                        color = OnSurfaceSecondary,
                    )
                    TextButton(onClick = { backgroundPermissionLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION) }) {
                        Text(stringResource(R.string.edit_task_location_background_action), color = Accent)
                    }
                }
            }
            !hasFineLocationPermission -> {
                OutlinedButton(
                    onClick = {
                        foregroundPermissionLauncher.launch(
                            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
                        )
                    },
                ) {
                    Icon(Icons.Filled.Place, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(stringResource(R.string.edit_task_location_add))
                }
            }
            else -> {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = uiState.locationSearchQuery,
                        onValueChange = onQueryChanged,
                        placeholder = { Text(stringResource(R.string.edit_task_location_search_placeholder), color = OnSurfaceSecondary) },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                        colors = fieldColors(),
                    )
                    Spacer(Modifier.width(8.dp))
                    if (uiState.isSearchingLocation) {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp), color = Accent, strokeWidth = 2.dp)
                    } else {
                        IconButton(onClick = onSearch) {
                            Icon(Icons.Filled.Search, contentDescription = stringResource(R.string.edit_task_location_search_action), tint = Accent)
                        }
                    }
                }
                if (uiState.locationSearchError) {
                    Text(
                        text = stringResource(R.string.edit_task_location_search_error),
                        style = MaterialTheme.typography.bodySmall,
                        color = PriorityHigh,
                    )
                }
            }
        }
    }
}

@Composable
private fun CommentsSection(
    comments: List<TaskComment>,
    newCommentText: String,
    isSending: Boolean,
    onTextChanged: (String) -> Unit,
    onSend: () -> Unit,
    onDelete: (TaskComment) -> Unit,
    loginRequired: Boolean,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.task_comments_title), style = MaterialTheme.typography.titleSmall)
        if (loginRequired) {
            Text(
                text = stringResource(R.string.task_comments_login_required),
                style = MaterialTheme.typography.bodySmall,
                color = OnSurfaceSecondary,
            )
            return
        }
        if (comments.isEmpty()) {
            Text(
                text = stringResource(R.string.task_comments_empty),
                style = MaterialTheme.typography.bodySmall,
                color = OnSurfaceSecondary,
            )
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                comments.forEach { comment -> CommentRow(comment = comment, onDelete = { onDelete(comment) }) }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = newCommentText,
                onValueChange = onTextChanged,
                placeholder = { Text(stringResource(R.string.task_comments_hint), color = OnSurfaceSecondary) },
                modifier = Modifier.weight(1f),
                colors = fieldColors(),
            )
            IconButton(onClick = onSend, enabled = newCommentText.isNotBlank() && !isSending) {
                Icon(
                    imageVector = Icons.Filled.Send,
                    contentDescription = stringResource(R.string.task_comments_send),
                    tint = if (newCommentText.isNotBlank() && !isSending) Accent else OnSurfaceSecondary,
                )
            }
        }
    }
}

@Composable
private fun CommentRow(comment: TaskComment, onDelete: () -> Unit) {
    Surface(color = SurfaceVariant, shape = RoundedCornerShape(10.dp), modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = comment.text,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.weight(1f),
            )
            IconButton(onClick = onDelete, modifier = Modifier.size(28.dp)) {
                Icon(
                    imageVector = Icons.Filled.Close,
                    contentDescription = stringResource(R.string.task_comments_delete),
                    tint = OnSurfaceSecondary,
                    modifier = Modifier.size(16.dp),
                )
            }
        }
    }
}

@Composable
private fun ActionChip(label: String, onClick: () -> Unit, isSelected: Boolean = false) {
    val shape = RoundedCornerShape(10.dp)
    Text(
        text = label,
        style = MaterialTheme.typography.labelLarge,
        color = if (isSelected) Accent else MaterialTheme.colorScheme.onBackground,
        modifier = Modifier
            .clip(shape)
            .background(if (isSelected) Accent.copy(alpha = 0.18f) else SurfaceVariant)
            .border(BorderStroke(1.dp, if (isSelected) Accent else Outline), shape)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 10.dp),
    )
}

@Composable
private fun EditableSubtaskRow(
    draft: SubtaskDraft,
    onToggle: (Boolean) -> Unit,
    onTitleChange: (String) -> Unit,
    onRemove: () -> Unit,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Checkbox(
            checked = draft.isCompleted,
            onCheckedChange = onToggle,
            colors = CheckboxDefaults.colors(
                checkedColor = Accent,
                uncheckedColor = OnSurfaceSecondary,
                checkmarkColor = MaterialTheme.colorScheme.background,
            ),
        )
        OutlinedTextField(
            value = draft.title,
            onValueChange = onTitleChange,
            singleLine = true,
            modifier = Modifier.weight(1f),
            colors = fieldColors(),
        )
        IconButton(onClick = onRemove) {
            Icon(
                imageVector = Icons.Filled.Close,
                contentDescription = stringResource(R.string.edit_task_remove_subtask_action),
                tint = OnSurfaceSecondary,
            )
        }
    }
}

@Composable
private fun SimpleTimePickerDialog(
    initial: LocalTime,
    onDismiss: () -> Unit,
    onClearTime: () -> Unit,
    onConfirm: (LocalTime) -> Unit,
) {
    var hourText by remember { mutableStateOf(initial.hour.toString()) }
    var minuteText by remember { mutableStateOf(initial.minute.toString().padStart(2, '0')) }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = SurfaceColor,
        title = { Text(stringResource(R.string.edit_task_time_picker_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(
                        value = hourText,
                        onValueChange = { value -> if (value.length <= 2 && value.all(Char::isDigit)) hourText = value },
                        label = { Text(stringResource(R.string.edit_task_time_hour_label)) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.weight(1f),
                        colors = fieldColors(),
                    )
                    OutlinedTextField(
                        value = minuteText,
                        onValueChange = { value -> if (value.length <= 2 && value.all(Char::isDigit)) minuteText = value },
                        label = { Text(stringResource(R.string.edit_task_time_minute_label)) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.weight(1f),
                        colors = fieldColors(),
                    )
                }
                TextButton(onClick = onClearTime) {
                    Text(stringResource(R.string.edit_task_time_clear), color = OnSurfaceSecondary)
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    val hour = hourText.toIntOrNull()?.coerceIn(0, 23) ?: initial.hour
                    val minute = minuteText.toIntOrNull()?.coerceIn(0, 59) ?: initial.minute
                    onConfirm(LocalTime.of(hour, minute))
                },
            ) { Text(stringResource(R.string.common_ok), color = Accent) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_cancel), color = OnSurfaceSecondary) }
        },
    )
}
