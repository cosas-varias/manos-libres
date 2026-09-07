# 6. Roadmap

La lista granular de lo que falta está en [08-tareas.md](08-tareas.md).

Los hitos están ordenados por lo que hacen posible, no por lo que cuestan. Cada uno debería
poder usarse de verdad antes de empezar el siguiente.

## H0 · Andamiaje  ← estado actual

Lo que hay en este repo: la especificación, el protocolo tipado, el nodo en Go con el
contrato de adaptadores, y el esqueleto de la app con sus módulos separados.

El nodo compila, pasa sus tests y sirve el protocolo de punta a punta contra un agente real:
`go test ./...`, y con `claude` instalado se puede abrir una sesión, mandarle un prompt y ver
los frames bajar por el flujo SSE. Lo que no hay es app instalable, ni emparejamiento, ni
decisiones — el adaptador pide permisos por MCP pero eso está sin verificar contra el CLI.

## H1 · El eslabón mínimo

**Objetivo: hablar con un agente real desde el móvil, aunque sea leyendo.**

- Nodo: **hecho**. Token estático, sesiones, y el CLI de Claude Code como subproceso en
  `stream-json`. Falta verificar el MCP de permisos contra la versión fijada del CLI.
- Protocolo: `hello`, `prompt`, `text.delta`, `message`, `session.state`. **Hecho.**
- App: pantalla única con transcripción y campo de texto. Foreground service que mantiene
  el canal. Cliente `HttpEngine` con QUIC en API 34+, `HttpURLConnection` por debajo.

Se sabe que está terminado cuando se puede lanzar una tarea desde la calle y ver la
respuesta llegar.

## H2 · Que el teléfono te busque

**Objetivo: no volver a mirar la pantalla para saber si terminó.**

- Nodo: hooks `Stop` y `TaskCompleted` → `task.done`. Servidor MCP en proceso con la
  herramienta `avisar`.
- Despliegue con Caddy delante para HTTP/3, que es lo que hace del canal el canal de
  despertar ([07 §3](07-decisiones.md#3--canal-de-despertar-quic-sin-terceros)).
- App: los cuatro patrones hápticos, canal de notificaciones, foreground service que
  sobrevive a Doze (exención de batería, `START_STICKY`, notificación persistente).

Es el hito con mejor relación entre esfuerzo y cambio de experiencia: convierte la espera
ciega en «lanza y olvida».

## H3 · Decisiones a pantalla completa

**Objetivo: desbloquear al agente sin leer.**

- Nodo: `canUseTool` → `decision.request`, con el mapeo de `title`/`displayName`/
  `description`/`suggestions`. Cola de decisiones pendientes por sesión, y reinsistencia del
  aviso a los 30 s y 5 min.
- App: la botonera de franjas, tonos, hápticas por tono, y las acciones en la notificación
  para contestar desde la pantalla de bloqueo.
- Cablear `AskUserQuestion` por el mismo camino y verificar la forma de `updatedInput`
  contra la versión fijada del SDK.

## H4 · Narración

**Objetivo: enterarse de lo que pasa con el móvil en el bolsillo.**

- Nodo: filtro narrable y segmentado en frases. `narration` y la coordenada
  `(messageId, sentence)`. Latido hablado tras N minutos de silencio, con N configurable
  ([07 §10](07-decisiones.md#10--tareas-largas-latido-hablado)).
- App: el narrador con cola propia, `MediaSession`, foco de audio con ducking, y el
  **modo A** (pantalla negra con los siete gestos).
- Reconexión completa con `session.attach {sinceSeq}` y continuidad de narración.

## H5 · Manos libres de verdad

**Objetivo: el móvil no sale del bolsillo.**

- **Modo B**: botones del auricular y teclas de volumen vía `MediaSession`;
  `PROXIMITY_SCREEN_OFF_WAKE_LOCK`.
- Contestar decisiones por N pulsaciones del auricular.
- Entrada por voz con confirmación hablada.

Aquí se cumple el objetivo del enunciado: usar la app sin tocar apenas el móvil y sin leer.

## H6 · Uso diario

**Objetivo: que sobreviva al uso real y a varios proyectos.**

- Varias sesiones en paralelo, con conmutación por voz («pásame a manos-libres»).
- Emparejamiento con QR, claves Ed25519 en el Keystore, revocación de dispositivos.
- Contenerizar el agente. No es higiene: sin `--bare` la sesión ejecuta los hooks del repo
  en el que se abre, y `ALLOWED_ROOTS` no lo cubre (ver [05](05-seguridad.md#superficie-del-agente)).
- Adaptador de un segundo motor, para validar que el contrato de adaptadores aguanta.

## Después

Sin compromiso ni orden:

- Superficie de Wear OS (la botonera de decisión en el reloj es un encaje natural).
- Un cliente de escritorio mínimo reutilizando el mismo protocolo.
- Que el agente pueda pedir una foto de la cámara como parte de una tarea.
- Programar tareas para que arranquen solas y avisen al terminar.
