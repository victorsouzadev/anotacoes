package com.organizador.app.ui.settings

import android.Manifest
import android.app.AlarmManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.organizador.app.R
import com.organizador.app.data.calendar.CalendarProvider
import com.organizador.app.data.local.SettingsStore
import com.organizador.app.domain.model.AccentTheme
import com.organizador.app.domain.model.ThemeMode
import com.organizador.app.ui.common.parseColorHexOrDefault
import com.organizador.app.ui.common.rememberViewModelFactory
import com.organizador.app.ui.components.CollapsibleSection
import com.organizador.app.ui.navigation.BottomNavBar
import com.organizador.app.ui.navigation.BottomNavItem
import com.organizador.app.ui.theme.Accent
import com.organizador.app.ui.theme.Background
import com.organizador.app.ui.theme.OnBackground
import com.organizador.app.ui.theme.Outline
import com.organizador.app.ui.theme.OnSurfaceSecondary
import com.organizador.app.domain.common.toLocalDateTime
import com.organizador.app.ui.theme.PriorityHigh
import com.organizador.app.ui.theme.SurfaceVariant
import java.time.format.DateTimeFormatter

private val suggestedModels = listOf(
    SettingsStore.DEFAULT_MODEL,
    "openai/gpt-4o-mini",
    "google/gemini-3.6-flash",
    "google/gemma-4-31b-it:free",
)

@Composable
fun SettingsScreen(
    onNavigate: (BottomNavItem) -> Unit,
    onOpenTrash: () -> Unit,
    onOpenStatistics: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: SettingsViewModel = viewModel(factory = rememberViewModelFactory()),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val themeMode by viewModel.themeMode.collectAsStateWithLifecycle()
    val accentTheme by viewModel.accentTheme.collectAsStateWithLifecycle()
    val useDynamicColor by viewModel.useDynamicColor.collectAsStateWithLifecycle()
    val calendarSyncEnabled by viewModel.calendarSyncEnabled.collectAsStateWithLifecycle()
    val selectedCalendarId by viewModel.selectedCalendarId.collectAsStateWithLifecycle()
    val visibleCalendarIds by viewModel.visibleCalendarIds.collectAsStateWithLifecycle()
    val isLoggedIn by viewModel.isLoggedIn.collectAsStateWithLifecycle()
    val accountEmail by viewModel.accountEmail.collectAsStateWithLifecycle()
    val lastSyncedAt by viewModel.lastSyncedAt.collectAsStateWithLifecycle()
    var isApiKeyVisible by remember { mutableStateOf(false) }

    Scaffold(
        modifier = modifier,
        containerColor = Background,
        topBar = {
            CenterAlignedTopAppBar(
                title = { Text(stringResource(R.string.settings_title), style = MaterialTheme.typography.titleLarge) },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = Background),
            )
        },
        bottomBar = { BottomNavBar(currentItem = BottomNavItem.SETTINGS, onNavigate = onNavigate) },
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            CollapsibleSection(
                title = stringResource(R.string.settings_theme_section_title),
                initiallyExpanded = true,
            ) {
                ThemeSection(
                    themeMode = themeMode,
                    accentTheme = accentTheme,
                    useDynamicColor = useDynamicColor,
                    onThemeModeSelected = viewModel::onThemeModeSelected,
                    onAccentThemeSelected = viewModel::onAccentThemeSelected,
                    onUseDynamicColorToggled = viewModel::onUseDynamicColorToggled,
                )
            }

            CollapsibleSection(title = stringResource(R.string.settings_reminders_section_title)) {
                ReminderStatusSection()
            }

            CollapsibleSection(title = stringResource(R.string.settings_calendar_section_title)) {
                CalendarSection(
                    syncEnabled = calendarSyncEnabled,
                    selectedCalendarId = selectedCalendarId,
                    visibleCalendarIds = visibleCalendarIds,
                    onToggle = viewModel::onCalendarSyncToggled,
                    onSelectCalendar = viewModel::onCalendarSelected,
                    onVisibleCalendarsChanged = viewModel::onVisibleCalendarsChanged,
                    onShowAllCalendars = viewModel::onShowAllCalendars,
                )
            }

            CollapsibleSection(
                title = stringResource(R.string.settings_ai_section_title),
                subtitle = if (uiState.hasApiKey) {
                    stringResource(R.string.settings_api_key_saved)
                } else {
                    stringResource(R.string.settings_api_key_not_set)
                },
            ) {
                AiSection(uiState = uiState, isApiKeyVisible = isApiKeyVisible, onToggleApiKeyVisible = { isApiKeyVisible = !isApiKeyVisible }, viewModel = viewModel)
            }

            CollapsibleSection(title = stringResource(R.string.settings_backup_section_title)) {
                BackupSection(uiState = uiState, onExportTo = viewModel::onExportTo, onImportFrom = viewModel::onImportFrom)
            }

            CollapsibleSection(title = stringResource(R.string.settings_sync_section_title)) {
                SyncSection(
                    uiState = uiState,
                    isLoggedIn = isLoggedIn,
                    accountEmail = accountEmail,
                    lastSyncedAt = lastSyncedAt,
                    viewModel = viewModel,
                )
            }

            CollapsibleSection(title = stringResource(R.string.settings_statistics_section_title)) {
                Text(
                    text = stringResource(R.string.settings_statistics_section_description),
                    style = MaterialTheme.typography.bodySmall,
                    color = OnSurfaceSecondary,
                )
                OutlinedButton(onClick = onOpenStatistics) {
                    Text(stringResource(R.string.settings_statistics_open))
                }
            }

            CollapsibleSection(title = stringResource(R.string.settings_trash_section_title)) {
                Text(
                    text = stringResource(R.string.settings_trash_section_description),
                    style = MaterialTheme.typography.bodySmall,
                    color = OnSurfaceSecondary,
                )
                OutlinedButton(onClick = onOpenTrash) {
                    Text(stringResource(R.string.settings_trash_open))
                }
            }
        }
    }
}

