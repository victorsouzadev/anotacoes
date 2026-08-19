package com.organizador.app.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import com.organizador.app.data.local.dao.CategoryDao
import com.organizador.app.data.local.dao.SubtaskDao
import com.organizador.app.data.local.dao.TaskDao
import com.organizador.app.data.local.entity.Category
import com.organizador.app.data.local.entity.Subtask
import com.organizador.app.data.local.entity.Task

@Database(
    entities = [Task::class, Category::class, Subtask::class],
    version = 9,
    exportSchema = false,
)
@TypeConverters(Converters::class)
abstract class AppDatabase : RoomDatabase() {

    abstract fun taskDao(): TaskDao
    abstract fun categoryDao(): CategoryDao
    abstract fun subtaskDao(): SubtaskDao

    companion object {
        private const val DATABASE_NAME = "organizador.db"

        @Volatile
        private var instance: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase {
            return instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    DATABASE_NAME,
                )
                    // App is still in active development with no published migration path yet;
                    // recreate the DB on schema bumps instead of hand-writing migrations.
                    .fallbackToDestructiveMigration()
                    .build()
                    .also { instance = it }
            }
        }
    }
}
