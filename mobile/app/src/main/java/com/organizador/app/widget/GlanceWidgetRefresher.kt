package com.organizador.app.widget

import android.content.Context
import androidx.glance.appwidget.updateAll
import com.organizador.app.domain.widget.WidgetRefresher

class GlanceWidgetRefresher(private val context: Context) : WidgetRefresher {
    override suspend fun refresh() {
        TodayTasksWidget().updateAll(context)
    }
}