@Composable
private fun ThemeSection(
    themeMode: ThemeMode,
    accentTheme: AccentTheme,
    useDynamicColor: Boolean,
    onThemeModeSelected: (ThemeMode) -> Unit,
    onAccentThemeSelected: (AccentTheme) -> Unit,
    onUseDynamicColorToggled: (Boolean) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            text = stringResource(R.string.settings_theme_mode_label),
            style = MaterialTheme.typography.labelMedium,
            color = OnSurfaceSecondary,
        )
        val modeOptions = listOf(
            ThemeMode.SYSTEM to stringResource(R.string.settings_theme_mode_system),
            ThemeMode.LIGHT to stringResource(R.string.settings_theme_mode_light),
            ThemeMode.DARK to stringResource(R.string.settings_theme_mode_dark),
        )
        val shape = RoundedCornerShape(50)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            modeOptions.forEach { (mode, label) ->
                val isSelected = mode == themeMode
                Text(
                    text = label,
                    color = if (isSelected) Accent else OnSurfaceSecondary,
                    style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier
                        .clip(shape)
                        .background(if (isSelected) Accent.copy(alpha = 0.18f) else SurfaceVariant)
                        .border(BorderStroke(1.dp, if (isSelected) Accent else Outline), shape)
                        .clickable { onThemeModeSelected(mode) }
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                )
            }
        }
    }

    Column(
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.graphicsLayer(alpha = if (useDynamicColor) 0.4f else 1f),
    ) {
        Text(
            text = stringResource(R.string.settings_theme_accent_label),
            style = MaterialTheme.typography.labelMedium,
            color = OnSurfaceSecondary,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            AccentTheme.entries.forEach { accent ->
                val color = parseColorHexOrDefault(accent.colorHex)
                val isSelected = accent == accentTheme
                Box(
                    modifier = Modifier
                        .size(32.dp)
                        .clip(CircleShape)
                        .background(color)
                        .border(
                            width = if (isSelected) 2.dp else 0.dp,
                            color = if (isSelected) OnBackground else Color.Transparent,
                            shape = CircleShape,
                        )
                        .clickable(enabled = !useDynamicColor) { onAccentThemeSelected(accent) },
                    contentAlignment = Alignment.Center,
                ) {
                    if (isSelected) {
                        Icon(
                            imageVector = Icons.Filled.Check,
                            contentDescription = accent.name,
                            tint = Background,
                            modifier = Modifier.size(16.dp),
                        )
                    }
                }
            }
        }
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(stringResource(R.string.settings_theme_dynamic_color_toggle), style = MaterialTheme.typography.bodyMedium)
            Switch(
                checked = useDynamicColor,
                onCheckedChange = onUseDynamicColorToggled,
                colors = SwitchDefaults.colors(checkedThumbColor = Accent, checkedTrackColor = Accent.copy(alpha = 0.5f)),
            )
        }
    }
}

