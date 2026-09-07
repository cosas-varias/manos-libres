package org.cosasvarias.manoslibres.feedback

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import org.cosasvarias.manoslibres.net.AlertPattern
import org.cosasvarias.manoslibres.net.OptionTone

/**
 * Los cuatro patrones hápticos.
 *
 * Son cuatro y no ocho a propósito: en el bolsillo, con abrigo, no se distinguen más. El
 * protocolo transporta el nombre del patrón; el mapeo a milisegundos vive aquí, en el
 * cliente, porque depende del hardware.
 */
class Haptics(context: Context) {

    private val vibrator: Vibrator =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vm = context.getSystemService(VibratorManager::class.java)
            vm.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Vibrator::class.java)
        }

    fun avisar(pattern: AlertPattern) = when (pattern) {
        AlertPattern.corto -> onda(longArrayOf(0, 40))
        AlertPattern.doble -> onda(longArrayOf(0, 40, 80, 40))
        AlertPattern.largo -> onda(longArrayOf(0, 400))
        AlertPattern.urgente -> onda(longArrayOf(0, 100, 60, 100, 60, 100, 60, 100))
    }

    /**
     * La confirmación de una decisión va por el **tono**, no por la opción elegida: así
     * aprobar algo destructivo se *siente* distinto de aprobar algo inocuo, sin necesidad
     * de leer nada.
     */
    fun confirmar(tone: OptionTone) = when (tone) {
        OptionTone.go -> onda(longArrayOf(0, 30))
        OptionTone.neutral -> onda(longArrayOf(0, 30))
        OptionTone.stop -> onda(longArrayOf(0, 25, 50, 25))
        OptionTone.danger -> onda(longArrayOf(0, 200, 80, 200))
    }

    /** Al entrar y al salir de la aceleración: un pulso mínimo, solo para confirmar. */
    fun tic() = onda(longArrayOf(0, 15))

    private fun onda(ms: LongArray) {
        // TODO(H4): en API 31+ usar VibrationEffect.startComposition() con las primitivas
        // CLICK/TICK/THUD donde el dispositivo las tenga: se distinguen mucho mejor que
        // una onda cuadrada. createWaveform es el respaldo universal.
        val amplitudes = IntArray(ms.size) { i -> if (i % 2 == 0) 0 else 255 }
        vibrator.vibrate(VibrationEffect.createWaveform(ms, amplitudes, -1))
    }
}
