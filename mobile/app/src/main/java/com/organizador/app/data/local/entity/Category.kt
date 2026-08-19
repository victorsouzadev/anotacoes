package com.organizador.app.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "categories")
data class Category(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val name: String,
    val colorHex: String,
    /** Id desta categoria no backend de sync, null enquanto nunca foi sincronizada. Gerado no cliente (UUID) no primeiro push. */
    val remoteId: String? = null,
    /** Última modificação local, em epoch millis — usado pelo sync para decidir quem vence num conflito. */
    val updatedAt: Long = System.currentTimeMillis(),
)
