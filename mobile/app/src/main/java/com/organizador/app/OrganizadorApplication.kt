package com.organizador.app

import android.app.Application
import android.content.Intent
import android.os.Process
import android.util.Log
import com.organizador.app.di.AppContainer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlin.system.exitProcess

class OrganizadorApplication : Application() {

    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        installCrashHandler()

        // One-shot maintenance sweep, not worth a full WorkManager job for something this cheap.
        CoroutineScope(Dispatchers.IO).launch {
            container.taskRepository.purgeOldTrash()
        }

        // Sincroniza com o hub ao abrir o app, se já houver login — sem isso, tarefas criadas em
        // outro dispositivo só apareceriam depois de um toque manual em "Sincronizar agora" nas
        // Configurações. Silencioso: falha de rede aqui não deve incomodar quem só quer usar o
        // app offline.
        if (container.authRepository.isLoggedIn.value) {
            CoroutineScope(Dispatchers.IO).launch {
                container.tasksSyncRepository.sync()
            }
        }
    }

    /**
     * Temporary diagnostic aid: this build has no crash reporting service, so an uncaught
     * exception would otherwise just show the generic system "app stopped" dialog with no way
     * to read the stack trace. Routes it to [CrashActivity] instead so it can be copied and reported.
     */
    private fun installCrashHandler() {
        val previousHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                val stackTrace = Log.getStackTraceString(throwable)
                val intent = Intent(this, CrashActivity::class.java).apply {
                    putExtra(CrashActivity.EXTRA_STACK_TRACE, stackTrace)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
                }
                startActivity(intent)
            } catch (_: Throwable) {
                // Fall through to the previous handler below if we can't even show the crash screen.
            } finally {
                previousHandler?.uncaughtException(thread, throwable)
                Process.killProcess(Process.myPid())
                exitProcess(1)
            }
        }
    }
}
