package com.organizador.app.data.local.entity

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import com.organizador.app.domain.model.Priority

@Entity(
    tableName = "tasks",
    foreignKeys = [
        ForeignKey(
            entity = Category::class,
            parentColumns = ["id"],
            childColumns = ["categoryId"],
            onDelete = ForeignKey.SET_NULL,
        ),
        ForeignKey(
            entity = KanbanLane::class,
            parentColumns = ["id"],
            childColumns = ["kanbanLaneId"],
            onDelete = ForeignKey.SET_NULL,
        ),
    ],
    indices = [Index("categoryId"), Index("kanbanLaneId"), Index("dueDate"), Index("isCompleted"), Index("deletedAt")],
)
data class Task(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val title: String,
    val description: String? = null,
    /** Epoch millis (UTC) of the due instant, null when the task has no deadline. */
    val dueDate: Long? = null,
    val priority: Priority = Priority.MEDIUM,
    val categoryId: Long? = null,
    /** Raia (coluna) do Kanban — independente de categoria. Null quando a tarefa não está em nenhuma. */
    val kanbanLaneId: Long? = null,
    val isRecurring: Boolean = false,
    val recurrenceRule: String? = null,
    val isCompleted: Boolean = false,
    val createdAt: Long = System.currentTimeMillis(),
    val completedAt: Long? = null,
    /** Epoch millis a task was moved to trash, null while active. Purged permanently after a retention period. */
    val deletedAt: Long? = null,
    /** How many full focus sessions have been completed for this task via the Pomodoro timer. */
    val completedPomodoros: Int = 0,
    /** Id of the device calendar event mirroring this task's due date, when calendar sync is enabled. Null otherwise. */
    val calendarEventId: Long? = null,
    /** Absolute path of a photo attached to this task, stored in the app's private storage. Null when none. */
    val photoPath: String? = null,
    /** User-defined manual order, only meaningful when sorting by [com.organizador.app.ui.alltasks.TaskSortOption.MANUAL]. Ties (e.g. every task defaults to 0 until first reordered) fall back to [id]. */
    val position: Int = 0,
    /** Id desta tarefa no backend de sync (ferramenta "Tarefas" do hub), null enquanto nunca foi sincronizada. Gerado no cliente (UUID) no primeiro push. */
    val remoteId: String? = null,
    /** Última modificação local, em epoch millis — usado pelo sync para decidir quem vence (local vs. servidor) num conflito. */
    val updatedAt: Long = System.currentTimeMillis(),
    /** Location reminder: fires a notification on entering a [locationRadiusMeters]-meter radius around this point. Null fields mean no location reminder is set. */
    val locationLat: Double? = null,
    val locationLng: Double? = null,
    val locationRadiusMeters: Float? = null,
    /** Human-readable place name/address shown in the UI, resolved once at pick time via [android.location.Geocoder]. */
    val locationLabel: String? = null,
)
