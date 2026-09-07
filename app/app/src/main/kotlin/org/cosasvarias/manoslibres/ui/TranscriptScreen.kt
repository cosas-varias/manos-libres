package org.cosasvarias.manoslibres.ui

import androidx.compose.runtime.Composable
import org.cosasvarias.manoslibres.net.ServerFrame

/**
 * La pantalla que casi nunca se mira.
 *
 * Existe para los momentos en que sí quieres leer: revisar qué dijo el agente, comprobar
 * un nombre de fichero, escribir un prompt largo. Deliberadamente no se optimiza: la
 * experiencia que este proyecto quiere mejorar es la otra.
 *
 * Cosas que sí importan aquí:
 *  · el texto completo, sin el filtro narrable — el código se ve como código;
 *  · un indicador de estado grande, porque es lo único que se consulta de un vistazo;
 *  · un botón para entrar en modo narración que no haya que buscar.
 *
 * TODO(H1): implementar con una LazyColumn sobre los frames y un campo de texto al pie.
 */
@Composable
fun TranscriptScreen(
    frames: List<ServerFrame>,
    onPrompt: (String) -> Unit,
    onNarrar: () -> Unit,
) {
    // TODO(H1)
}