@Composable
private fun AiSection(
    uiState: SettingsUiState,
    isApiKeyVisible: Boolean,
    onToggleApiKeyVisible: () -> Unit,
    viewModel: SettingsViewModel,
) {
    Text(
        text = stringResource(R.string.settings_ai_section_description),
        style = MaterialTheme.typography.bodySmall,
        color = OnSurfaceSecondary,
    )

    OutlinedTextField(
        value = uiState.apiKeyInput,
        onValueChange = viewModel::onApiKeyInputChanged,
        label = { Text(stringResource(R.string.settings_api_key_label)) },
        placeholder = { Text(stringResource(R.string.settings_api_key_placeholder), color = OnSurfaceSecondary) },
        singleLine = true,
        visualTransformation = if (isApiKeyVisible) VisualTransformation.None else PasswordVisualTransformation(),
        trailingIcon = {
            IconButton(onClick = onToggleApiKeyVisible) {
                Icon(
                    imageVector = if (isApiKeyVisible) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                    contentDescription = null,
                )
            }
        },
        modifier = Modifier.fillMaxWidth(),
        colors = fieldColors(),
    )

    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Button(
            onClick = viewModel::onSaveApiKey,
            enabled = uiState.apiKeyInput.isNotBlank(),
            colors = ButtonDefaults.buttonColors(
                containerColor = Accent,
                contentColor = Background,
                disabledContainerColor = SurfaceVariant,
                disabledContentColor = OnSurfaceSecondary,
            ),
        ) {
            Text(stringResource(R.string.settings_api_key_save))
        }
        if (uiState.hasApiKey) {
            OutlinedButton(onClick = viewModel::onClearApiKey) {
                Text(stringResource(R.string.settings_api_key_clear))
            }
        }
    }

    Text(
        text = stringResource(R.string.settings_model_label),
        style = MaterialTheme.typography.titleSmall,
    )
    Text(
        text = stringResource(R.string.settings_model_hint),
        style = MaterialTheme.typography.bodySmall,
        color = OnSurfaceSecondary,
    )

    OutlinedTextField(
        value = uiState.modelInput,
        onValueChange = viewModel::onModelInputChanged,
        label = { Text(stringResource(R.string.settings_model_label)) },
        placeholder = { Text(stringResource(R.string.settings_model_placeholder), color = OnSurfaceSecondary) },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
        colors = fieldColors(),
    )

    LazyRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        contentPadding = PaddingValues(vertical = 2.dp),
    ) {
        items(suggestedModels) { model ->
            ModelSuggestionChip(
                label = model,
                selected = model == uiState.modelInput,
                onClick = { viewModel.onPickSuggestedModel(model) },
            )
        }
    }

    Button(
        onClick = viewModel::onSaveModel,
        colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = Background),
    ) {
        Text(stringResource(R.string.settings_model_save))
    }
}

