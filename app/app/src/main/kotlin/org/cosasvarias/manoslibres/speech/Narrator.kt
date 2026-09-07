package org.cosasvarias.manoslibres.speech

import android.content.Context
import android.media.AudioAttributes
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale

/**
 * El narrador.
 *
 * Gestiona su propia cola en vez de dejársela a Android, y eso es lo que hace baratos el
 * retroceso y el salto: no hay que buscar dentro de un audio, solo mover un índice y volver
 * a encolar desde ahí.
 *
 * ```
 * cola  ──►  [ m13/0 ][ m13/1 ][ m13/2 ][ m14/0 ] ...
 *                        ▲
 *                     cursor
 * ```
 *
 * Cada frase se encola con `utteranceId = "<messageId>/<índice>"`, que es exactamente la
 * coordenada de narración del protocolo. `UtteranceProgressListener` avanza el cursor, y
 * ese par es lo que se manda al nodo en el frame `narration`.
 */
class Narrator(
    context: Context,
    private val onPosicion: (messageId: String, sentence: Int) -> Unit,
) {
    /** Una frase encolada, con su coordenada. */
    data class Frase(val messageId: String, val indice: Int, val texto: String) {
        val utteranceId get() = "$messageId/$indice"
    }

    private val cola = mutableListOf<Frase>()
    private var cursor = 0
    private var listo = false
    private var velocidadReposo = 1.0f

    private val tts = TextToSpeech(context) { status ->
        if (status != TextToSpeech.SUCCESS) return@TextToSpeech
        listo = true
        tts.language = Locale.getDefault()
        // USAGE_ASSISTANT con ducking: la narración se mezcla por encima de la música en
        // vez de matarla. Es lo que la distingue de un reproductor.
        tts.setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()
        )
        tts.setSpeechRate(velocidadReposo)
        arrancar()
    }.apply {
        setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {
                val f = cola.getOrNull(cursor) ?: return
                onPosicion(f.messageId, f.indice)
            }
            override fun onDone(utteranceId: String?) {
                cursor += 1
                arrancar()
            }
            @Deprecated("la firma sin errorCode está obsoleta pero es la que llama el sistema")
            override fun onError(utteranceId: String?) {
                cursor += 1
                arrancar()
            }
        })
    }

    // ── Alimentar la cola ──────────────────────────────────────────────────────

    /** Encola un mensaje ya segmentado por el nodo. */
    fun encolar(messageId: String, frases: List<String>) {
        frases.forEachIndexed { i, texto -> cola += Frase(messageId, i, texto) }
        arrancar()
    }

    /**
     * Un aviso se dice **entre** frases, no encima de la actual: interrumpir a mitad de
     * frase para decir «tarea terminada» hace perder el hilo de las dos cosas.
     */
    fun intercalar(texto: String) {
        cola.add(minOf(cursor + 1, cola.size), Frase("aviso", 0, texto))
    }

    /** Una decisión sí interrumpe: bloquea al agente, es lo más importante del momento. */
    fun interrumpirCon(texto: String) {
        tts.stop()
        cola.add(cursor, Frase("decision", 0, texto))
        arrancar()
    }

    // ── Los gestos ─────────────────────────────────────────────────────────────

    /** Doble toque, o doble pulsación en el auricular. */
    fun frasePrevia() {
        cursor = maxOf(0, cursor - 1)
        reencolar()
    }

    fun fraseSiguiente() {
        cursor = minOf(cola.size, cursor + 1)
        reencolar()
    }

    /** Mantener pulsado: ×2 mientras se mantiene, ×1 al soltar. */
    fun acelerar(activo: Boolean) {
        tts.setSpeechRate(if (activo) velocidadReposo * 2f else velocidadReposo)
        // El cambio de velocidad no afecta a lo ya encolado: hay que reencolar para que
        // se note en la frase en curso.
        reencolar()
    }

    fun velocidadReposo(v: Float) {
        velocidadReposo = v
        tts.setSpeechRate(v)
    }

    fun pausarOSeguir(): Boolean {
        return if (tts.isSpeaking) {
            tts.stop()
            false
        } else {
            reencolar()
            true
        }
    }

    /** Deslizar arriba: repetir el mensaje entero desde su primera frase. */
    fun repetirMensaje() {
        val actual = cola.getOrNull(cursor) ?: return
        cursor = cola.indexOfFirst { it.messageId == actual.messageId }.coerceAtLeast(0)
        reencolar()
    }

    fun detener() {
        tts.stop()
    }

    fun liberar() {
        tts.stop()
        tts.shutdown()
    }

    // ── Motor ──────────────────────────────────────────────────────────────────

    private fun arrancar() {
        if (!listo || tts.isSpeaking) return
        val f = cola.getOrNull(cursor) ?: return
        hablar(f, TextToSpeech.QUEUE_ADD)
    }

    private fun reencolar() {
        if (!listo) return
        tts.stop()
        val f = cola.getOrNull(cursor) ?: return
        hablar(f, TextToSpeech.QUEUE_FLUSH)
    }

    private fun hablar(f: Frase, modo: Int) {
        tts.speak(f.texto, modo, null, f.utteranceId)
    }
}
