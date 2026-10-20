package com.organizador.dieta.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

// Espelho local das tabelas dieta_* do backend. Datas de calendário como "yyyy-MM-dd" (igual ao JSON da
// API), instantes como epoch ms. "sujo" = alterado aqui e ainda não enviado ao servidor.

@Entity(tableName = "alimentos", indices = [Index("codigoBarras")])
data class Alimento(
    @PrimaryKey val id: String,
    val nome: String,
    val kcal: Double,
    val proteina: Double,
    val carbo: Double,
    val gordura: Double,
    val fibra: Double = 0.0,
    val sodio: Double = 0.0,
    val porcaoG: Double = 100.0,
    val porcaoNome: String? = null,
    val codigoBarras: String? = null,
    /** taco, off, manual ou receita. */
    val fonte: String = "manual",
    /** JSON [{alimentoId, nome, gramas}] quando é receita. */
    val itens: String? = null,
    val favorito: Boolean = false,
    val proprio: Boolean = true,
    val updatedAt: Long = System.currentTimeMillis(),
    val deletedAt: Long? = null,
    val sujo: Boolean = false,
)

@Entity(tableName = "registros", indices = [Index("data")])
data class Registro(
    @PrimaryKey val id: String,
    val data: String,
    val refeicao: String,
    val alimentoId: String?,
    val nome: String,
    val quantidadeG: Double,
    val kcal: Double,
    val proteina: Double,
    val carbo: Double,
    val gordura: Double,
    val fibra: Double,
    val fotoId: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
    val deletedAt: Long? = null,
    val sujo: Boolean = true,
)

@Entity(tableName = "pesos", indices = [Index("data")])
data class Peso(
    @PrimaryKey val id: String,
    val data: String,
    val kg: Double,
    val updatedAt: Long = System.currentTimeMillis(),
    val deletedAt: Long? = null,
    val sujo: Boolean = true,
)

@Entity(tableName = "agua", indices = [Index("data")])
data class Agua(
    @PrimaryKey val id: String,
    val data: String,
    val ml: Int,
    val updatedAt: Long = System.currentTimeMillis(),
    val deletedAt: Long? = null,
    val sujo: Boolean = true,
)

@Entity(tableName = "plano")
data class PlanoItem(
    @PrimaryKey val id: String,
    /** -1 = todos os dias; 0 = domingo … 6 = sábado (como o DayOfWeek do .NET). */
    val diaSemana: Int,
    val refeicao: String,
    val alimentoId: String?,
    val nome: String,
    val quantidadeG: Double,
    val updatedAt: Long = System.currentTimeMillis(),
    val deletedAt: Long? = null,
    val sujo: Boolean = true,
)

@Entity(tableName = "fotos", indices = [Index("data")])
data class Foto(
    @PrimaryKey val id: String,
    val data: String,
    /** refeicao ou corpo. */
    val tipo: String,
    /** Refeição (cafe, almoco…) ou pose (frente, lado, costas). */
    val rotulo: String?,
    /** Caminho do JPEG em filesDir/fotos. Vazio enquanto a foto do servidor não foi baixada. */
    val caminho: String,
    val enviada: Boolean = false,
    val createdAt: Long = System.currentTimeMillis(),
    val deletedAt: Long? = null,
)

@Dao
interface AlimentoDao {
    @Query("SELECT * FROM alimentos WHERE deletedAt IS NULL")
    fun todos(): Flow<List<Alimento>>

    @Query("SELECT * FROM alimentos WHERE proprio = 1 AND deletedAt IS NULL ORDER BY favorito DESC, nome")
    fun meus(): Flow<List<Alimento>>

    @Query("SELECT * FROM alimentos WHERE id = :id")
    suspend fun porId(id: String): Alimento?

    @Query("SELECT * FROM alimentos WHERE codigoBarras = :codigo AND deletedAt IS NULL LIMIT 1")
    suspend fun porCodigo(codigo: String): Alimento?

    @Query("SELECT COUNT(*) FROM alimentos WHERE fonte = 'taco'")
    suspend fun contarTaco(): Int

    @Query("SELECT * FROM alimentos WHERE sujo = 1")
    suspend fun sujos(): List<Alimento>

    @Upsert
    suspend fun salvar(vararg a: Alimento)

    @Upsert
    suspend fun salvarTodos(a: List<Alimento>)
}

@Dao
interface RegistroDao {
    @Query("SELECT * FROM registros WHERE data = :data AND deletedAt IS NULL ORDER BY createdAt")
    fun doDia(data: String): Flow<List<Registro>>

