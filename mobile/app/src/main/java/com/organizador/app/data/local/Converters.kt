package com.organizador.app.data.local

import androidx.room.TypeConverter
import com.organizador.app.domain.model.Priority

class Converters {
    @TypeConverter
    fun fromPriority(priority: Priority): String = priority.name

    @TypeConverter
    fun toPriority(value: String): Priority = Priority.valueOf(value)
}
