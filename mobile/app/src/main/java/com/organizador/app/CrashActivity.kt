package com.organizador.app

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * Plain-View fallback screen shown after an uncaught crash (see [OrganizadorApplication]).
 * Deliberately avoids Compose so it still renders if the crash happened inside Compose itself,
 * and lets the user copy the stack trace to report it since this build has no crash reporting service.
 */
class CrashActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val stackTrace = intent?.getStringExtra(EXTRA_STACK_TRACE).orEmpty()

        val padding = (16 * resources.displayMetrics.density).toInt()

        val textView = TextView(this).apply {
            text = "O app encontrou um erro inesperado.\n\nToque em \"Copiar\" e envie este texto.\n\n$stackTrace"
            setPadding(padding, padding, padding, padding)
            setTextIsSelectable(true)
        }

        val copyButton = Button(this).apply {
            text = "Copiar erro"
            setOnClickListener {
                val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText("Erro do Organizador", stackTrace))
            }
        }

        val closeButton = Button(this).apply {
            text = "Fechar"
            setOnClickListener { finish() }
        }

        val buttonRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(padding, padding, padding, padding)
            addView(copyButton)
            addView(closeButton)
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(ScrollView(this@CrashActivity).apply { addView(textView) }, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f,
            ))
            addView(buttonRow)
        }

        setContentView(root)
    }

    companion object {
        const val EXTRA_STACK_TRACE = "stack_trace"
    }
}
