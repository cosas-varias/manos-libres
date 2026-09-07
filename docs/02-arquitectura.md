# 2. Arquitectura

## Componentes

| Componente | Qué es | Dónde vive |
|---|---|---|
| **nodo** | Servidor Go, sin dependencias fuera de la biblioteca estándar. Mantiene las sesiones de agente, normaliza sus eventos al protocolo y sirve el canal. | Tu máquina |
| **adaptador** | Traductor entre un motor de agente concreto y el protocolo. Uno por motor. | dentro del nodo |
| **app** | Cliente Android (Kotlin + Compose). Narra, vibra y presenta decisiones. | Tu teléfono |

Nada más. No hay base de datos, no hay servicio en la nube nuestro, no hay cuenta, y **no hay
proveedor de push**: el aviso llega por la misma conexión que todo lo demás
([07 §3](07-decisiones.md#3--canal-de-despertar-quic-sin-terceros)).

## Por qué el nodo envuelve un agente y no llama a un modelo

Ésta es la restricción que define toda la arquitectura, y conviene decirla pronto:

> **Una suscripción de Claude no es utilizable desde la API de mensajes.** La API se factura
> por token y exige una clave (`ANTHROPIC_API_KEY`) o un perfil de `ant auth login`. Las
> credenciales de una suscripción Pro/Max son credenciales OAuth que **solo consume el
> binario de Claude Code**, desde `~/.claude` en la máquina donde se hizo login.

Consecuencia directa: para «usar nuestra suscripción», el nodo no puede hacer peticiones
HTTP a `/v1/messages`. Tiene que **lanzar y conducir un proceso de Claude Code**, y leer sus
eventos.

Existe un Claude Agent SDK que empaqueta eso como librería, pero **solo para Python y
TypeScript**; desde Go la vía oficial es ejecutar el CLI como subproceso, que es lo que el
SDK hace por dentro. El nodo mantiene un `claude -p` de vida larga con `--input-format
stream-json`, le escribe los mensajes del usuario por stdin y lee los suyos por stdout, una
línea de JSON por mensaje. El *callback de permisos* —lo que más nos importa, porque es lo
que se redirige al teléfono— se obtiene con `--permission-prompt-tool` apuntando a un
servidor MCP que el propio nodo levanta en loopback. Detalle en
[`server/claudecode.go`](../server/claudecode.go).

Lo mismo aplica a OpenAI: la suscripción de ChatGPT se consume a través de Codex CLI, no de
la API. De ahí la capa de adaptadores.

El efecto secundario útil es que heredamos gratis todo el trabajo del agente de escritorio:
lectura y escritura de ficheros, `Bash`, búsqueda, subagentes, MCP, compactación de
contexto y persistencia de sesiones. No reimplementamos ninguna de esas piezas.

## Flujo de una sesión

```
                app                          nodo                    Claude Code
                 │                             │                          │
   auth ─────────►│                             │                          │
                 │◄──────── hello              │                          │
   session.open ─►│                             │                          │
                 │                    query({prompt, options}) ───────────►│
   prompt ───────►│                             │                          │
                 │                             │◄── stream_event ─────────│
                 │◄─── text.delta (seq 12)     │    (deltas de texto)     │
                 │◄─── message  (seq 13)       │◄── assistant ────────────│
                 │     [frases numeradas]      │                          │
                 │                             │◄── canUseTool ───────────│
                 │◄─── decision.request        │    (bloquea el agente)   │
   decision.     │                             │                          │
   answer ──────►│                             │                          │
                 │                  PermissionResult ────────────────────►│
                 │                             │◄── hook Stop ────────────│
                 │◄─── task.done + alert       │                          │
```

## Decisiones tomadas

### D1 · El transporte es HTTP/3, terminado por Caddy

El nodo se publica tras un dominio con certificado y autentica con un token de dispositivo.
Se eligió frente a una VPN porque funciona desde cualquier red sin configuración en el
móvil, y frente a un relay en la nube porque no añade un componente que mantener. El coste
es un puerto abierto: lo asumimos con las medidas de [05-seguridad.md](05-seguridad.md).

**Una sola conexión, siempre abierta, que hace también de canal de despertar.** No hay push
por un tercero: los avisos son frames como cualquier otro. QUIC se eligió frente al
WebSocket porque identifica la conexión por *connection ID* y no por la tupla IP/puerto, así
que el salto de wifi a datos no la corta; porque reanuda en 0-RTT cuando sí se corta; y
porque un stream por sesión evita que el volcado de texto de un repo atasque la narración de
otro. El precio —si el sistema mata el proceso, nadie puede despertarlo— está discutido en
[07 §3](07-decisiones.md#3--canal-de-despertar-quic-sin-terceros).

**El nodo no habla QUIC.** Caddy termina HTTP/3 delante y hace de proxy en claro contra el
nodo, igual que en `echo-server`. Eso obliga a que el protocolo tenga forma de HTTP y no de
flujo bidireccional, y de ahí sale el reparto asimétrico:

- **Nodo→app:** un `GET` largo con el cuerpo en streaming, en formato SSE. El campo `id:` de
  cada evento *es* el `seq`, así que la cabecera `Last-Event-ID` que el cliente reenvía al
  reconectar *es* `sinceSeq`: la reanudación de [D2](#d2--todo-frame-servidorapp-lleva-un-número-de-secuencia-por-sesión)
  no necesita máquina de estados propia.
- **App→nodo:** peticiones sueltas. Un prompt o una respuesta a una decisión son pequeños y
  raros; no necesitan un canal abierto.

Hay dos flujos descendentes, no uno: `seq` es monótono **por sesión** y `Last-Event-ID` es
uno por flujo. Un canal de control lleva la lista de sesiones y los despertares de las que no
se están siguiendo, y un flujo por sesión lleva sus frames. Sobre HTTP/3 son streams de la
misma conexión QUIC, que es justo para lo que sirve.

Donde QUIC no llega —hay redes que capan UDP— la misma petición se sirve por HTTP/2 sobre
TCP. No es un segundo transporte que mantener: es el mismo protocolo por una conexión peor.

### D2 · Todo frame servidor→app lleva un número de secuencia por sesión

El móvil pierde la conexión constantemente: cambia de wifi a datos, se duerme, entra en el
metro. Cada sesión mantiene un buffer en anillo de los últimos *N* frames, y el cliente
reconecta con `session.attach {sinceSeq}`. La reconexión no pierde texto ni decisiones, y
la narración continúa en la frase exacta donde se cortó.

### D3 · El segmentado en frases se hace en el servidor

Podría hacerse en el móvil con el TTS de Android, pero entonces el índice de frase sería un
concepto local: al reconectar no habría forma de decir «iba por la frase 7 del mensaje 13».
Segmentando en el nodo, `(mensaje, frase)` es una coordenada estable y compartida — que es
justo lo que necesita el retroceso frase a frase.

### D4 · El texto se narra a través de un filtro, no en bruto

El nodo produce, para cada mensaje, una **versión narrable** además del texto completo. Los
bloques de código, los diffs y las salidas de terminal se sustituyen por un anuncio
(«veintiocho líneas de TypeScript») y las llamadas a herramientas por una frase corta
(«editando `protocolo.go`»). El texto íntegro sigue disponible para cuando el usuario mire
la pantalla. Sin este filtro el modo voz es inusable en trabajo de código.

### D5 · El motor de voz es el TTS del sistema, en el dispositivo

Gratis, offline, sin latencia de red y sin enviar el contenido del trabajo a un tercero.
La calidad de voz es peor que una de síntesis neuronal, y ése es el precio. Queda como
[decisión](07-decisiones.md#4--calidad-de-voz-el-tts-del-sistema) por si la narración larga
resulta fatigosa.

### D6 · Las decisiones son un tipo de frame de primera clase

No son «un mensaje con botones». Una decisión tiene identidad, opciones tipadas, estado
(pendiente / resuelta / cancelada) y bloquea el agente hasta que se responde. Así el móvil
puede reconstruir la botonera tras reconectar, y el nodo puede reinsistir con el aviso si el
usuario no contesta.

### D7 · Un adaptador por motor, con un contrato estrecho

El adaptador solo debe saber hacer cinco cosas: arrancar, aceptar texto del usuario, emitir
eventos normalizados, pedir una decisión, e interrumpir. Todo lo específico del motor
—flags de la CLI, formas de sus mensajes, nombres de sus herramientas— queda dentro.
Contrato en [`server/adaptador.go`](../server/adaptador.go).

## Cómo se cablean las tres funciones

### Avisos → herramienta MCP + hooks

El nodo registra un servidor MCP en proceso (`createSdkMcpServer`) con una herramienta
`avisar({ patron, mensaje?, sonido? })`. Está descrita para el modelo como «llama la
atención del usuario en su teléfono», así que el agente puede usarla deliberadamente: al
terminar algo, al encontrar un problema, o antes de una pregunta importante.

En paralelo, los hooks `Stop` y `TaskCompleted` generan un `task.done` automático, de modo
que el aviso de fin de tarea no depende de que el agente se acuerde de pedirlo.

### Decisiones → `canUseTool` y `AskUserQuestion`

`options.canUseTool` se invoca cuando el flujo de permisos llega a preguntar. Recibe, además
del nombre de la herramienta y su input, campos ya pensados para pintar interfaz:

- `title` — la frase completa del permiso («Claude quiere leer `foo.txt`»),
- `displayName` — un verbo corto apto para una etiqueta de botón («Leer fichero»),
- `description` — el subtítulo con las consecuencias,
- `suggestions` — las actualizaciones de permiso que implicaría un «permitir siempre».

Eso se convierte en un `decision.request` de 2–3 opciones. La respuesta del móvil vuelve
como `PermissionResult` (`allow` / `deny`, con `updatedPermissions` si se eligió «siempre»).

Cuando el agente usa la herramienta `AskUserQuestion` —la pregunta abierta de «¿cómo
procedo?»— llega por el mismo callback, pero su input trae `questions[]` con `options[]` ya
etiquetadas y descritas. Ése es el caso que mejor encaja con la botonera a pantalla
completa: 2–4 opciones con etiqueta corta y descripción. Se responde con
`{ behavior: 'allow', updatedInput: { …, answers } }`.

> El campo exacto donde se inyectan las respuestas depende de la versión del SDK. El
> adaptador lo aísla en un único sitio y el andamiaje lo marca con un `TODO` de
> verificación contra la versión fijada.

### Narración → deltas + mensajes completos

Con `includePartialMessages: true` llegan `stream_event` con los deltas del modelo, que se
reenvían como `text.delta` para que la pantalla muestre algo mientras se genera. La
narración, en cambio, **no usa los deltas**: espera el `assistant` completo, lo pasa por el
filtro narrable y lo segmenta. Narrar deltas produce entonación cortada y hace imposible el
retroceso por frases.

## Versiones fijadas

| Pieza | Versión de referencia |
|---|---|
| Claude Code CLI | 2.1.263 |
| Go | 1.27 |
| Android | `minSdk` 29 (Android 10), `targetSdk` 35 |
| Kotlin / Compose | 2.0.x / BOM 2024.09 |

La versión del CLI se fija y se sube a mano, por dos razones. La forma de sus mensajes en
`stream-json` cambia entre versiones —los `VERIFICAR` del nodo marcan dónde duele—, y la
documentación anuncia que `--bare` pasará a ser el modo por defecto de `-p`: el día que eso
ocurra, un CLI más nuevo dejaría de leer las credenciales OAuth y se pondría a facturar por
token contra la API, en silencio y sin fallar.
