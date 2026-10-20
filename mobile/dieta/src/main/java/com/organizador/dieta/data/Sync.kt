package com.organizador.dieta.data

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.organizador.dieta.DietaApplication
import com.organizador.dieta.MainActivity
import com.organizador.dieta.R
import java.io.File
import java.time.Duration
import java.time.LocalDateTime
import java.time.LocalTime
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject

/**
 * Sync local-first com o hub, igual ao das Tarefas: envia o que está sujo (PUT idempotente, "quem editou por
 * último vence"), depois busca o que mudou no servidor desde a última marca de cada coleção.
 */
class Sincronizador(private val context: Context, private val repo: Repo, private val api: Api) {
    private val db = repo.db
    private val prefs = repo.prefs
    private val trava = Mutex()

    suspend fun sincronizar() = trava.withLock {
        if (!api.logado) return@withLock
        enviar()
        receber()
        prefs.marcarSync()
        atualizarProgresso()
    }

    private suspend fun enviar() {
        // Alimentos primeiro: registros e receitas podem apontar para eles.
        for (a in db.alimentos().sujos()) {
            val r = api.chamar("PUT", "/api/dieta/alimentos/${a.id}", Json.alimento(a)) as JSONObject
            if (db.alimentos().porId(a.id)?.updatedAt == a.updatedAt) db.alimentos().salvar(Json.alimento(r).copy(sujo = false))
        }
        for (f in db.fotos().naoEnviadas()) {
            if (!File(f.caminho).exists()) continue
            api.enviarFoto(f)
            db.fotos().salvar(f.copy(enviada = true))
        }
        for (f in db.fotos().apagarNoServidor()) {
            runCatching { api.chamar("DELETE", "/api/dieta/fotos/${f.id}") }
                .onFailure { if ((it as? ApiException)?.status != 404) throw it }
            db.fotos().remover(f.id)
        }
        for (r in db.registros().sujos()) {
            api.chamar("PUT", "/api/dieta/registros/${r.id}", Json.registro(r))
            if (db.registros().porId(r.id)?.updatedAt == r.updatedAt) db.registros().salvar(r.copy(sujo = false))
        }
        for (p in db.pesos().sujos()) {
            api.chamar("PUT", "/api/dieta/pesos/${p.id}", Json.peso(p))
            if (db.pesos().porId(p.id)?.updatedAt == p.updatedAt) db.pesos().salvar(p.copy(sujo = false))
        }
        for (a in db.agua().sujos()) {
            api.chamar("PUT", "/api/dieta/agua/${a.id}", Json.agua(a))
            if (db.agua().porId(a.id)?.updatedAt == a.updatedAt) db.agua().salvar(a.copy(sujo = false))
        }
        for (p in db.plano().sujos()) {
            api.chamar("PUT", "/api/dieta/plano/${p.id}", Json.plano(p))
            if (db.plano().porId(p.id)?.updatedAt == p.updatedAt) db.plano().salvar(p.copy(sujo = false))
        }
        if (prefs.perfilSujo) {
            val enviado = prefs.perfil.value
            api.chamar("PUT", "/api/dieta/perfil", enviado.json())
            if (prefs.perfil.value == enviado) prefs.perfilSujo = false
        }
    }

    private suspend fun receber() {
        suspend fun lista(colecao: String, caminho: String): List<JSONObject> {
            val desde = prefs.marca(colecao)?.let { "?desde=" + java.net.URLEncoder.encode(it, "UTF-8") } ?: ""
            val itens = (api.chamar("GET", caminho + desde) as JSONArray).objetos()
            itens.mapNotNull { it.optStringOrNull("updatedAt") ?: it.optStringOrNull("createdAt") }.maxByOrNull(Datas::epoch)
                ?.let { prefs.salvarMarca(colecao, it) }
            return itens
        }

        for (j in lista("alimentos", "/api/dieta/alimentos/meus")) {
            val novo = Json.alimento(j)
            val local = db.alimentos().porId(novo.id)
            if (local == null || (!local.sujo && novo.updatedAt >= local.updatedAt)) db.alimentos().salvar(novo)
        }
        for (j in lista("registros", "/api/dieta/registros")) {
            val novo = Json.registro(j)
            val local = db.registros().porId(novo.id)
            if (local == null || (!local.sujo && novo.updatedAt >= local.updatedAt)) db.registros().salvar(novo)
        }
        for (j in lista("pesos", "/api/dieta/pesos")) {
            val novo = Json.peso(j)
            val local = db.pesos().porId(novo.id)
            if (local == null || (!local.sujo && novo.updatedAt >= local.updatedAt)) db.pesos().salvar(novo)
        }
        for (j in lista("agua", "/api/dieta/agua")) {
            val novo = Json.agua(j)
            val local = db.agua().porId(novo.id)
            if (local == null || (!local.sujo && novo.updatedAt >= local.updatedAt)) db.agua().salvar(novo)
        }
        for (j in lista("plano", "/api/dieta/plano")) {
            val novo = Json.plano(j)
            val local = db.plano().porId(novo.id)
            if (local == null || (!local.sujo && novo.updatedAt >= local.updatedAt)) db.plano().salvar(novo)
        }
        // Fotos: o metadado vem na lista; o arquivo é baixado logo em seguida (o app mostra as fotos offline).
        for (j in (api.chamar("GET", "/api/dieta/fotos") as JSONArray).objetos()) {
            val id = j.getString("id")
            val local = db.fotos().porId(id)
            val apagada = j.optStringOrNull("deletedAt") != null
            when {
                apagada && local != null -> {
                    runCatching { if (local.caminho.isNotEmpty()) File(local.caminho).delete() }
                    db.fotos().remover(id)
                }
                !apagada && local == null -> db.fotos().salvar(
                    Foto(id, j.getString("data"), j.getString("tipo"), j.optStringOrNull("rotulo"), "", enviada = true,
                        createdAt = Datas.epoch(j.getString("createdAt"))),
                )
            }
        }
        for (f in db.fotos().semArquivo()) {
            val destino = File(context.filesDir, "fotos/${f.id}.jpg")
            runCatching { api.baixar("/api/dieta/fotos/${f.id}/arquivo", destino) }
                .onSuccess { db.fotos().salvar(f.copy(caminho = destino.absolutePath)) }
        }
        if (!prefs.perfilSujo) {
            val r = api.chamar("GET", "/api/dieta/perfil") as JSONObject
            r.optJSONObject("perfil")?.let { prefs.salvarPerfil(Perfil.de(it), sujo = false) }
        }
    }

