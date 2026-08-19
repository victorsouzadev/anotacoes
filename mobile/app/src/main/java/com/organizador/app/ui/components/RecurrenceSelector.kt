package com.organizador.app.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.organizador.app.R
import com.organizador.app.domain.model.RecurrenceRule
import com.organizador.app.ui.common.weekdayShortLabel
import com.organizador.app.ui.theme.Accent
import com.organizador.app.ui.theme.OnSurfaceSecondary
import com.organizador.app.ui.theme.Outline
import com.organizador.app.ui.theme.SurfaceVariant
import java.time.DayOfWeek

private enum class RecurrenceMode { DAILY, WEEKLY, MONTHLY }

@Composable
fun RecurrenceSelector(
    selected: RecurrenceRule?,
    onSelect: (RecurrenceRule?) -> Unit,
    modifier: Modifier = Modifier,
) {
    val modeOptions: List<Pair<RecurrenceMode?, String>> = listOf(
        null to stringResource(R.string.recurrence_none),
        RecurrenceMode.DAILY to stringResource(R.string.recurrence_daily),
        RecurrenceMode.WEEKLY to stringResource(R.string.recurrence_weekly),
        RecurrenceMode.MONTHLY to stringResource(R.string.recurrence_monthly),
    )
    val currentMode = when (selected) {
        null -> null
        is RecurrenceRule.Daily -> RecurrenceMode.DAILY
        is RecurrenceRule.Weekly -> RecurrenceMode.WEEKLY
        RecurrenceRule.Monthly -> RecurrenceMode.MONTHLY
    }

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        val shape = RoundedCornerShape(50)
        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = PaddingValues(horizontal = 0.dp),
        ) {
            items(modeOptions, key = { it.first?.name ?: "none" }) { (mode, label) ->
                val isSelected = mode == currentMode
                Text(
                    text = label,
                    color = if (isSelected) Accent else OnSurfaceSecondary,
                    style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier
                        .clip(shape)
                        .background(if (isSelected) Accent.copy(alpha = 0.18f) else SurfaceVariant)
                        .border(BorderStroke(1.dp, if (isSelected) Accent else Outline), shape)
                        .clickable {
                            onSelect(
                                when (mode) {
                                    null -> null
                                    RecurrenceMode.DAILY -> RecurrenceRule.Daily(1)
                                    RecurrenceMode.WEEKLY -> RecurrenceRule.Weekly(setOf(DayOfWeek.MONDAY))
                                    RecurrenceMode.MONTHLY -> RecurrenceRule.Monthly
                                },
                            )
                        }
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                )
            }
        }

        when (selected) {
            is RecurrenceRule.Daily -> DailyIntervalStepper(
                intervalDays = selected.intervalDays,
                onIntervalChange = { onSelect(RecurrenceRule.Daily(it)) },
            )
            is RecurrenceRule.Weekly -> WeekdayPicker(
                selectedDays = selected.daysOfWeek,
                onToggleDay = { day ->
                    val newDays = if (day in selected.daysOfWeek) selected.daysOfWeek - day else selected.daysOfWeek + day
                    if (newDays.isNotEmpty()) onSelect(RecurrenceRule.Weekly(newDays))
                },
            )
            else -> Unit
        }
    }
}

@Composable
private fun DailyIntervalStepper(intervalDays: Int, onIntervalChange: (Int) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            text = stringResource(R.string.recurrence_every_prefix),
            style = MaterialTheme.typography.bodyMedium,
            color = OnSurfaceSecondary,
        )
        IconButton(
            onClick = { if (intervalDays > 1) onIntervalChange(intervalDays - 1) },
            modifier = Modifier.size(32.dp),
        ) {
            Icon(Icons.Filled.Remove, contentDescription = stringResource(R.string.recurrence_decrease), tint = Accent)
        }
        Text(intervalDays.toString(), style = MaterialTheme.typography.titleSmall)
        IconButton(onClick = { onIntervalChange(intervalDays + 1) }, modifier = Modifier.size(32.dp)) {
            Icon(Icons.Filled.Add, contentDescription = stringResource(R.string.recurrence_increase), tint = Accent)
        }
        Text(
            text = if (intervalDays == 1) {
                stringResource(R.string.recurrence_day_singular)
            } else {
                stringResource(R.string.recurrence_day_plural)
            },
            style = MaterialTheme.typography.bodyMedium,
            color = OnSurfaceSecondary,
        )
    }
}

@Composable
private fun WeekdayPicker(selectedDays: Set<DayOfWeek>, onToggleDay: (DayOfWeek) -> Unit) {
    val shape = RoundedCornerShape(10.dp)
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        DayOfWeek.entries.forEach { day ->
            val isSelected = day in selectedDays
            Text(
                text = weekdayShortLabel(day),
                color = if (isSelected) Accent else OnSurfaceSecondary,
                style = MaterialTheme.typography.labelMedium,
                modifier = Modifier
                    .clip(shape)
                    .background(if (isSelected) Accent.copy(alpha = 0.18f) else SurfaceVariant)
                    .border(BorderStroke(1.dp, if (isSelected) Accent else Outline), shape)
                    .clickable { onToggleDay(day) }
                    .padding(horizontal = 8.dp, vertical = 8.dp),
            )
        }
    }
}
