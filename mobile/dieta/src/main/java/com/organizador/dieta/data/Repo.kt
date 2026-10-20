package com.organizador.dieta.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import java.io.File
import java.time.LocalDate
import java.util.UUID
import kotlin.math.max
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/** Tudo que as telas gravam passa por aqui: grava no Room marcado como sujo e pede um sync. */
class Repo(private val context: Context, val db: DietaDb, val prefs: Prefs, private val pedirSync: () -> Unit) {

    private fun agora() = System.currentTimeMillis()

    // ---------- TACO ----------
    suspend fun garantirTaco() = withContext(Dispatchers.IO) {
        if (db.alimentos().contarTaco() > 0) return@withContext
        val itens = context.assets.open("taco.csv").bufferedReader().useLines { linhas ->
            linhas.filter { !it.startsWith("#") && !it.startsWith("id;") && it.isNotBlank() }.map { l ->
                val c = l.split(';')
                Alimento(
                    id = "taco-${c[0]}", nome = c[1], kcal = c[2].toDouble(), proteina = c[3].toDouble(), carbo = c[4].toDouble(),
                    gordura = c[5].toDouble(), fibra = c[6].toDouble(), sodio = c[7].toDouble(), fonte = "taco", proprio = false, updatedAt = 0,
                )
            }.toList()
        }
        db.alimentos().salvarTodos(itens)
    }

    // ---------- Diário ----------
    suspend fun registrar(data: LocalDate, refeicao: String, a: Alimento, gramas: Double, fotoId: String? = null) {
        val t = Calculos.porcao(a, gramas)
        db.registros().salvar(Registro(UUID.randomUUID().toString(), data.toString(), refeicao, a.id, a.nome, gramas,
            t.kcal, t.proteina, t.carbo, t.gordura, t.fibra, fotoId))
        pedirSync()
    }

    suspend fun alterarQuantidade(r: Registro, gramas: Double) {
        val a = r.alimentoId?.let { db.alimentos().porId(it) }
        val novo = if (a != null) {
            val t = Calculos.porcao(a, gramas)
            r.copy(quantidadeG = gramas, kcal = t.kcal, proteina = t.proteina, carbo = t.carbo, gordura = t.gordura, fibra = t.fibra)
        } else {
            val f = gramas / r.quantidadeG
            r.copy(quantidadeG = gramas, kcal = r.kcal * f, proteina = r.proteina * f, carbo = r.carbo * f, gordura = r.gordura * f, fibra = r.fibra * f)
        }
        db.registros().salvar(novo.copy(updatedAt = agora(), sujo = true))
        pedirSync()
    }

    suspend fun apagar(r: Registro) {
        db.registros().salvar(r.copy(deletedAt = agora(), updatedAt = agora(), sujo = true))
        pedirSync()
    }

    /** "Repetir refeição": copia os itens de outro dia para a mesma refeição de [para]. */
    suspend fun repetir(de: LocalDate, para: LocalDate, refeicao: String): Int {
        val itens = db.registros().daRefeicao(de.toString(), refeicao)
        itens.forEach { r ->
            db.registros().salvar(r.copy(id = UUID.randomUUID().toString(), data = para.toString(), fotoId = null,
                createdAt = agora(), updatedAt = agora(), sujo = true))
        }
        if (itens.isNotEmpty()) pedirSync()
        return itens.size
    }

    suspend fun beberAgua(data: LocalDate, ml: Int) {
        db.agua().salvar(Agua(UUID.randomUUID().toString(), data.toString(), ml))
        pedirSync()
    }

    suspend fun desfazerAgua(a: Agua) {
        db.agua().salvar(a.copy(deletedAt = agora(), updatedAt = agora(), sujo = true))
        pedirSync()
    }

    suspend fun registrarPeso(data: LocalDate, kg: Double) {
        db.pesos().salvar(Peso(UUID.randomUUID().toString(), data.toString(), kg))
        pedirSync()
    }

    suspend fun apagarPeso(p: Peso) {
        db.pesos().salvar(p.copy(deletedAt = agora(), updatedAt = agora(), sujo = true))
        pedirSync()
    }

    // ---------- Alimentos ----------
    suspend fun salvarAlimento(a: Alimento) {
        val final = if (a.fonte == "receita") recalcularReceita(a) else a
        db.alimentos().salvar(final.copy(proprio = true, updatedAt = agora(), sujo = true))
        pedirSync()
    }

