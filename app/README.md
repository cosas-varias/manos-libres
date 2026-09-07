# app

Cliente Android de Manos Libres. Kotlin + Compose, `minSdk` 29, `targetSdk` 35.

> **Estado:** esqueleto. La estructura, los tipos del protocolo y los módulos están, pero
> **no se ha compilado**: falta el wrapper de Gradle (no se versionan binarios) y varias
> funciones tienen cuerpo `TODO`. Ábrelo en Android Studio, deja que genere el wrapper y
> sincronice, y empieza por H1 del [roadmap](../docs/06-roadmap.md).

## Puesta en marcha

```bash
cd app
gradle wrapper --gradle-version 8.9    # una vez, o deja que lo haga Android Studio
./gradlew installDebug
```

En el primer arranque la app pide la URL del nodo y el token. Para desarrollo, el
`DEV_TOKEN` del `.env` del servidor y `ws://10.0.2.2:8787` desde el emulador.

## Mapa del código

| Fichero | Responsabilidad |
|---|---|
| `net/Protocol.kt` | Los frames de `manos-libres/1` en Kotlin. Réplica de `server/protocolo.go`. |
| `net/AgentClient.kt` | El canal con el nodo: SSE por HTTP/3, reconexión con retroceso exponencial, replay por `Last-Event-ID`. |
| `session/SessionService.kt` | Foreground service: mantiene el canal abierto con la pantalla bloqueada. Que siga vivo es la única garantía de entrega. |
| `speech/Narrator.kt` | Cola de frases sobre `TextToSpeech`. El retroceso y la aceleración viven aquí. |
| `input/BlackScreenActivity.kt` | Modo A: pantalla negra con los siete gestos. |
| `input/MediaButtons.kt` | Modo B: `MediaSession`, botones del auricular y teclas de volumen. |
| `ui/DecisionScreen.kt` | La botonera de franjas a pantalla completa. |
| `ui/TranscriptScreen.kt` | La pantalla que casi nunca se mira. |
| `feedback/Haptics.kt` | Los cuatro patrones de vibración. |

## Permisos y por qué

| Permiso | Para qué |
|---|---|
| `INTERNET` | El canal contra el nodo. |
| `FOREGROUND_SERVICE` + `..._MEDIA_PLAYBACK` | Mantener el canal y la narración con el móvil bloqueado. Se declara como reproducción de medios porque narrar *es* reproducir audio: así el sistema lo respeta y aparece en los controles de la pantalla de bloqueo. |
| `POST_NOTIFICATIONS` | Los avisos y las decisiones contestables desde la pantalla de bloqueo. |
| `VIBRATE` | Los cuatro patrones hápticos. |
| `WAKE_LOCK` | `PROXIMITY_SCREEN_OFF_WAKE_LOCK` para el modo bolsillo. |
| `USE_FULL_SCREEN_INTENT` | Que una decisión llegue a pantalla completa con el móvil bloqueado. |

No se pide micrófono todavía: la entrada por voz llega en H5 y usará el reconocedor del
sistema por intent, que no requiere el permiso.

`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` se pedirá en H2, cuando el canal siempre abierto sea
la única vía de aviso: sin la exención, el ahorro de batería puede cortar la conexión y no
hay push que despierte la app
([07 §3](../docs/07-decisiones.md#3--canal-de-despertar-quic-sin-terceros)).