    /** Busca XP/conquistas e avisa por notificação do que foi desbloqueado desde a última vez. */
    suspend fun atualizarProgresso() {
        val p = api.chamar("GET", "/api/dieta/progresso") as JSONObject
        prefs.salvarProgresso(p.toString())
        val desbloqueadas = p.getJSONArray("conquistas").objetos().filter { it.optStringOrNull("em") != null }
        val vistas = prefs.conquistasVistas
        val primeiraVez = vistas.isEmpty() && prefs.nivelVisto == 0
        if (!primeiraVez) {
            desbloqueadas.filter { it.getString("codigo") !in vistas }.forEach {
                Notificacoes.mostrar(context, it.getString("codigo").hashCode(), "Conquista: ${it.getString("nome")}", it.getString("descricao"))
            }
            val nivel = p.getInt("nivel")
            if (nivel > prefs.nivelVisto) Notificacoes.mostrar(context, 1, "Nível $nivel", "Você subiu de nível na Dieta. Continue assim.")
        }
        prefs.conquistasVistas = desbloqueadas.map { it.getString("codigo") }.toSet()
        prefs.nivelVisto = p.getInt("nivel")
    }
}

class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as DietaApplication
        return try {
            app.sincronizador.sincronizar()
            Result.success()
        } catch (e: ApiException) {
            if (e.status == 401 || e.status in 400..499) Result.failure() else Result.retry()
        } catch (e: java.io.IOException) {
            Result.retry()
        }
    }
}

/** Lembrete: só notifica se a refeição do horário ainda não foi registrada hoje. */
class LembreteWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as DietaApplication
        if (!app.prefs.lembretesAtivos) return Result.success()
        val refeicao = inputData.getString("refeicao") ?: return Result.success()
        val hoje = Datas.hoje().toString()
        if (app.db.registros().daRefeicao(hoje, refeicao).isEmpty()) {
            Notificacoes.mostrar(applicationContext, refeicao.hashCode(), "Já registrou o ${nomeRefeicao(refeicao).lowercase()}?",
                "Toque para lançar e manter a sequência.")
        }
        return Result.success()
    }
}

object Agendador {
    private val rede = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    /** Sync logo (com rede), sem empilhar: um pedido novo substitui o pendente. */
    fun syncAgora(context: Context) {
        WorkManager.getInstance(context).enqueueUniqueWork("sync", ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<SyncWorker>().setConstraints(rede).setInitialDelay(3, TimeUnit.SECONDS).build())
    }

    fun agendarTudo(context: Context) {
        val wm = WorkManager.getInstance(context)
        wm.enqueueUniquePeriodicWork("sync_periodico", ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<SyncWorker>(1, TimeUnit.HOURS).setConstraints(rede).build())
        for ((refeicao, hora) in listOf("almoco" to LocalTime.of(13, 30), "jantar" to LocalTime.of(20, 30))) {
            wm.enqueueUniquePeriodicWork("lembrete_$refeicao", ExistingPeriodicWorkPolicy.UPDATE,
                PeriodicWorkRequestBuilder<LembreteWorker>(1, TimeUnit.DAYS)
                    .setInitialDelay(atraso(hora).toMinutes(), TimeUnit.MINUTES)
                    .setInputData(workDataOf("refeicao" to refeicao)).build())
        }
    }

    private fun atraso(hora: LocalTime): Duration {
        val agora = LocalDateTime.now()
        var alvo = agora.toLocalDate().atTime(hora)
        if (!alvo.isAfter(agora)) alvo = alvo.plusDays(1)
        return Duration.between(agora, alvo)
    }
}

object Notificacoes {
    private const val CANAL = "dieta"

    fun criarCanal(context: Context) {
        context.getSystemService(NotificationManager::class.java)
            .createNotificationChannel(NotificationChannel(CANAL, "Dieta", NotificationManager.IMPORTANCE_DEFAULT))
    }

    fun mostrar(context: Context, id: Int, titulo: String, texto: String) {
        if (android.os.Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val abrir = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        NotificationManagerCompat.from(context).notify(id, NotificationCompat.Builder(context, CANAL)
            .setSmallIcon(R.drawable.ic_notificacao).setContentTitle(titulo).setContentText(texto)
            .setContentIntent(abrir).setAutoCancel(true).build())
    }
}
