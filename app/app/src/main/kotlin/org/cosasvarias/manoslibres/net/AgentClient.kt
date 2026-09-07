package org.cosasvarias.manoslibres.net

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit
import kotlin.math.min

/**
 * El canal con el nodo.
 *
 * El móvil pierde la conexión constantemente: cambia de wifi a datos, se duerme, entra en
 * el metro. Así que el cliente asume que la desconexión es el estado normal y la
 * reconexión tiene que ser invisible:
 *
 *  · reintento con retroceso exponencial, con tope de 30 s;
 *  · `sinceSeq` por sesión, para que el nodo reenvíe solo lo que falta;
 *  · el narrador **no se para** al perder la conexión: sigue leyendo lo que tiene en cola,
 *    que es exactamente lo que uno espera cuando le llega una notificación de nada.
 */
class AgentClient(
    private val url: String,
    private val token: String,
    private val device: String,
    private val scope: CoroutineScope,
) {
    private val http = OkHttpClient.Builder()
        // El nodo espera un ping cada 20 s; OkHttp lo manda a nivel de protocolo.
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    private var ws: WebSocket? = null
    private var reintento = 0

    /** Último `seq` visto por sesión. Lo que se manda como `sinceSeq` al reconectar. */
    private val ultimoSeq = mutableMapOf<String, Long>()

    private val _frames = MutableSharedFlow<ServerFrame>(replay = 0, extraBufferCapacity = 256)
    val frames: SharedFlow<ServerFrame> = _frames

    fun conectar() {
        val req = Request.Builder().url(url).build()
        ws = http.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: okhttp3.Response) {
                reintento = 0
                enviar(ClientFrame.Auth(token = token, device = device))
                // Re-suscribirse a lo que ya se seguía, pidiendo solo lo perdido.
                ultimoSeq.forEach { (sessionId, seq) ->
                    enviar(ClientFrame.SessionAttach(sessionId, seq))
                }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val frame = runCatching { protocolJson.decodeFromString<ServerFrame>(text) }
                    .getOrNull() ?: return   // frame desconocido: se ignora, por diseño
                val seq = frame.seqOrZero
                if (seq > 0) sessionIdDe(frame)?.let { ultimoSeq[it] = seq }
                scope.launch { _frames.emit(frame) }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: okhttp3.Response?) {
                reconectar()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                // 4001 = el nodo nos echó por no autenticarnos. Reintentar no ayuda.
                if (code != 4001) reconectar()
            }
        })
    }

    fun enviar(frame: ClientFrame) {
        ws?.send(protocolJson.encodeToString(ClientFrame.serializer(), frame))
    }

    fun cerrar() {
        ws?.close(1000, null)
        ws = null
    }

    private fun reconectar() {
        val espera = min(30_000L, 1000L shl min(reintento, 5))
        reintento += 1
        scope.launch {
            delay(espera)
            conectar()
        }
    }

    private fun sessionIdDe(frame: ServerFrame): String? = when (frame) {
        is ServerFrame.State -> frame.sessionId
        is ServerFrame.Delta -> frame.sessionId
        is ServerFrame.Message -> frame.sessionId
        is ServerFrame.Tool -> frame.sessionId
        is ServerFrame.DecisionRequest -> frame.sessionId
        is ServerFrame.DecisionResolved -> frame.sessionId
        is ServerFrame.Alert -> frame.sessionId
        is ServerFrame.TaskDone -> frame.sessionId
        else -> null
    }
}
