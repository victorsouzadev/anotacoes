package com.organizador.app.data.remote

import com.organizador.app.data.local.SettingsStore
import com.organizador.app.domain.model.Priority
import com.organizador.app.domain.nlp.ParsedTask
import com.organizador.app.domain.nlp.TaskInterpreter
import com.organizador.app.domain.nlp.buildHints
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/**
 * Calls an OpenRouter chat-completions model (openrouter.ai, OpenAI-compatible API) to turn
 * free-form Portuguese text into one or more tasks (each with an optional category, priority and
 * checklist of subtasks), as a richer alternative to
 * [com.organizador.app.domain.nlp.NaturalLanguageTaskParser]'s local regex parsing.
 * Requires an API key and model id configured in Settings; both are read fresh on every call so
 * changes in Settings take effect immediately without recreating this interpreter.
 */
class OpenRouterTaskInterpreter(
    private val settingsStore: SettingsStore,
) : TaskInterpreter {

    override suspend fun interpret(rawInput: String, reference: LocalDateTime): Result<List<ParsedTask>> =
        withContext(Dispatchers.IO) {
            val apiKey = settingsStore.getApiKey()
                ?: return@withContext Result.failure(
                    IllegalStateException("Configure sua chave de API da OpenRouter em Configurações"),
                )
            val model = settingsStore.getModel()
            runCatching {
                val responseBody = postToOpenRouter(apiKey, model, buildRequestBody(model, rawInput, reference))
                parseResponse(responseBody, reference)
            }
        }

    private fun buildRequestBody(model: String, rawInput: String, reference: LocalDateTime): String {
        val system = """
            Você extrai uma ou mais tarefas pessoais de um texto em português. O texto pode descrever
            várias tarefas distintas (uma por linha, por tópico ou por frase) e cada tarefa pode ter
            subtarefas (itens de checklist menores dentro dela).
            Responda SOMENTE com um objeto JSON válido, sem markdown e sem texto adicional, no formato exato:
            {"tasks": [{"title": string, "due_date": string ou null, "category": string ou null, "priority": string ou null, "subtasks": [string, ...]}]}
            Regras:
            - Cada elemento de "tasks" é uma tarefa distinta. Se o texto descrever só uma tarefa, retorne um array com um único elemento.
            - "title": o texto da tarefa sem a data/hora, sem a #categoria e sem as palavras que indicam prioridade.
            - "due_date": data/hora do prazo no formato "yyyy-MM-dd'T'HH:mm:ss", ou null se não houver prazo. Se só houver data (sem hora), use "23:59:00".
            - "category": nome da categoria sem o "#", ou null se não houver. Cada tarefa pode ter uma categoria diferente.
            - "priority": "HIGH", "MEDIUM" ou "LOW" refletindo urgência explícita no texto daquela tarefa, ou null se não houver indício.
            - "subtasks": itens de checklist menores dessa tarefa (sem data/prioridade própria), ou [] se não houver nenhum.
            A data/hora de referência (agora) é ${reference.format(DateTimeFormatter.ISO_LOCAL_DATE_TIME)}.
        """.trimIndent()

        val messages = JSONArray()
            .put(JSONObject().put("role", "system").put("content", system))
            .put(JSONObject().put("role", "user").put("content", rawInput))

        return JSONObject()
            .put("model", model)
            .put("max_tokens", 1000)
            .put("messages", messages)
            .toString()
    }

    private fun postToOpenRouter(apiKey: String, model: String, jsonBody: String): String {
        val connection = URL(OPENROUTER_CHAT_COMPLETIONS_URL).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            connection.setRequestProperty("content-type", "application/json")
            connection.setRequestProperty("Authorization", "Bearer $apiKey")
            connection.setRequestProperty("HTTP-Referer", "https://github.com/victorsouzadev/tasks-organization")
            connection.setRequestProperty("X-Title", "Organizador")

            connection.outputStream.use { it.write(jsonBody.toByteArray(Charsets.UTF_8)) }

            val responseCode = connection.responseCode
            val stream = if (responseCode in 200..299) connection.inputStream else connection.errorStream
            val body = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (responseCode !in 200..299) {
                throw IOException("A OpenRouter respondeu $responseCode para o modelo \"$model\": ${body.take(300)}")
            }
            return body
        } finally {
            connection.disconnect()
        }
    }

    private fun parseResponse(responseBody: String, reference: LocalDateTime): List<ParsedTask> {
        val choices = JSONObject(responseBody).getJSONArray("choices")
        if (choices.length() == 0) throw IOException("Resposta da IA sem conteúdo")
        val text = choices.getJSONObject(0)
            .getJSONObject("message")
            .optString("content")
            .takeIf { it.isNotBlank() }
            ?: throw IOException("Resposta da IA sem conteúdo de texto")

        val root = JSONObject(extractJsonObject(text))
        val tasksArray = root.optJSONArray("tasks")

        val taskObjects = when {
            tasksArray != null && tasksArray.length() > 0 -> (0 until tasksArray.length()).map(tasksArray::getJSONObject)
            root.has("title") -> listOf(root)
            else -> throw IOException("A IA não retornou nenhuma tarefa reconhecível")
        }

        return taskObjects.map { parseTaskObject(it, reference) }
    }

    private fun parseTaskObject(extracted: JSONObject, reference: LocalDateTime): ParsedTask {
        val today = reference.toLocalDate()

        val title = extracted.optString("title").trim().ifBlank { "Tarefa sem título" }

        val dueDateTime = extracted.optString("due_date").takeIf { it.isNotBlank() }
            ?.let { runCatching { LocalDateTime.parse(it) }.getOrNull() }

        val category = extracted.optString("category").trim().takeIf { it.isNotBlank() }

        val priority = extracted.optString("priority").trim().takeIf { it.isNotBlank() }
            ?.let { runCatching { Priority.valueOf(it.uppercase()) }.getOrNull() }

        val hasExplicitTime = dueDateTime != null && dueDateTime.toLocalTime() != LocalTime.of(23, 59)

        val subtasks = extracted.optJSONArray("subtasks")?.let { array ->
            (0 until array.length()).mapNotNull { index -> array.optString(index).trim().takeIf(String::isNotBlank) }
        }.orEmpty()

        val baseHints = buildHints(dueDateTime, hasExplicitTime, category, priority, today)
        val hints = (if (subtasks.isNotEmpty()) baseHints + "${subtasks.size} subtarefa(s)" else baseHints)
            .ifEmpty { listOf("A IA não identificou prazo, categoria ou prioridade nessa tarefa") }

        return ParsedTask(
            cleanTitle = title,
            dueDateTime = dueDateTime,
            hasExplicitTime = hasExplicitTime,
            categoryName = category,
            priority = priority,
            hints = hints,
            subtasks = subtasks,
        )
    }

    private fun extractJsonObject(text: String): String {
        val start = text.indexOf('{')
        val end = text.lastIndexOf('}')
        if (start < 0 || end <= start) throw IOException("Resposta da IA não continha um JSON reconhecível")
        return text.substring(start, end + 1)
    }

    private companion object {
        const val OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions"
    }
}
