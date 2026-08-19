package com.organizador.app.ui.newtask

import android.content.ActivityNotFoundException
import android.content.Intent
import android.speech.RecognizerIntent
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.SubdirectoryArrowRight
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.organizador.app.R
import com.organizador.app.domain.nlp.ParsedTask
import com.organizador.app.ui.common.rememberViewModelFactory
import com.organizador.app.ui.components.PrioritySelector
import com.organizador.app.ui.components.RecurrenceSelector
import com.organizador.app.ui.theme.Accent
import com.organizador.app.ui.theme.Background
import com.organizador.app.ui.theme.OnSurfaceSecondary
import com.organizador.app.ui.theme.Outline
import com.organizador.app.ui.theme.PriorityHigh
import com.organizador.app.ui.theme.SurfaceVariant
import java.util.Locale

@Composable
fun NewTaskScreen(
    onBack: () -> Unit,
    onSaved: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: NewTaskViewModel = viewModel(factory = rememberViewModelFactory()),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current

    val voiceInputLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val spokenText = result.data
            ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
            ?.firstOrNull()
        if (!spokenText.isNullOrBlank()) {
            val combined = if (uiState.rawInput.isBlank()) {
                spokenText
            } else {
                uiState.rawInput.trimEnd() + "\n" + spokenText
            }
            viewModel.onRawInputChanged(combined)
        }
    }

    fun launchVoiceInput() {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale("pt", "BR").toString())
            putExtra(RecognizerIntent.EXTRA_PROMPT, context.getString(R.string.new_task_voice_prompt))
        }
        try {
            voiceInputLauncher.launch(intent)
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(context, R.string.new_task_voice_unavailable, Toast.LENGTH_SHORT).show()
        }
    }

    LaunchedEffect(uiState.savedSuccessfully) {
        if (uiState.savedSuccessfully) {
            viewModel.onSavedHandled()
            onSaved()
        }
    }

    Scaffold(
        modifier = modifier,
        containerColor = Background,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.new_task_title), style = MaterialTheme.typography.titleMedium) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Background),
            )
        },
        bottomBar = {
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
                    val label = if (uiState.taskCount > 1) {
                        stringResource(R.string.new_task_save_multiple, uiState.taskCount)
                    } else {
                        stringResource(R.string.new_task_save)
                    }
                    Text(label, style = MaterialTheme.typography.titleSmall)
                }
            }
        },
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            OutlinedTextField(
                value = uiState.rawInput,
                onValueChange = viewModel::onRawInputChanged,
                label = { Text(stringResource(R.string.new_task_input_label)) },
                placeholder = { Text(stringResource(R.string.new_task_input_placeholder), color = OnSurfaceSecondary) },
                modifier = Modifier.fillMaxWidth().heightIn(min = 96.dp),
                minLines = 3,
                trailingIcon = {
                    IconButton(onClick = { launchVoiceInput() }) {
                        Icon(
                            imageVector = Icons.Filled.Mic,
                            contentDescription = stringResource(R.string.new_task_voice_input),
                            tint = Accent,
                        )
                    }
                },
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Accent,
                    unfocusedBorderColor = Outline,
                    cursorColor = Accent,
                    focusedLabelColor = Accent,
                    unfocusedLabelColor = OnSurfaceSecondary,
                ),
            )

            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = viewModel::onInterpretWithAi,
                        enabled = uiState.canInterpretWithAi,
                        border = BorderStroke(1.dp, if (uiState.canInterpretWithAi) Accent else Outline),
                        colors = ButtonDefaults.outlinedButtonColors(
                            contentColor = Accent,
                            disabledContentColor = OnSurfaceSecondary,
                        ),
                    ) {
                        Icon(Icons.Filled.AutoAwesome, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(stringResource(R.string.new_task_interpret_ai))
                    }
                    if (uiState.isInterpretingWithAi) {
                        CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = Accent)
                    }
                }
                uiState.aiError?.let { error ->
                    Text(text = error, color = PriorityHigh, style = MaterialTheme.typography.bodySmall)
                }
            }

            if (uiState.parsedItems.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = if (uiState.parsedItems.size > 1) {
                                stringResource(R.string.new_task_understood_multiple, uiState.parsedItems.size)
                            } else {
                                stringResource(R.string.new_task_understood)
                            },
                            style = MaterialTheme.typography.labelMedium,
                            color = OnSurfaceSecondary,
                        )
                        val isAi = uiState.interpretationSource == InterpretationSource.AI
                        Text(
                            text = if (isAi) stringResource(R.string.new_task_source_ai) else stringResource(R.string.new_task_source_local),
                            style = MaterialTheme.typography.labelSmall,
                            color = if (isAi) Accent else OnSurfaceSecondary,
                        )
                    }
                    uiState.parsedItems.forEachIndexed { index, item ->
                        ParsedTaskPreviewCard(
                            item = item,
                            showRemove = uiState.parsedItems.size > 1,
                            onRemove = { viewModel.onRemoveParsedItem(index) },
                        )
                    }
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.new_task_priority_label), style = MaterialTheme.typography.titleSmall)
                PrioritySelector(selected = uiState.priority, onSelect = viewModel::onPrioritySelected)
            }

            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.new_task_recurrence_label), style = MaterialTheme.typography.titleSmall)
                RecurrenceSelector(selected = uiState.recurrence, onSelect = viewModel::onRecurrenceSelected)
            }
        }
    }
}

@Composable
private fun ParsedTaskPreviewCard(item: ParsedTask, showRemove: Boolean, onRemove: () -> Unit) {
    Surface(
        color = SurfaceVariant,
        shape = MaterialTheme.shapes.medium,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top,
            ) {
                Text(
                    text = item.cleanTitle.ifBlank { "(sem título)" },
                    style = MaterialTheme.typography.titleSmall,
                    modifier = Modifier.weight(1f),
                )
                if (showRemove) {
                    IconButton(onClick = onRemove, modifier = Modifier.size(24.dp)) {
                        Icon(
                            imageVector = Icons.Filled.Close,
                            contentDescription = stringResource(R.string.new_task_remove_item),
                            tint = OnSurfaceSecondary,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }
            }
            item.hints.forEach { hint -> HintRow(hint) }
            item.subtasks.forEach { subtask -> SubtaskRow(subtask) }
        }
    }
}

@Composable
private fun SubtaskRow(text: String) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 8.dp)) {
        Icon(
            imageVector = Icons.Outlined.SubdirectoryArrowRight,
            contentDescription = null,
            tint = OnSurfaceSecondary,
            modifier = Modifier.size(14.dp),
        )
        Spacer(Modifier.width(8.dp))
        Text(text = text, style = MaterialTheme.typography.bodySmall, color = OnSurfaceSecondary)
    }
}

@Composable
private fun HintRow(text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(
            imageVector = Icons.Outlined.CheckCircle,
            contentDescription = null,
            tint = Accent,
            modifier = Modifier.size(16.dp),
        )
        Spacer(Modifier.width(8.dp))
        Text(text = text, style = MaterialTheme.typography.bodyMedium)
    }
}
