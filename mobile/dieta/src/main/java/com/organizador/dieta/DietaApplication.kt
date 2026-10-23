package com.organizador.dieta

import android.app.Application
import com.organizador.dieta.data.Agendador
import com.organizador.dieta.data.Api
import com.organizador.dieta.data.DietaDb
import com.organizador.dieta.data.Notificacoes
import com.organizador.dieta.data.Prefs
import com.organizador.dieta.data.Repo
import com.organizador.dieta.data.Sincronizador
import com.organizador.dieta.widget.Widgets

/** Monta as dependências uma vez (sem framework de injeção, como o app de Tarefas). */
class DietaApplication : Application() {
    val db by lazy { DietaDb.criar(this) }
    val prefs by lazy { Prefs(this) }
    val api by lazy { Api(prefs) }
    // Toda gravação local pede sync e redesenha os widgets da tela inicial.
    val repo by lazy { Repo(this, db, prefs) { Agendador.syncAgora(this); Widgets.atualizar(this) } }
    val sincronizador by lazy { Sincronizador(this, repo, api) }

    override fun onCreate() {
        super.onCreate()
        Notificacoes.criarCanal(this)
        Agendador.agendarTudo(this)
    }
}
