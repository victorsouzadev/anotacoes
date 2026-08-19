package com.organizador.app.ui.statistics

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.organizador.app.R
import com.organizador.app.ui.common.parseColorHexOrDefault
import com.organizador.app.ui.common.rememberViewModelFactory
import com.organizador.app.ui.common.weekdayShortLabel
import com.organizador.app.ui.theme.Accent
import com.organizador.app.ui.theme.Background
import com.organizador.app.ui.theme.OnSurfaceSecondary
import com.organizador.app.ui.theme.Surface as SurfaceColor
import com.organizador.app.ui.theme.SurfaceVariant

@Composable
fun StatisticsScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: StatisticsViewModel = viewModel(factory = rememberViewModelFactory()),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val noCategoryLabel = stringResource(R.string.statistics_no_category)

    Scaffold(
        modifier = modifier,
        containerColor = Background,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.statistics_title), style = MaterialTheme.typography.titleMedium) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Background),
            )
        },
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                StatTile(
                    label = stringResource(R.string.statistics_completed),
                    value = uiState.totalCompleted.toString(),
                    modifier = Modifier.weight(1f),
                )
                StatTile(
                    label = stringResource(R.string.statistics_active),
                    value = uiState.totalActive.toString(),
                    modifier = Modifier.weight(1f),
                )
                StatTile(
                    label = stringResource(R.string.statistics_pomodoros),
                    value = uiState.totalPomodoros.toString(),
                    modifier = Modifier.weight(1f),
                )
                StatTile(
                    label = stringResource(R.string.statistics_streak),
                    value = uiState.currentStreakDays.toString(),
                    modifier = Modifier.weight(1f),
                )
            }

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(R.string.statistics_last_7_days), style = MaterialTheme.typography.titleSmall)
                WeeklyBarChart(days = uiState.last7Days)
            }

            if (uiState.categoryStats.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Text(stringResource(R.string.statistics_by_category), style = MaterialTheme.typography.titleSmall)
                    uiState.categoryStats.forEach { stat ->
                        CategoryStatRow(stat = stat, noCategoryLabel = noCategoryLabel)
                    }
                }
            }
        }
    }
}

@Composable
private fun StatTile(label: String, value: String, modifier: Modifier = Modifier) {
    Surface(color = SurfaceColor, shape = RoundedCornerShape(14.dp), modifier = modifier) {
        Column(
            modifier = Modifier.padding(vertical = 14.dp, horizontal = 6.dp).fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(value, style = MaterialTheme.typography.titleLarge, color = Accent)
            Spacer(Modifier.height(2.dp))
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall,
                color = OnSurfaceSecondary,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun WeeklyBarChart(days: List<DayCount>) {
    val maxCount = (days.maxOfOrNull { it.count } ?: 0).coerceAtLeast(1)
    Row(
        modifier = Modifier.fillMaxWidth().height(120.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.Bottom,
    ) {
        days.forEach { day ->
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(day.count.toString(), style = MaterialTheme.typography.labelSmall, color = OnSurfaceSecondary)
                Spacer(Modifier.height(4.dp))
                val barHeight = (70 * day.count / maxCount).dp.coerceAtLeast(4.dp)
                Box(
                    modifier = Modifier
                        .width(20.dp)
                        .height(barHeight)
                        .clip(RoundedCornerShape(4.dp))
                        .background(if (day.count > 0) Accent else SurfaceVariant),
                )
                Spacer(Modifier.height(6.dp))
                Text(weekdayShortLabel(day.dayOfWeek), style = MaterialTheme.typography.labelSmall, color = OnSurfaceSecondary)
            }
        }
    }
}

@Composable
private fun CategoryStatRow(stat: CategoryStat, noCategoryLabel: String) {
    val color = parseColorHexOrDefault(stat.colorHex ?: "#8A93A3")
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(stat.name ?: noCategoryLabel, style = MaterialTheme.typography.bodyMedium)
            Text("${stat.completed}/${stat.total}", style = MaterialTheme.typography.labelMedium, color = OnSurfaceSecondary)
        }
        val progress = if (stat.total > 0) stat.completed.toFloat() / stat.total else 0f
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(8.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(SurfaceVariant),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxHeight()
                    .fillMaxWidth(fraction = progress.coerceIn(0f, 1f))
                    .clip(RoundedCornerShape(4.dp))
                    .background(color),
            )
        }
    }
}
