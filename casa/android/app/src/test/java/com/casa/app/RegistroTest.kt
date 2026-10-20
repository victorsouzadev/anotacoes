package com.casa.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Sem servidor alcançável o registro fica na fila local, com no máximo 50 itens. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RegistroTest {
    @Test fun guardaNaFilaSemRede() {
        val c = ApplicationProvider.getApplicationContext<Context>()
        c.getSharedPreferences("casa", Context.MODE_PRIVATE).edit().putString("servidor", "http://127.0.0.1:9").commit()
        Registro.iniciar(c)
        repeat(60) { Registro.erro("teste", IllegalStateException("falha $it")) }
        Thread.sleep(3000)
        val fila = JSONArray(c.getSharedPreferences("casa_logs", Context.MODE_PRIVATE).getString("fila", "[]"))
        assertTrue("fila: ${fila.length()}", fila.length() in 1..50)
        val ultimo = fila.getJSONObject(fila.length() - 1)
        assertEquals("erro", ultimo.getString("nivel"))
        assertTrue(ultimo.getString("mensagem").startsWith("IllegalStateException: falha"))
    }
}
