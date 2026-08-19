package com.organizador.app.ui.common

import androidx.compose.ui.graphics.Color
import com.organizador.app.domain.model.Priority
import com.organizador.app.ui.theme.PriorityHigh
import com.organizador.app.ui.theme.PriorityLow
import com.organizador.app.ui.theme.PriorityMedium

fun priorityColor(priority: Priority): Color = when (priority) {
    Priority.LOW -> PriorityLow
    Priority.MEDIUM -> PriorityMedium
    Priority.HIGH -> PriorityHigh
}

fun priorityLabel(priority: Priority): String = when (priority) {
    Priority.LOW -> "Baixa"
    Priority.MEDIUM -> "Média"
    Priority.HIGH -> "Alta"
}
