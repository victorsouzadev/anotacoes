package com.casa.app

import android.Manifest
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CalendarContract.Calendars
import android.provider.CalendarContract.Events
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset

/**
 * Põe as minhas tarefas da semana numa agenda do celular (a do Google, por exemplo), como eventos:
 * com horário de preferência vira evento com hora; sem horário, evento de dia inteiro. Cada
 * sincronização cria, atualiza e apaga os eventos desta semana para bater com a divisão atual;
 * eventos de semanas passadas ficam na agenda como histórico.
 */
object Agenda {
    data class Calendario(val id: Long, val nome: String, val conta: String)

    val PERMISSOES = arrayOf(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR)
    private val FUSO = ZoneId.of("America/Sao_Paulo")

    private fun prefs(c: Context) = c.getSharedPreferences("casa", Context.MODE_PRIVATE)
    fun temPermissao(c: Context) = PERMISSOES.all { ContextCompat.checkSelfPermission(c, it) == PackageManager.PERMISSION_GRANTED }
    fun calendarioEscolhido(c: Context): Long? = prefs(c).getLong("agenda_calendario", -1).takeIf { it >= 0 && temPermissao(c) }

    /** Agendas do celular em que dá para escrever. */
    fun calendarios(c: Context): List<Calendario> {
        if (!temPermissao(c)) return emptyList()
        val lista = mutableListOf<Calendario>()
        c.contentResolver.query(
            Calendars.CONTENT_URI, arrayOf(Calendars._ID, Calendars.CALENDAR_DISPLAY_NAME, Calendars.ACCOUNT_NAME),
            "${Calendars.CALENDAR_ACCESS_LEVEL} >= ? AND ${Calendars.VISIBLE} = 1", arrayOf(Calendars.CAL_ACCESS_CONTRIBUTOR.toString()), null,
        )?.use { cur -> while (cur.moveToNext()) lista += Calendario(cur.getLong(0), cur.getString(1) ?: "Agenda", cur.getString(2) ?: "") }
        return lista
    }

    fun escolher(c: Context, id: Long, e: Estado?) {
        val anterior = calendarioEscolhido(c)
        if (anterior != null && anterior != id) apagarTodos(c)
        prefs(c).edit().putLong("agenda_calendario", id).apply()
        if (e != null) sincronizar(c, e)
    }

    fun desligar(c: Context) {
        apagarTodos(c)
        prefs(c).edit().remove("agenda_calendario").apply()
    }

    // atribuição → [id do evento, dia]
    private fun mapa(c: Context) = JSONObject(prefs(c).getString("agenda_eventos", "{}") ?: "{}")
    private fun salvarMapa(c: Context, m: JSONObject) = prefs(c).edit().putString("agenda_eventos", m.toString()).apply()

    @Synchronized
    fun sincronizar(c: Context, e: Estado) {
        val cal = calendarioEscolhido(c) ?: return
        try {
            val cr = c.contentResolver
            val antigo = mapa(c)
            val novo = JSONObject()
            for (a in e.atribuicoes.filter { it.membroId == e.euId && it.naoFeita == null }) {
                val v = valores(a, e, cal)
                val idEvento = antigo.optJSONArray(a.id.toString())?.optLong(0)
                val atualizou = idEvento != null && cr.update(ContentUris.withAppendedId(Events.CONTENT_URI, idEvento), v, null, null) == 1
                val id = if (atualizou) idEvento!! else cr.insert(Events.CONTENT_URI, v)?.let { ContentUris.parseId(it) } ?: continue
                novo.put(a.id.toString(), org.json.JSONArray().put(id).put(a.dia))
            }
            // O que era desta semana e saiu da divisão (passou para outra pessoa, tarefa removida…) sai da agenda.
            for (k in antigo.keys()) {
                if (novo.has(k)) continue
                val par = antigo.getJSONArray(k)
                if (par.optString(1) >= e.semana) cr.delete(ContentUris.withAppendedId(Events.CONTENT_URI, par.getLong(0)), null, null)
            }
            salvarMapa(c, novo)
        } catch (ex: Exception) {
            Registro.aviso("agenda_falhou", ex)
        }
    }

    private fun valores(a: Atribuicao, e: Estado, cal: Long) = ContentValues().apply {
        val dia = LocalDate.parse(a.dia)
        put(Events.CALENDAR_ID, cal)
        put(Events.TITLE, (if (a.feito) "✓ " else "") + a.tarefa)
        put(Events.DESCRIPTION, "${a.pontos} pt · casa ${e.casaNome} (app Casa)")
        if (a.horario != null) {
            val inicio = dia.atTime(LocalTime.parse(a.horario)).atZone(FUSO)
            put(Events.DTSTART, inicio.toInstant().toEpochMilli())
            put(Events.DTEND, inicio.plusMinutes(a.duracao.toLong()).toInstant().toEpochMilli())
            put(Events.EVENT_TIMEZONE, FUSO.id)
            put(Events.ALL_DAY, 0)
        } else {
            // Dia inteiro: o Android exige meia-noite em UTC.
            put(Events.DTSTART, dia.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
            put(Events.DTEND, dia.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
            put(Events.EVENT_TIMEZONE, "UTC")
            put(Events.ALL_DAY, 1)
        }
        put(Events.AVAILABILITY, Events.AVAILABILITY_FREE)
    }

    private fun apagarTodos(c: Context) {
        if (!temPermissao(c)) return
        val m = mapa(c)
        for (k in m.keys()) runCatching { c.contentResolver.delete(ContentUris.withAppendedId(Events.CONTENT_URI, m.getJSONArray(k).getLong(0)), null, null) }
        salvarMapa(c, JSONObject())
    }
}