    @Query("SELECT * FROM registros WHERE data = :data AND refeicao = :refeicao AND deletedAt IS NULL")
    suspend fun daRefeicao(data: String, refeicao: String): List<Registro>

    @Query("SELECT * FROM registros WHERE data >= :inicio AND data <= :fim AND deletedAt IS NULL")
    fun periodo(inicio: String, fim: String): Flow<List<Registro>>

    /** Últimos alimentos usados, para a lista de "recentes" ao adicionar. */
    @Query("SELECT * FROM registros WHERE deletedAt IS NULL ORDER BY createdAt DESC LIMIT 200")
    fun recentes(): Flow<List<Registro>>

    @Query("SELECT * FROM registros WHERE id = :id")
    suspend fun porId(id: String): Registro?

    @Query("SELECT * FROM registros WHERE sujo = 1")
    suspend fun sujos(): List<Registro>

    @Upsert
    suspend fun salvar(vararg r: Registro)
}

@Dao
interface PesoDao {
    @Query("SELECT * FROM pesos WHERE deletedAt IS NULL ORDER BY data, updatedAt")
    fun todos(): Flow<List<Peso>>

    @Query("SELECT * FROM pesos WHERE id = :id")
    suspend fun porId(id: String): Peso?

    @Query("SELECT * FROM pesos WHERE deletedAt IS NULL ORDER BY data DESC, updatedAt DESC LIMIT 1")
    suspend fun ultimo(): Peso?

    @Query("SELECT * FROM pesos WHERE sujo = 1")
    suspend fun sujos(): List<Peso>

    @Upsert
    suspend fun salvar(vararg p: Peso)
}

@Dao
interface AguaDao {
    @Query("SELECT * FROM agua WHERE data = :data AND deletedAt IS NULL ORDER BY updatedAt")
    fun doDia(data: String): Flow<List<Agua>>

    @Query("SELECT COALESCE(SUM(ml), 0) FROM agua WHERE data = :data AND deletedAt IS NULL")
    suspend fun totalDoDia(data: String): Int

    @Query("SELECT * FROM agua WHERE id = :id")
    suspend fun porId(id: String): Agua?

    @Query("SELECT * FROM agua WHERE sujo = 1")
    suspend fun sujos(): List<Agua>

    @Upsert
    suspend fun salvar(vararg a: Agua)
}

@Dao
interface PlanoDao {
    @Query("SELECT * FROM plano WHERE deletedAt IS NULL ORDER BY diaSemana, refeicao")
    fun todos(): Flow<List<PlanoItem>>

    @Query("SELECT * FROM plano WHERE id = :id")
    suspend fun porId(id: String): PlanoItem?

    @Query("SELECT * FROM plano WHERE sujo = 1")
    suspend fun sujos(): List<PlanoItem>

    @Upsert
    suspend fun salvar(vararg p: PlanoItem)
}

@Dao
interface FotoDao {
    @Query("SELECT * FROM fotos WHERE deletedAt IS NULL AND tipo = :tipo ORDER BY data DESC, createdAt DESC")
    fun doTipo(tipo: String): Flow<List<Foto>>

    @Query("SELECT * FROM fotos WHERE deletedAt IS NULL AND data = :data AND tipo = 'refeicao'")
    fun refeicoesDoDia(data: String): Flow<List<Foto>>

    @Query("SELECT * FROM fotos WHERE id = :id")
    suspend fun porId(id: String): Foto?

    @Query("SELECT * FROM fotos WHERE enviada = 0 AND deletedAt IS NULL")
    suspend fun naoEnviadas(): List<Foto>

    @Query("SELECT * FROM fotos WHERE enviada = 1 AND deletedAt IS NOT NULL")
    suspend fun apagarNoServidor(): List<Foto>

    @Query("SELECT * FROM fotos WHERE caminho = '' AND deletedAt IS NULL")
    suspend fun semArquivo(): List<Foto>

    @Upsert
    suspend fun salvar(vararg f: Foto)

    @Query("DELETE FROM fotos WHERE id = :id")
    suspend fun remover(id: String)
}

@Database(
    entities = [Alimento::class, Registro::class, Peso::class, Agua::class, PlanoItem::class, Foto::class],
    version = 1,
    exportSchema = false,
)
abstract class DietaDb : RoomDatabase() {
    abstract fun alimentos(): AlimentoDao
    abstract fun registros(): RegistroDao
    abstract fun pesos(): PesoDao
    abstract fun agua(): AguaDao
    abstract fun plano(): PlanoDao
    abstract fun fotos(): FotoDao

    companion object {
        fun criar(context: Context): DietaDb =
            Room.databaseBuilder(context.applicationContext, DietaDb::class.java, "dieta.db").build()
    }
}
