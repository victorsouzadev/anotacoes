package com.organizador.app.ui.trash

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material.icons.filled.Restore
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.organizador.app.R
import com.organizador.app.data.local.entity.Task
import com.organizador.app.domain.common.toLocalDateTime
import com.organizador.app.domain.model.TaskWithCategory
import com.organizador.app.ui.common.rememberViewModelFactory
import com.organizador.app.ui.theme.Accent
import com.organizador.app.ui.theme.Background
import com.organizador.app.ui.theme.OnSurfaceSecondary
import com.organizador.app.ui.theme.PriorityHigh
import com.organizador.app.ui.theme.Surface as SurfaceColor
import java.time.format.DateTimeFormatter
import java.util.Locale

@Composable
fun TrashScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: TrashViewModel = viewModel(factory = rememberViewModelFactory()),
) {
    val trashedTasks by viewModel.trashedTasks.collectAsStateWithLifecycle()

    Scaffold(
        modifier = modifier,
        containerColor = Background,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.trash_title), style = MaterialTheme.typography.titleMedium) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Background),
            )
        },
    ) { paddingValues ->
        if (trashedTasks.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize().padding(paddingValues),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = stringResource(R.string.trash_empty),
                    color = OnSurfaceSecondary,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(
                    horizontal = 16.dp,
                    vertical = paddingValues.calculateTopPadding() + 8.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(trashedTasks, key = { it.task.id }) { item ->
                    TrashRow(
                        item = item,
                        onRestore = { viewModel.onRestore(item.task) },
                        onDeletePermanently = { viewModel.onDeletePermanently(item.task) },
                    )
                }
            }
        }
    }
}

@Composable
private fun TrashRow(item: TaskWithCategory, onRestore: () -> Unit, onDeletePermanently: () -> Unit) {
    var showConfirm by remember { mutableStateOf(false) }
    val task: Task = item.task

    Surface(color = SurfaceColor, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(start = 16.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(text = task.title, style = MaterialTheme.typography.bodyLarge)
                val deletedAt = task.deletedAt
                if (deletedAt != null) {
                    Text(
                        text = stringResource(
                            R.string.trash_deleted_on,
                            deletedAt.toLocalDateTime().format(DateTimeFormatter.ofPattern("dd/MM/yyyy", Locale("pt", "BR"))),
                        ),
                        style = MaterialTheme.typography.bodySmall,
                        color = OnSurfaceSecondary,
                    )
                }
            }
            IconButton(onClick = onRestore) {
                Icon(Icons.Filled.Restore, contentDescription = stringResource(R.string.trash_restore), tint = Accent)
            }
            IconButton(onClick = { showConfirm = true }) {
                Icon(Icons.Filled.DeleteForever, contentDescription = stringResource(R.string.trash_delete_forever), tint = PriorityHigh)
            }
        }
    }

    if (showConfirm) {
        AlertDialog(
            onDismissRequest = { showConfirm = false },
            containerColor = SurfaceColor,
            title = { Text(stringResource(R.string.trash_delete_forever_confirm_title)) },
            text = { Text(stringResource(R.string.trash_delete_forever_confirm_message), color = OnSurfaceSecondary) },
            confirmButton = {
                TextButton(
                    onClick = {
                        showConfirm = false
                        onDeletePermanently()
                    },
                ) { Text(stringResource(R.string.trash_delete_forever), color = PriorityHigh) }
            },
            dismissButton = {
                TextButton(onClick = { showConfirm = false }) { Text(stringResource(R.string.common_cancel), color = OnSurfaceSecondary) }
            },
        )
    }
}
