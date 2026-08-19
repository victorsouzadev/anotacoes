package com.organizador.app.ui.categories

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.organizador.app.R
import com.organizador.app.data.local.entity.Category
import com.organizador.app.ui.common.parseColorHexOrDefault
import com.organizador.app.ui.common.rememberViewModelFactory
import com.organizador.app.ui.navigation.BottomNavBar
import com.organizador.app.ui.navigation.BottomNavItem
import com.organizador.app.ui.theme.Accent
import com.organizador.app.ui.theme.Background
import com.organizador.app.ui.theme.OnSurfaceSecondary
import com.organizador.app.ui.theme.Outline
import com.organizador.app.ui.theme.Surface as SurfaceColor

private val categoryColorSwatches = listOf(
    "#3ED9C3", "#FF6161", "#F2B84B", "#6E7BFF", "#8A93A3", "#FF8FB1", "#7ED957", "#B389F9",
)

@Composable
fun CategoriesScreen(
    onNavigate: (BottomNavItem) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: CategoriesViewModel = viewModel(factory = rememberViewModelFactory()),
) {
    val categories by viewModel.categories.collectAsStateWithLifecycle()
    var editingCategory by remember { mutableStateOf<Category?>(null) }
    var isDialogOpen by remember { mutableStateOf(false) }

    Scaffold(
        modifier = modifier,
        containerColor = Background,
        topBar = {
            CenterAlignedTopAppBar(
                title = { Text(stringResource(R.string.categories_title), style = MaterialTheme.typography.titleLarge) },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = Background),
            )
        },
        bottomBar = { BottomNavBar(currentItem = BottomNavItem.CATEGORIES, onNavigate = onNavigate) },
        floatingActionButton = {
            FloatingActionButton(
                onClick = {
                    editingCategory = null
                    isDialogOpen = true
                },
            ) {
                Icon(Icons.Filled.Add, contentDescription = stringResource(R.string.categories_add))
            }
        },
    ) { paddingValues ->
        if (categories.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize().padding(paddingValues),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = stringResource(R.string.categories_empty),
                    color = OnSurfaceSecondary,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(
                    horizontal = 16.dp,
                    vertical = paddingValues.calculateTopPadding() + 4.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(categories, key = { it.id }) { category ->
                    CategoryRow(
                        category = category,
                        onClick = {
                            editingCategory = category
                            isDialogOpen = true
                        },
                        onDelete = { viewModel.onDeleteCategory(category) },
                    )
                }
            }
        }
    }

    if (isDialogOpen) {
        CategoryEditDialog(
            initial = editingCategory,
            onDismiss = { isDialogOpen = false },
            onConfirm = { name, colorHex ->
                viewModel.onSaveCategory(editingCategory?.id, name, colorHex)
                isDialogOpen = false
            },
        )
    }
}

@Composable
private fun CategoryRow(category: Category, onClick: () -> Unit, onDelete: () -> Unit) {
    Surface(
        color = SurfaceColor,
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
    ) {
        Row(
            modifier = Modifier.padding(start = 16.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(12.dp)
                    .clip(CircleShape)
                    .background(parseColorHexOrDefault(category.colorHex)),
            )
            Text(
                text = category.name,
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.weight(1f).padding(start = 12.dp),
            )
            IconButton(onClick = onDelete) {
                Icon(
                    imageVector = Icons.Filled.Delete,
                    contentDescription = stringResource(R.string.categories_delete),
                    tint = OnSurfaceSecondary,
                )
            }
        }
    }
}

@Composable
private fun CategoryEditDialog(
    initial: Category?,
    onDismiss: () -> Unit,
    onConfirm: (name: String, colorHex: String) -> Unit,
) {
    var name by remember(initial) { mutableStateOf(initial?.name.orEmpty()) }
    var colorHex by remember(initial) { mutableStateOf(initial?.colorHex ?: categoryColorSwatches.first()) }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = SurfaceColor,
        title = {
            Text(
                text = if (initial == null) {
                    stringResource(R.string.categories_dialog_title_new)
                } else {
                    stringResource(R.string.categories_dialog_title_edit)
                },
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text(stringResource(R.string.categories_name_label)) },
                    placeholder = { Text(stringResource(R.string.categories_name_placeholder), color = OnSurfaceSecondary) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Accent,
                        unfocusedBorderColor = Outline,
                        cursorColor = Accent,
                        focusedLabelColor = Accent,
                        unfocusedLabelColor = OnSurfaceSecondary,
                    ),
                )
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = stringResource(R.string.categories_color_label),
                        style = MaterialTheme.typography.labelMedium,
                        color = OnSurfaceSecondary,
                    )
                    ColorSwatchRow(selected = colorHex, onSelect = { colorHex = it })
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(name, colorHex) },
                enabled = name.isNotBlank(),
            ) {
                Text(stringResource(R.string.categories_save), color = Accent)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.categories_cancel), color = OnSurfaceSecondary)
            }
        },
    )
}

@Composable
private fun ColorSwatchRow(selected: String, onSelect: (String) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        categoryColorSwatches.forEach { hex ->
            val color = parseColorHexOrDefault(hex)
            val isSelected = hex.equals(selected, ignoreCase = true)
            Box(
                modifier = Modifier
                    .size(32.dp)
                    .clip(CircleShape)
                    .background(color)
                    .border(
                        width = if (isSelected) 2.dp else 0.dp,
                        color = if (isSelected) MaterialTheme.colorScheme.onBackground else Color.Transparent,
                        shape = CircleShape,
                    )
                    .clickable { onSelect(hex) },
                contentAlignment = Alignment.Center,
            ) {
                if (isSelected) {
                    Icon(
                        imageVector = Icons.Filled.Check,
                        contentDescription = null,
                        tint = Background,
                        modifier = Modifier.size(16.dp),
                    )
                }
            }
        }
    }
}
