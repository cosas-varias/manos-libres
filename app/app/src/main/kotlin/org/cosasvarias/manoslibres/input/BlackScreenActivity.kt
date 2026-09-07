package org.cosasvarias.manoslibres.input

import android.os.Bundle
import android.view.MotionEvent
import android.view.WindowManager
import androidx.activity.ComponentActivity

/**
 * Modo A: la pantalla negra.
 *
 * El límite que hay que decir en voz alta: **con la pantalla físicamente apagada, Android
 * no entrega eventos táctiles a una app.** El digitalizador se apaga, y los pocos gestos
 * que sobreviven (el doble toque para despertar) son del sistema y no son interceptables.
 * No hay permiso ni API que lo cambie.
 *
 * Así que esto hace lo siguiente mejor: una superficie negra a pantalla completa con el
 * brillo a cero. La pantalla está encendida pero invisible — en un panel OLED consume
 * prácticamente lo mismo que apagada, y el usuario ve exactamente lo que vería con la
 * pantalla apagada, o sea nada. A cambio, los gestos son táctiles de verdad y ocupan toda
 * la superficie del móvil.
 *
 * El vocabulario completo está en docs/04-ux-manos-libres.md. Aquí solo se detecta; quien
 * actúa es el `Narrator` a través del servicio.
 *
 * TODO(H4): combinar con PROXIMITY_SCREEN_OFF_WAKE_LOCK, para que al meter el móvil en el
 * bolsillo el sensor apague la pantalla de verdad y desactive los toques fantasma.
 */
class BlackScreenActivity : ComponentActivity() {

    private lateinit var gestos: GestureReader

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.attributes = window.attributes.apply {
            // 0f, no BRIGHTNESS_OVERRIDE_OFF: queremos la pantalla encendida (para recibir
            // toques) pero sin emitir luz.
            screenBrightness = 0f
        }

        // TODO(H4): enlazar con SessionService para obtener el Narrator y el Haptics.
        gestos = GestureReader(
            onToque = { /* pausarOSeguir() */ },
            onDobleToque = { /* frasePrevia() */ },
            onMantener = { activo -> /* acelerar(activo) */ },
            onDeslizar = { dir ->
                when (dir) {
                    Direccion.DERECHA -> Unit  // fraseSiguiente()
                    Direccion.IZQUIERDA -> Unit // mensajeAnterior()
                    Direccion.ARRIBA -> Unit    // repetirMensaje()
                    Direccion.ABAJO -> finish() // salir del modo narración
                }
            },
            onDosDedos = { /* decir el estado del agente */ },
        )
    }

    override fun onTouchEvent(event: MotionEvent): Boolean = gestos.procesar(event)
}

enum class Direccion { ARRIBA, ABAJO, IZQUIERDA, DERECHA }

/**
 * Reconocedor de los siete gestos.
 *
 * No se usa `GestureDetector` del sistema porque su «long press» es un evento puntual y
 * aquí hace falta saber cuándo se *suelta*: la aceleración dura lo que dura la pulsación.
 *
 * TODO(H4): implementar. Umbrales de partida: doble toque 300 ms, mantener 400 ms,
 * deslizamiento 15 % de la dimensión de la pantalla.
 */
class GestureReader(
    private val onToque: () -> Unit,
    private val onDobleToque: () -> Unit,
    private val onMantener: (Boolean) -> Unit,
    private val onDeslizar: (Direccion) -> Unit,
    private val onDosDedos: () -> Unit,
) {
    fun procesar(event: MotionEvent): Boolean = false
}