    suspend fun alternarFavorito(a: Alimento) {
        if (!a.proprio) {
            // Favoritar um item da TACO cria uma cópia própria, que é o que o servidor guarda por usuário.
            salvarAlimento(a.copy(id = UUID.randomUUID().toString(), fonte = "manual", favorito = true))
        } else {
            salvarAlimento(a.copy(favorito = !a.favorito))
        }
    }

    suspend fun apagarAlimento(a: Alimento) {
        db.alimentos().salvar(a.copy(deletedAt = agora(), updatedAt = agora(), sujo = true))
        pedirSync()
    }

    /** Valores por 100 g = soma dos itens ÷ peso total × 100 (mesma conta do servidor). */
    private suspend fun recalcularReceita(r: Alimento): Alimento {
        val itens = runCatching { JSONArray(r.itens ?: "[]").objetos() }.getOrDefault(emptyList())
        var total = 0.0
        var soma = Totais()
        for (i in itens) {
            val a = db.alimentos().porId(i.getString("alimentoId")) ?: continue
            val g = i.getDouble("gramas")
            total += g
            val t = Calculos.porcao(a, g)
            soma = Totais(soma.kcal + t.kcal, soma.proteina + t.proteina, soma.carbo + t.carbo, soma.gordura + t.gordura, soma.fibra + t.fibra)
        }
        if (total <= 0) return r
        val f = 100 / total
        return r.copy(kcal = soma.kcal * f, proteina = soma.proteina * f, carbo = soma.carbo * f, gordura = soma.gordura * f, fibra = soma.fibra * f)
    }

    // ---------- Plano ----------
    suspend fun salvarPlano(p: PlanoItem) {
        db.plano().salvar(p.copy(updatedAt = agora(), sujo = true))
        pedirSync()
    }

    suspend fun apagarPlano(p: PlanoItem) {
        db.plano().salvar(p.copy(deletedAt = agora(), updatedAt = agora(), sujo = true))
        pedirSync()
    }

    // ---------- Perfil ----------
    fun salvarPerfil(p: Perfil) {
        prefs.salvarPerfil(p.copy(updatedAt = agora()), sujo = true)
        pedirSync()
    }

    // ---------- Fotos ----------
    fun arquivoNovaFoto(): File = File(context.filesDir, "fotos/${UUID.randomUUID()}.jpg").also { it.parentFile?.mkdirs() }

    /**
     * Guarda a foto (da câmera ou da galeria) reduzida a 1600 px no maior lado, JPEG 80, já na orientação
     * certa, e cria o registro dela. A foto não passa por nenhuma análise: é só registro.
     */
    suspend fun guardarFoto(origem: Uri, data: LocalDate, tipo: String, rotulo: String?): Foto = withContext(Dispatchers.IO) {
        val id = UUID.randomUUID().toString()
        val destino = File(context.filesDir, "fotos/$id.jpg").also { it.parentFile?.mkdirs() }
        val bytes = context.contentResolver.openInputStream(origem)!!.use { it.readBytes() }
        val limites = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, limites)
        var amostra = 1
        while (max(limites.outWidth, limites.outHeight) / (amostra * 2) >= 1600) amostra *= 2
        var bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = amostra })
        val giro = when (ExifInterface(bytes.inputStream()).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90f
            ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            ExifInterface.ORIENTATION_ROTATE_270 -> 270f
            else -> 0f
        }
        val escala = 1600f / max(bmp.width, bmp.height)
        if (giro != 0f || escala < 1f) {
            val m = Matrix().apply { if (escala < 1f) postScale(escala, escala); postRotate(giro) }
            bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
        }
        destino.outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 80, it) }
        val foto = Foto(id, data.toString(), tipo, rotulo, destino.absolutePath)
        db.fotos().salvar(foto)
        pedirSync()
        foto
    }

    suspend fun apagarFoto(f: Foto) {
        runCatching { if (f.caminho.isNotEmpty()) File(f.caminho).delete() }
        if (f.enviada) db.fotos().salvar(f.copy(deletedAt = agora(), caminho = "")) else db.fotos().remover(f.id)
        db.registros().let { dao ->
            // Desvincula a foto dos registros que apontavam para ela.
            dao.doDiaSnapshot(f.data).filter { it.fotoId == f.id }.forEach { dao.salvar(it.copy(fotoId = null, updatedAt = agora(), sujo = true)) }
        }
        pedirSync()
    }
}

private suspend fun RegistroDao.doDiaSnapshot(data: String): List<Registro> = REFEICOES.flatMap { daRefeicao(data, it.first) }

/** Converte entre as entidades locais e o JSON da API. */
object Json {
    private fun d(ms: Long?) = ms?.let(Datas::iso) ?: JSONObject.NULL
    private fun ms(j: JSONObject, nome: String) = j.optStringOrNull(nome)?.let(Datas::epoch)

