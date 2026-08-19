package com.organizador.app.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.organizador.app.domain.model.Priority
import com.organizador.app.ui.common.priorityColor
import com.organizador.app.ui.common.priorityLabel
import com.organizador.app.ui.theme.OnSurfaceSecondary
import com.organizador.app.ui.theme.Outline
import com.organizador.app.ui.theme.SurfaceVariant

@Composable
fun PrioritySelector(
    selected: Priority,
    onSelect: (Priority) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        val shape = RoundedCornerShape(20.dp)
        Priority.entries.forEach { priority ->
            val isSelected = priority == selected
            val color = priorityColor(priority)
            Box(
                modifier = Modifier
                    .weight(1f)
                    .clip(shape)
                    .background(if (isSelected) color.copy(alpha = 0.18f) else SurfaceVariant)
                    .border(BorderStroke(1.dp, if (isSelected) color else Outline), shape)
                    .clickable { onSelect(priority) }
                    .padding(vertical = 10.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = priorityLabel(priority),
                    color = if (isSelected) color else OnSurfaceSecondary,
                    style = MaterialTheme.typography.labelLarge,
                )
            }
        }
    }
}
