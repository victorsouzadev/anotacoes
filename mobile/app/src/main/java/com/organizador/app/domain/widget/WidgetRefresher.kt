package com.organizador.app.domain.widget

/**
 * Abstraction over "refresh the home screen widget", so [com.organizador.app.data.repository.TaskRepository]
 * doesn't need to know about Glance directly. The widget's own self-updates (periodic + its own
 * button taps) aren't enough — without this, edits made from inside the app never reach it.
 */
interface WidgetRefresher {
    suspend fun refresh()
}