    fun alimento(a: Alimento) = JSONObject().put("nome", a.nome).put("kcal", a.kcal).put("proteina", a.proteina).put("carbo", a.carbo)
        .put("gordura", a.gordura).put("fibra", a.fibra).put("sodio", a.sodio).put("porcaoG", a.porcaoG)
        .put("porcaoNome", a.porcaoNome ?: JSONObject.NULL).put("codigoBarras", a.codigoBarras ?: JSONObject.NULL)
        .put("fonte", a.fonte).put("itens", a.itens ?: JSONObject.NULL).put("favorito", a.favorito)
        .put("updatedAt", Datas.iso(a.updatedAt)).put("deletedAt", d(a.deletedAt))

    fun alimento(j: JSONObject) = Alimento(
        id = j.getString("id"), nome = j.getString("nome"), kcal = j.getDouble("kcal"), proteina = j.getDouble("proteina"),
        carbo = j.getDouble("carbo"), gordura = j.getDouble("gordura"), fibra = j.optDouble("fibra", 0.0), sodio = j.optDouble("sodio", 0.0),
        porcaoG = j.optDouble("porcaoG", 100.0), porcaoNome = j.optStringOrNull("porcaoNome"), codigoBarras = j.optStringOrNull("codigoBarras"),
        fonte = j.optString("fonte", "manual"), itens = j.optStringOrNull("itens"), favorito = j.optBoolean("favorito"),
        proprio = j.optBoolean("proprio", true), updatedAt = ms(j, "updatedAt") ?: 0, deletedAt = ms(j, "deletedAt"), sujo = false,
    )

    fun registro(r: Registro) = JSONObject().put("data", r.data).put("refeicao", r.refeicao).put("alimentoId", r.alimentoId ?: JSONObject.NULL)
        .put("nome", r.nome).put("quantidadeG", r.quantidadeG).put("kcal", r.kcal).put("proteina", r.proteina).put("carbo", r.carbo)
        .put("gordura", r.gordura).put("fibra", r.fibra).put("fotoId", r.fotoId ?: JSONObject.NULL)
        .put("createdAt", Datas.iso(r.createdAt)).put("updatedAt", Datas.iso(r.updatedAt)).put("deletedAt", d(r.deletedAt))

    fun registro(j: JSONObject) = Registro(
        id = j.getString("id"), data = j.getString("data"), refeicao = j.getString("refeicao"), alimentoId = j.optStringOrNull("alimentoId"),
        nome = j.getString("nome"), quantidadeG = j.getDouble("quantidadeG"), kcal = j.getDouble("kcal"), proteina = j.getDouble("proteina"),
        carbo = j.getDouble("carbo"), gordura = j.getDouble("gordura"), fibra = j.getDouble("fibra"), fotoId = j.optStringOrNull("fotoId"),
        createdAt = ms(j, "createdAt") ?: 0, updatedAt = ms(j, "updatedAt") ?: 0, deletedAt = ms(j, "deletedAt"), sujo = false,
    )

    fun peso(p: Peso) = JSONObject().put("data", p.data).put("kg", p.kg).put("updatedAt", Datas.iso(p.updatedAt)).put("deletedAt", d(p.deletedAt))
    fun peso(j: JSONObject) = Peso(j.getString("id"), j.getString("data"), j.getDouble("kg"), ms(j, "updatedAt") ?: 0, ms(j, "deletedAt"), false)

    fun agua(a: Agua) = JSONObject().put("data", a.data).put("ml", a.ml).put("updatedAt", Datas.iso(a.updatedAt)).put("deletedAt", d(a.deletedAt))
    fun agua(j: JSONObject) = Agua(j.getString("id"), j.getString("data"), j.getInt("ml"), ms(j, "updatedAt") ?: 0, ms(j, "deletedAt"), false)

    fun plano(p: PlanoItem) = JSONObject().put("diaSemana", p.diaSemana).put("refeicao", p.refeicao).put("alimentoId", p.alimentoId ?: JSONObject.NULL)
        .put("nome", p.nome).put("quantidadeG", p.quantidadeG).put("updatedAt", Datas.iso(p.updatedAt)).put("deletedAt", d(p.deletedAt))

    fun plano(j: JSONObject) = PlanoItem(j.getString("id"), j.getInt("diaSemana"), j.getString("refeicao"), j.optStringOrNull("alimentoId"),
        j.getString("nome"), j.getDouble("quantidadeG"), ms(j, "updatedAt") ?: 0, ms(j, "deletedAt"), false)
}
