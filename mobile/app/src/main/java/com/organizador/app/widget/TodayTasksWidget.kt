package com.organizador.app.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.organizador.app.MainActivity
import com.organizador.app.R
import com.organizador.app.data.repository.buildTaskRepository
import com.organizador.app.domain.common.startOfDayMillis
import com.organizador.app.domain.model.TaskWithCategory
import kotlinx.coroutines.flow.first
import java.time.LocalDate

private val WidgetBackground = Color(0xFF181C23)
private val WidgetAccent = Color(0xFF3ED9C3)
private val WidgetOnBackground = Color(0xFFEDEFF2)
private val WidgetOnSurfaceSecondary = Color(0xFF8B93A1)

val taskIdActionKey = ActionParameters.Key<Long>("task_id")
val shortcutActionKey = ActionParameters.Key<String>(MainActivity.EXTRA_SHORTCUT_ACTION)
val openTaskIdActionKey = ActionParameters.Key<Long>(MainActivity.EXTRA_OPEN_TASK_ID)

class TodayTasksWidget : GlanceAppWidget() {

    // Default is SizeMode.Single, which composes once for the provider's declared minWidth/minHeight
    // and ignores the box the user actually resizes it to on the home screen — anything beyond that
    // small reference frame gets silently clipped, however big the widget looks. Exact recomposes for
    // whatever size it's actually placed/resized to.
    override val sizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val repository = buildTaskRepository(context)
        val today = LocalDate.now()
        val tasks = repository.todayTasks(
            today.startOfDayMillis(),
            today.plusDays(1).startOfDayMillis(),
        ).first().filter { !it.task.isCompleted }.take(6)

        val title = context.getString(R.string.widget_title)
        val emptyText = context.getString(R.string.widget_empty)

        provideContent {
            WidgetContent(tasks = tasks, title = title, emptyText = emptyText)
        }
    }
}

@Composable
private fun WidgetContent(tasks: List<TaskWithCategory>, title: String, emptyText: String) {
    Column(
        modifier = GlanceModifier
            .fillMaxSize()
            .background(WidgetBackground)
            .appWidgetBackground()
            .cornerRadius(16.dp)
            .padding(12.dp),
    ) {
        Row(
            modifier = GlanceModifier.fillMaxWidth(),
            verticalAlignment = Alignment.Vertical.CenterVertically,
        ) {
            Text(
                text = title,
                style = TextStyle(color = ColorProvider(WidgetOnBackground), fontSize = 16.sp, fontWeight = FontWeight.Bold),
                modifier = GlanceModifier.defaultWeight(),
            )
            Text(
                text = "+",
                style = TextStyle(color = ColorProvider(WidgetAccent), fontSize = 18.sp, fontWeight = FontWeight.Bold),
                modifier = GlanceModifier.clickable(
                    actionStartActivity<MainActivity>(
                        parameters = actionParametersOf(shortcutActionKey to MainActivity.SHORTCUT_ACTION_NEW_TASK),
                    ),
                ),
            )
        }
        Spacer(modifier = GlanceModifier.height(8.dp))

        if (tasks.isEmpty()) {
            Text(
                text = emptyText,
                style = TextStyle(color = ColorProvider(WidgetOnSurfaceSecondary), fontSize = 13.sp),
                modifier = GlanceModifier.padding(top = 8.dp),
            )
        } else {
            // A plain Column instead of LazyColumn: the list is already capped at 6 rows, and this
            // avoids Glance's RemoteViewsService-backed collection view, which some launchers
            // (Samsung One UI in particular) fail to populate reliably.
            Column(modifier = GlanceModifier.fillMaxWidth()) {
                tasks.forEach { item -> WidgetTaskRow(item) }
            }
        }
    }
}

@Composable
private fun WidgetTaskRow(item: TaskWithCategory) {
    Row(
        modifier = GlanceModifier
            .fillMaxWidth()
            .padding(vertical = 6.dp)
            .clickable(
                actionStartActivity<MainActivity>(
                    parameters = actionParametersOf(openTaskIdActionKey to item.task.id),
                ),
            ),
        verticalAlignment = Alignment.Vertical.CenterVertically,
    ) {
        Text(
            text = "○",
            style = TextStyle(color = ColorProvider(WidgetAccent), fontSize = 14.sp),
            modifier = GlanceModifier
                .clickable(actionRunCallback<CompleteTaskAction>(actionParametersOf(taskIdActionKey to item.task.id)))
                .padding(end = 8.dp),
        )
        Text(
            text = item.task.title,
            style = TextStyle(color = ColorProvider(WidgetOnBackground), fontSize = 13.sp),
        )
    }
}
