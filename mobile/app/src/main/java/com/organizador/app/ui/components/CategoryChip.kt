package com.organizador.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.organizador.app.ui.common.parseColorHexOrDefault
import com.organizador.app.ui.theme.OnSurfaceSecondary
import com.organizador.app.ui.theme.SurfaceVariant

@Composable
fun CategoryChip(
    name: String,
    colorHex: String,
    modifier: Modifier = Modifier,
) {
    val dotColor = remember(colorHex) { parseColorHexOrDefault(colorHex) }
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(8.dp))
            .background(SurfaceVariant)
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        androidx.compose.foundation.layout.Box(
            modifier = Modifier
                .size(6.dp)
                .clip(CircleShape)
                .background(dotColor),
        )
        Spacer(Modifier.width(4.dp))
        Text(text = name, style = MaterialTheme.typography.labelSmall, color = OnSurfaceSecondary)
    }
}
