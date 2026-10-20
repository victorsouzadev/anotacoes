package com.casa.app

import android.Manifest
import android.app.Application
import android.content.ContentProvider
import android.content.ContentUris
import android.content.ContentValues
import android.content.pm.ProviderInfo
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.provider.CalendarContract
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** Provedor de agenda em memória: uma agenda gravável e uma tabela de eventos. */
class AgendaFalsa : ContentProvider() {
    val eventos = linkedMapOf<Long, ContentValues>()
    private var proximo = 1L
    override fun onCreate() = true
    override fun getType(uri: Uri): String? = null
    override fun query(uri: Uri, p: Array<out String>?, s: String?, a: Array<out String>?, o: String?): Cursor {
        val c = MatrixCursor(arrayOf(CalendarContract.Calendars._ID, CalendarContract.Calendars.CALENDAR_DISPLAY_NAME, CalendarContract.Calendars.ACCOUNT_NAME))
        c.addRow(arrayOf<Any>(7L, "Pessoal", "victor@exemplo.com")); return c
    }
    override fun insert(uri: Uri, v: ContentValues?): Uri { val id = proximo++; eventos[id] = ContentValues(v); return ContentUris.withAppendedId(uri, id) }
    override fun update(uri: Uri, v: ContentValues?, s: String?, a: Array<out String>?): Int {
        val id = ContentUris.parseId(uri); if (id !in eventos) return 0; eventos[id] = ContentValues(v); return 1
    }
    override fun delete(uri: Uri, s: String?, a: Array<out String>?): Int = if (eventos.remove(ContentUris.parseId(uri)) != null) 1 else 0
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AgendaTest {
    private lateinit var falsa: AgendaFalsa
    private val app get() = ApplicationProvider.getApplicationContext<Application>()

    @Before fun prepara() {
        shadowOf(app).grantPermissions(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR)
        falsa = Robolectric.buildContentProvider(AgendaFalsa::class.java).create(ProviderInfo().apply { authority = CalendarContract.AUTHORITY }).get()
    }

    private fun estado(semana: String, vararg a: Atribuicao) = Estado(
        euId = 1, euAdmin = true, agendaUrl = null, casaNome = "Casa", codigo = "X", modo = "pontos", semana = semana, hoje = semana,
        membros = emptyList(), tarefas = emptyList(), atribuicoes = a.toList(), placar = emptyList(), preferencias = emptyMap(),
        condicoes = emptyList(), condicoesDoDia = emptyMap(),
    )

    @Test fun criaAtualizaEApaga() {
        val louca = Atribuicao(10, 1, "Lavar a louça", 1, "2026-10-20", 2, false, "20:00", 20)
        val lixo = Atribuicao(11, 2, "Tirar o lixo", 1, "2026-10-21", 1, false)
        val daVitoria = Atribuicao(12, 3, "Cozinhar", 2, "2026-10-20", 3, false, "19:00", 60)
        assertEquals(listOf("Pessoal"), Agenda.calendarios(app).map { it.nome })
        Agenda.escolher(app, 7, estado("2026-10-19", louca, lixo, daVitoria))
        assertEquals("só as minhas", 2, falsa.eventos.size)
        val ev = falsa.eventos.values.first { it.getAsString(CalendarContract.Events.TITLE) == "Lavar a louça" }
        // 20:00 em São Paulo (-03) = 23:00 UTC; 20 minutos de duração.
        assertEquals(java.time.Instant.parse("2026-10-20T23:00:00Z").toEpochMilli(), ev.getAsLong(CalendarContract.Events.DTSTART))
        assertEquals(20 * 60_000L, ev.getAsLong(CalendarContract.Events.DTEND) - ev.getAsLong(CalendarContract.Events.DTSTART))
        val diaInteiro = falsa.eventos.values.first { it.getAsString(CalendarContract.Events.TITLE) == "Tirar o lixo" }
        assertEquals(1, diaInteiro.getAsInteger(CalendarContract.Events.ALL_DAY))

        // Feita → mesmo evento, com ✓; lixo passou para outra pessoa → sai da agenda.
        Agenda.sincronizar(app, estado("2026-10-19", louca.copy(feito = true)))
        assertEquals(1, falsa.eventos.size)
        assertEquals("✓ Lavar a louça", falsa.eventos.values.single().getAsString(CalendarContract.Events.TITLE))

        // Semana nova: o evento da semana passada fica como histórico.
        Agenda.sincronizar(app, estado("2026-10-26", Atribuicao(20, 1, "Lavar a louça", 1, "2026-10-27", 2, false)))
        assertEquals(2, falsa.eventos.size)

        Agenda.desligar(app)
        assertTrue("desligar apaga os eventos que o app controla agora", falsa.eventos.values.none { it.getAsString(CalendarContract.Events.TITLE) == "Lavar a louça" && it.getAsInteger(CalendarContract.Events.ALL_DAY) == 1 })
    }
}
