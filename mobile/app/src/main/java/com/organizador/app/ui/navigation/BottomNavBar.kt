package com.organizador.app.ui.navigation

import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.organizador.app.ui.theme.Accent
import com.organizador.app.ui.theme.OnSurfaceSecondary
import com.organizador.app.ui.theme.Surface

@Composable
fun BottomNavBar(
    currentItem: BottomNavItem,
    onNavigate: (BottomNavItem) -> Unit,
) {
    NavigationBar(containerColor = Surface) {
        BottomNavItem.entries.forEach { item ->
            NavigationBarItem(
                selected = item == currentItem,
                onClick = { onNavigate(item) },
                icon = { Icon(imageVector = item.icon, contentDescription = item.label, modifier = Modifier.size(22.dp)) },
                label = {
                    Text(
                        text = item.label,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        textAlign = TextAlign.Center,
                        fontSize = 10.sp,
                        lineHeight = 12.sp,
                        style = MaterialTheme.typography.labelSmall,
                    )
                },
                colors = NavigationBarItemDefaults.colors(
                    selectedIconColor = Accent,
                    selectedTextColor = Accent,
                    unselectedIconColor = OnSurfaceSecondary,
                    unselectedTextColor = OnSurfaceSecondary,
                    indicatorColor = Accent.copy(alpha = 0.16f),
                ),
            )
        }
    }
}
