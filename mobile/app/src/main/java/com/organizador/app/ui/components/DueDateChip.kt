package com.organizador.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.organizador.app.ui.common.DueStatus
import com.organizador.app.ui.common.dueStatusOf
import com.organizador.app.ui.common.formatDueChipLabel
import com.organizador.app.ui.theme.Accent
import com.organizador.app.ui.theme.DateTimeTextStyle
import com.organizador.app.ui.theme.OnSurfaceSecondary
import com.organizador.app.ui.theme.PriorityHigh
import com.organizador.app.ui.theme.SurfaceVariant

@Composable
fun DueDateChip(
    dueDateMillis: Long?,
    isCompleted: Boolean = false,
    modifier: Modifier = Modifier,
) {
    val status = dueStatusOf(dueDateMillis)
    val label = formatDueChipLabel(dueDateMillis)
    val (background, foreground) = when {
        isCompleted -> SurfaceVariant to OnSurfaceSecondary
        status == DueStatus.OVERDUE -> PriorityHigh.copy(alpha = 0.18f) to PriorityHigh
        status == DueStatus.TODAY -> Accent.copy(alpha = 0.18f) to Accent
        else -> SurfaceVariant to OnSurfaceSecondary
    }

    Row(
        modifier = modifier
            .clip(RoundedCornerShape(8.dp))
            .background(background)
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = Icons.Outlined.Schedule,
            contentDescription = null,
            tint = foreground,
            modifier = Modifier.size(12.dp),
        )
        androidx.compose.foundation.layout.Spacer(Modifier.width(4.dp))
        Text(text = label, style = DateTimeTextStyle, color = foreground)
    }
}