@Composable
private fun SyncSection(
    uiState: SettingsUiState,
    isLoggedIn: Boolean,
    accountEmail: String?,
    lastSyncedAt: Long?,
    viewModel: SettingsViewModel,
) {
    Text(
        text = stringResource(R.string.settings_sync_section_description),
        style = MaterialTheme.typography.bodySmall,
        color = OnSurfaceSecondary,
    )

    if (isLoggedIn) {
        Text(
            text = stringResource(R.string.settings_sync_logged_in_as, accountEmail.orEmpty()),
            style = MaterialTheme.typography.bodyMedium,
        )
        Text(
            text = lastSyncedAt?.let { stringResource(R.string.settings_sync_last_synced, formatSyncTimestamp(it)) }
                ?: stringResource(R.string.settings_sync_never_synced),
            style = MaterialTheme.typography.bodySmall,
            color = OnSurfaceSecondary,
        )

        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(
                onClick = viewModel::onSyncNow,
                enabled = !uiState.isSyncing,
                colors = ButtonDefaults.buttonColors(
                    containerColor = Accent,
                    contentColor = Background,
                    disabledContainerColor = SurfaceVariant,
                    disabledContentColor = OnSurfaceSecondary,
                ),
            ) {
                Text(if (uiState.isSyncing) stringResource(R.string.settings_sync_syncing) else stringResource(R.string.settings_sync_now_button))
            }
            OutlinedButton(onClick = viewModel::onLogout) {
                Text(stringResource(R.string.settings_sync_logout_button))
            }
        }

        uiState.syncMessage?.let { message ->
            val displayText = when (message) {
                SYNC_SUCCESS_SENTINEL -> stringResource(R.string.settings_sync_success)
                else -> stringResource(R.string.settings_sync_error, message)
            }
            Text(
                text = displayText,
                style = MaterialTheme.typography.bodySmall,
                color = if (uiState.syncError) PriorityHigh else Accent,
            )
        }
    } else {
        var isPasswordVisible by remember { mutableStateOf(false) }

        OutlinedTextField(
            value = uiState.serverUrlInput,
            onValueChange = viewModel::onServerUrlChanged,
            label = { Text(stringResource(R.string.settings_sync_server_label)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            colors = fieldColors(),
        )
        OutlinedTextField(
            value = uiState.emailInput,
            onValueChange = viewModel::onEmailChanged,
            label = { Text(stringResource(R.string.settings_sync_email_label)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            colors = fieldColors(),
        )
        OutlinedTextField(
            value = uiState.passwordInput,
            onValueChange = viewModel::onPasswordChanged,
            label = { Text(stringResource(R.string.settings_sync_password_label)) },
            singleLine = true,
            visualTransformation = if (isPasswordVisible) VisualTransformation.None else PasswordVisualTransformation(),
            trailingIcon = {
                IconButton(onClick = { isPasswordVisible = !isPasswordVisible }) {
                    Icon(
                        imageVector = if (isPasswordVisible) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                        contentDescription = null,
                    )
                }
            },
            modifier = Modifier.fillMaxWidth(),
            colors = fieldColors(),
        )

        Button(
            onClick = viewModel::onSubmitAuth,
            enabled = !uiState.authLoading && uiState.emailInput.isNotBlank() && uiState.passwordInput.isNotBlank(),
            colors = ButtonDefaults.buttonColors(
                containerColor = Accent,
                contentColor = Background,
                disabledContainerColor = SurfaceVariant,
                disabledContentColor = OnSurfaceSecondary,
            ),
        ) {
            Text(
                if (uiState.authMode == AuthMode.LOGIN) {
                    stringResource(R.string.settings_sync_login_button)
                } else {
                    stringResource(R.string.settings_sync_register_button)
                },
            )
        }

        Text(
            text = if (uiState.authMode == AuthMode.LOGIN) {
                stringResource(R.string.settings_sync_toggle_to_register)
            } else {
                stringResource(R.string.settings_sync_toggle_to_login)
            },
            style = MaterialTheme.typography.labelMedium,
            color = Accent,
            modifier = Modifier.clickable(onClick = viewModel::onAuthModeToggled),
        )

        uiState.authError?.let { error ->
            Text(text = error, style = MaterialTheme.typography.bodySmall, color = PriorityHigh)
        }
    }
}

private const val SYNC_SUCCESS_SENTINEL = "__sync_success__"

private fun formatSyncTimestamp(millis: Long): String =
    millis.toLocalDateTime().format(DateTimeFormatter.ofPattern("dd/MM HH:mm"))

@Composable
private fun fieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = Accent,
    unfocusedBorderColor = Outline,
    cursorColor = Accent,
    focusedLabelColor = Accent,
    unfocusedLabelColor = OnSurfaceSecondary,
)

@Composable
private fun BackupSection(
    uiState: SettingsUiState,
    onExportTo: (Uri) -> Unit,
    onImportFrom: (Uri) -> Unit,
) {
    val exportLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        uri?.let(onExportTo)
    }
    val importLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let(onImportFrom)
    }

    Text(
        text = stringResource(R.string.settings_backup_section_description),
        style = MaterialTheme.typography.bodySmall,
        color = OnSurfaceSecondary,
    )

    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        OutlinedButton(
            onClick = { exportLauncher.launch("organizador-backup.json") },
            enabled = !uiState.isExporting && !uiState.isImporting,
        ) {
            Text(if (uiState.isExporting) stringResource(R.string.settings_backup_exporting) else stringResource(R.string.settings_backup_export))
        }
        OutlinedButton(
            onClick = { importLauncher.launch(arrayOf("application/json")) },
            enabled = !uiState.isExporting && !uiState.isImporting,
        ) {
            Text(if (uiState.isImporting) stringResource(R.string.settings_backup_importing) else stringResource(R.string.settings_backup_import))
        }
    }

    val message = uiState.backupMessage
    if (message != null) {
        val displayText = when (message) {
            EXPORT_SUCCESS_SENTINEL -> stringResource(R.string.settings_backup_export_success)
            IMPORT_SUCCESS_SENTINEL -> stringResource(R.string.settings_backup_import_success)
            else -> stringResource(R.string.settings_backup_error, message)
        }
        Text(
            text = displayText,
            style = MaterialTheme.typography.bodySmall,
            color = if (uiState.backupError) PriorityHigh else Accent,
        )
    }
}

