package com.organizador.app.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.organizador.app.data.local.entity.Category
import com.organizador.app.ui.common.parseColorHexOrDefault
import com.organizador.app.ui.theme.Accent
import com.organizador.app.ui.theme.OnSurfaceSecondary
import com.organizador.app.ui.theme.Outline
import com.organizador.app.ui.theme.SurfaceVariant

@Composable
fun CategoryFilterRow(
    categories: List<Category>,
    selectedCategoryId: Long?,
    onSelect: (Long?) -> Unit,
    modifier: Modifier = Modifier,
    allLabel: String = "Todas",
) {
    LazyRow(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        contentPadding = PaddingValues(horizontal = 16.dp),
    ) {
        item {
            FilterPill(label = allLabel, selected = selectedCategoryId == null, onClick = { onSelect(null) })
        }
        items(categories, key = { it.id }) { category ->
            FilterPill(
                label = category.name,
                selected = selectedCategoryId == category.id,
                dotColor = parseColorHexOrDefault(category.colorHex),
                onClick = { onSelect(category.id) },
            )
        }
    }
}

@Composable
private fun FilterPill(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    dotColor: Color? = null,
) {
    val shape = RoundedCornerShape(50)
    Row(
        modifier = Modifier
            .clip(shape)
            .background(if (selected) Accent.copy(alpha = 0.18f) else SurfaceVariant)
            .border(BorderStroke(1.dp, if (selected) Accent else Outline), shape)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (dotColor != null) {
            Box(
                modifier = Modifier
                    .size(6.dp)
                    .clip(CircleShape)
                    .background(dotColor),
            )
            Spacer(Modifier.width(6.dp))
        }
        Text(
            text = label,
            color = if (selected) Accent else OnSurfaceSecondary,
            style = MaterialTheme.typography.labelLarge,
        )
    }
}
