package org.cosasvarias.manoslibres.input

import android.content.Context
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat

/**
 * Modo B: la pantalla apagada de verdad.
 *
 * Cuando el teléfono no se va a sacar del bolsillo, los gestos táctiles no existen
 * (ver [BlackScreenActivity]). Lo que sí llega es el botón del auricular y —mientras haya
 * una sesión de medios activa— las teclas de volumen.
 *
 * El mapeo mantiene la misma intención que el modo A: **doble = atrás, mantener =
 * acelerar**. Lo que cambia es la superficie, no el vocabulario.
 *
 * Publicar una `MediaSession` tiene una ventaja que no es obvia: la narración pasa a
 * comportarse como cualquier audio del sistema. Se pausa con una llamada, baja de volumen
 * con un aviso, y aparece en los controles de la pantalla de bloqueo y del reloj — que es
 * gratis y es exactamente donde quieres los controles.
 */
class MediaButtons(
    context: Context,
    private val onPausarOSeguir: () -> Unit,
    private val onFrasePrevia: () -> Unit,
    private val onFraseSiguiente: () -> Unit,
    private val onAcelerar: (Boolean) -> Unit,
    /** N pulsaciones = opción N de la decisión pendiente. */
    private val onElegirOpcion: (Int) -> Unit,
) {
    val session = MediaSessionCompat(context, "manos-libres").apply {
        setCallback(object : MediaSessionCompat.Callback() {
            override fun onPlay() = onPausarOSeguir()
            override fun onPause() = onPausarOSeguir()
            override fun onSkipToPrevious() = onFrasePrevia()
            override fun onSkipToNext() = onFraseSiguiente()
            override fun onFastForward() = onAcelerar(true)
            override fun onRewind() = onAcelerar(false)
        })

        // Sin ACTION_SKIP_TO_PREVIOUS/NEXT declaradas, el sistema no encamina la doble y
        // triple pulsación del auricular hasta aquí.
        setPlaybackState(
            PlaybackStateCompat.Builder()
                .setActions(
                    PlaybackStateCompat.ACTION_PLAY_PAUSE or
                        PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                        PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                        PlaybackStateCompat.ACTION_FAST_FORWARD or
                        PlaybackStateCompat.ACTION_REWIND
                )
                .setState(PlaybackStateCompat.STATE_PLAYING, 0, 1f)
                .build()
        )
        isActive = true
    }

    /**
     * TODO(H5): contar pulsaciones con una ventana de 600 ms y encaminarlas a
     * [onElegirOpcion] cuando hay una decisión pendiente, en vez de a la navegación de
     * frases. Es lo que permite contestar sin sacar el móvil.
     */
    fun liberar() {
        session.isActive = false
        session.release()
    }
}