private const val EXPORT_SUCCESS_SENTINEL = "__export_success__"
private const val IMPORT_SUCCESS_SENTINEL = "__import_success__"

@Composable
private fun ReminderStatusSection() {
    val context = LocalContext.current
    var notificationsGranted by remember { mutableStateOf(hasNotificationPermission(context)) }
    var canScheduleExact by remember { mutableStateOf(canScheduleExactAlarms(context)) }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                notificationsGranted = hasNotificationPermission(context)
                canScheduleExact = canScheduleExactAlarms(context)
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    when {
        !notificationsGranted -> Text(
            text = stringResource(R.string.settings_reminders_notifications_denied),
            style = MaterialTheme.typography.bodySmall,
            color = PriorityHigh,
            modifier = Modifier.clickable { openAppNotificationSettings(context) },
        )
        !canScheduleExact -> Text(
            text = stringResource(R.string.settings_reminders_exact_alarm_denied),
            style = MaterialTheme.typography.bodySmall,
            color = PriorityHigh,
            modifier = Modifier.clickable { openExactAlarmSettings(context) },
        )
        else -> Text(
            text = stringResource(R.string.settings_reminders_ok),
            style = MaterialTheme.typography.bodySmall,
            color = Accent,
        )
    }
}

@Composable
private fun CalendarSection(
    syncEnabled: Boolean,
    selectedCalendarId: Long?,
    visibleCalendarIds: Set<Long>?,
    onToggle: (Boolean) -> Unit,
    onSelectCalendar: (Long) -> Unit,
    onVisibleCalendarsChanged: (Set<Long>) -> Unit,
    onShowAllCalendars: () -> Unit,
) {
    val context = LocalContext.current
    var hasPermission by remember { mutableStateOf(CalendarProvider.hasPermission(context)) }
    var calendars by remember { mutableStateOf(CalendarProvider.listCalendars(context)) }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { result ->
        val granted = result.values.all { it }
        hasPermission = granted
        if (granted) {
            calendars = CalendarProvider.listCalendars(context)
            onToggle(true)
        }
    }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                hasPermission = CalendarProvider.hasPermission(context)
                if (hasPermission) calendars = CalendarProvider.listCalendars(context)
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    Text(
        text = stringResource(R.string.settings_calendar_section_description),
        style = MaterialTheme.typography.bodySmall,
        color = OnSurfaceSecondary,
    )

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(stringResource(R.string.settings_calendar_sync_toggle), style = MaterialTheme.typography.bodyMedium)
        Switch(
            checked = syncEnabled,
            onCheckedChange = { checked ->
                if (checked && !hasPermission) {
                    permissionLauncher.launch(arrayOf(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR))
                } else {
                    onToggle(checked)
                }
            },
            colors = SwitchDefaults.colors(checkedThumbColor = Accent, checkedTrackColor = Accent.copy(alpha = 0.5f)),
        )
    }

    when {
        !hasPermission -> Text(
            text = stringResource(R.string.settings_calendar_permission_needed),
            style = MaterialTheme.typography.bodySmall,
            color = PriorityHigh,
        )
        syncEnabled && calendars.isEmpty() -> Text(
            text = stringResource(R.string.settings_calendar_none_found),
            style = MaterialTheme.typography.bodySmall,
            color = OnSurfaceSecondary,
        )
        syncEnabled -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                text = stringResource(R.string.settings_calendar_picker_label),
                style = MaterialTheme.typography.labelMedium,
                color = OnSurfaceSecondary,
            )
            calendars.forEach { calendar ->
                val isSelected = calendar.id == selectedCalendarId
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(if (isSelected) Accent.copy(alpha = 0.12f) else Color.Transparent)
                        .clickable { onSelectCalendar(calendar.id) }
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        modifier = Modifier
                            .size(12.dp)
                            .clip(CircleShape)
                            .background(Color(calendar.color)),
                    )
                    Spacer(Modifier.width(8.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(calendar.displayName, style = MaterialTheme.typography.bodyMedium)
                        Text(calendar.accountName, style = MaterialTheme.typography.labelSmall, color = OnSurfaceSecondary)
                    }
                    if (isSelected) {
                        Icon(Icons.Filled.Check, contentDescription = null, tint = Accent, modifier = Modifier.size(18.dp))
                    }
                }
            }

            Spacer(Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = stringResource(R.string.settings_calendar_visible_label),
                    style = MaterialTheme.typography.labelMedium,
                    color = OnSurfaceSecondary,
                )
                if (visibleCalendarIds != null) {
                    Text(
                        text = stringResource(R.string.settings_calendar_show_all),
                        style = MaterialTheme.typography.labelMedium,
                        color = Accent,
                        modifier = Modifier.clickable(onClick = onShowAllCalendars),
                    )
                }
            }
            val effectiveVisible = visibleCalendarIds ?: calendars.map { it.id }.toSet()
            calendars.forEach { calendar ->
                val isVisible = calendar.id in effectiveVisible
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .clickable {
                            val newSet = if (isVisible) effectiveVisible - calendar.id else effectiveVisible + calendar.id
                            onVisibleCalendarsChanged(newSet)
                        }
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Checkbox(
                        checked = isVisible,
                        onCheckedChange = { checked ->
                            val newSet = if (checked) effectiveVisible + calendar.id else effectiveVisible - calendar.id
                            onVisibleCalendarsChanged(newSet)
                        },
                        colors = CheckboxDefaults.colors(checkedColor = Accent, uncheckedColor = OnSurfaceSecondary),
                    )
                    Box(
                        modifier = Modifier
                            .size(12.dp)
                            .clip(CircleShape)
                            .background(Color(calendar.color)),
                    )
                    Spacer(Modifier.width(8.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(calendar.displayName, style = MaterialTheme.typography.bodyMedium)
                        Text(calendar.accountName, style = MaterialTheme.typography.labelSmall, color = OnSurfaceSecondary)
                    }
                }
            }
        }
    }
}

private fun hasNotificationPermission(context: android.content.Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
    return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
        PackageManager.PERMISSION_GRANTED
}

private fun canScheduleExactAlarms(context: android.content.Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    val alarmManager = context.getSystemService(android.app.AlarmManager::class.java) as AlarmManager
    return alarmManager.canScheduleExactAlarms()
}

private fun openAppNotificationSettings(context: android.content.Context) {
    val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
        putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
        flags = Intent.FLAG_ACTIVITY_NEW_TASK
    }
    context.startActivity(intent)
}

private fun openExactAlarmSettings(context: android.content.Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    val intent = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
        data = Uri.fromParts("package", context.packageName, null)
        flags = Intent.FLAG_ACTIVITY_NEW_TASK
    }
    context.startActivity(intent)
}

@Composable
private fun ModelSuggestionChip(label: String, selected: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(50)
    Text(
        text = label,
        color = if (selected) Accent else OnSurfaceSecondary,
        style = MaterialTheme.typography.labelMedium,
        modifier = Modifier
            .clip(shape)
            .background(if (selected) Accent.copy(alpha = 0.18f) else SurfaceVariant)
            .border(BorderStroke(1.dp, if (selected) Accent else Outline), shape)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
    )
}
