# 4. Las tres funciones, en detalle

Este documento es la especificación de comportamiento de la app. Incluye los límites reales
de Android, porque dos de las tres funciones chocan con ellos y el diseño tiene que
reconocerlo en vez de prometer lo imposible.

---

## 1 · Avisos: el agente te busca

### Lo que se quiere

No tener que comprobar nada. Si el agente terminó, si se atascó, o si quiere decir algo
importante, el teléfono avisa desde el bolsillo.

### Los dos caminos

**Automático.** Los hooks `Stop` y `TaskCompleted` del agente disparan un `task.done`. No
depende del criterio del modelo: si el turno acaba, hay aviso. Patrón `doble`.

**Deliberado.** El nodo expone al agente una herramienta MCP en proceso:

```ts
avisar({
  patron: 'corto' | 'doble' | 'largo' | 'urgente',
  mensaje?: string,   // texto corto para la notificación
  sonido?: string,    // clave de un sonido del catálogo
})
```

Descrita para el modelo como *«llama la atención del usuario en su teléfono; úsala cuando
termines algo que estaba esperando, cuando encuentres un problema que le afecta, o antes de
una pregunta que le bloquea»*. Esto es lo que pedía el enunciado: **el agente puede hacer
vibrar el teléfono**, no solo nosotros por él.

Como cualquier herramienta, es visible en el flujo y auditable. Y como es del nodo y no del
móvil, funciona igual si el usuario tiene tres dispositivos emparejados.

### El vocabulario háptico

Cuatro patrones. La restricción es deliberada: en el bolsillo, con abrigo, no se distinguen
más de cuatro.

| Patrón | Vibración | Significa |
|---|---|---|
| `corto` | un pulso de 40 ms | algo ha pasado, sin urgencia |
| `doble` | 40-80-40 ms | tarea terminada |
| `largo` | 400 ms continuos | te necesito: hay que decidir |
| `urgente` | 4 × (100-60) ms | algo va mal |

En Android 12+ se usan `VibrationEffect.Composition` con primitivas (`CLICK`, `THUD`,
`TICK`) donde estén disponibles, cayendo a `createWaveform` en el resto. Los tres patrones
informativos respetan el modo No Molestar; `urgente` no.

### Cuando la app está en segundo plano

El canal solo existe mientras el proceso corre. Con un *foreground service* activo (la
sesión de trabajo), la conexión QUIC se mantiene con el móvil bloqueado y la app en segundo
plano: un foreground service conserva acceso a red en Doze, y la migración de conexión de
QUIC cubre el cambio de wifi a datos sin cortar nada.

Cuando llega un `alert`, un `task.done` o un `decision.request`, el `SessionService` vibra
con el patrón correcto y —si es una decisión— publica una notificación de alta prioridad con
las opciones como acciones, de forma que se pueda contestar desde la pantalla de bloqueo sin
abrir la app.

**No hay push por un tercero**, y eso tiene una consecuencia que conviene decir sin
adornos: si el sistema mata el proceso, **nadie puede despertarlo** hasta que el usuario
abra la app. Se mitiga con la notificación persistente del foreground service, pidiendo al
usuario la exención de optimización de batería, y con `START_STICKY`; en móviles con
matarratas agresivo hay que añadir la excepción a mano. Es una decisión tomada a sabiendas
([07 §3](07-decisiones.md#3--canal-de-despertar-quic-sin-terceros)).

---

## 2 · Narración: escuchar en vez de leer

### Lo que se quiere

Que el texto del agente se reproduzca por voz, y que con la pantalla apagada un doble
toque retroceda una frase y mantener pulsado acelere la reproducción.

### El límite que hay que decir en voz alta

**Con la pantalla físicamente apagada, Android no entrega eventos táctiles a una app.** El
digitalizador se apaga o el sistema se queda los pocos gestos que sobreviven (el doble
toque para despertar es del propio sistema y no es interceptable). No hay permiso, API ni
truco que lo cambie para una app normal.

Así que hay dos modos, y la app ofrece los dos porque cubren situaciones distintas.

### Modo A · Pantalla negra (el que cumple el gesto literal)

Una `Activity` a pantalla completa, negra, sin nada que leer, con `FLAG_KEEP_SCREEN_ON` y
`screenBrightness = 0f`. La pantalla está *encendida pero invisible*: en un panel OLED el
consumo es prácticamente el de la pantalla apagada, y el usuario ve exactamente lo que
vería con la pantalla apagada — nada.

A cambio, los gestos son táctiles de verdad y ocupan toda la superficie:

| Gesto | Acción | Confirmación |
|---|---|---|
| toque | pausa / reanuda | `corto` |
| doble toque | frase anterior | `corto` |
| mantener | ×2 mientras se mantiene, ×1 al soltar | pulso al entrar y al salir |
| deslizar → | frase siguiente | `corto` |
| deslizar ← | mensaje anterior completo | `doble` |
| deslizar ↑ | leer el mensaje entero otra vez | `doble` |
| deslizar ↓ | salir del modo narración | `largo` |
| dos dedos | ¿en qué estado está el agente? (lo dice) | — |

Se combina con `PROXIMITY_SCREEN_OFF_WAKE_LOCK`: al meter el móvil en el bolsillo el sensor
de proximidad apaga la pantalla de verdad y desactiva los gestos táctiles, evitando toques
fantasma. Al sacarlo, vuelven sin transición.

### Modo B · Pantalla apagada de verdad (auricular y botones)

Cuando el teléfono no se va a sacar del bolsillo. El servicio publica una `MediaSession`
activa, lo que le da acceso a los botones de medios del auricular (con cable o Bluetooth) y
—mientras la sesión está activa— a las teclas de volumen:

| Entrada | Acción |
|---|---|
| botón del auricular ×1 | pausa / reanuda |
| botón del auricular ×2 | frase anterior (`ACTION_SKIP_TO_PREVIOUS`) |
| botón del auricular ×3 | frase siguiente |
| botón del auricular mantenido | ×2 mientras se mantiene |
| volumen ↓ mantenido | frase anterior |
| volumen ↑ mantenido | acelerar |

El mapeo es idéntico en intención al del modo A: **doble = atrás, mantener = acelerar**. Lo
que cambia es la superficie. Publicar una `MediaSession` tiene otra ventaja: la narración
se comporta como cualquier reproducción de audio del sistema — se pausa con una llamada,
baja el volumen con un aviso del navegador, y aparece en los controles de la pantalla de
bloqueo y del smartwatch.

### El motor de narración

`TextToSpeech` del sistema, cola gestionada por nosotros y no por Android:

```
cola  ──►  [ m13/f0 ][ m13/f1 ][ m13/f2 ][ m14/f0 ] ...
                        ▲
                     cursor
```

Cada frase se encola con su propio `utteranceId = "m13/1"`, y `UtteranceProgressListener`
avanza el cursor al terminar. Eso es lo que hace baratos el retroceso y el salto: no hay
que buscar dentro de un audio, solo mover un índice y volver a encolar. Es también por lo
que el segmentado se hace en el servidor ([D3](02-arquitectura.md#d3--el-segmentado-en-frases-se-hace-en-el-servidor)).

- **Velocidad:** `setSpeechRate`. Reposo 1.0, mantenido 2.0, con transición para que no
  suene a corte. Se recuerda la última velocidad de reposo elegida.
- **Retroceso:** `cursor -= 1`, `stop()`, reencolar desde ahí. Si el cursor está en la
  primera frase de un mensaje, retrocede al mensaje anterior.
- **Audio:** `AudioAttributes` con `USAGE_ASSISTANT`, y `AudioFocusRequest` transitorio con
  *ducking* — así la narración se mezcla por encima de la música en vez de matarla.
- **Interrupciones:** un `alert` con `spoken` se dice **antes** de la frase siguiente, no
  encima de la actual. Un `decision.request` sí interrumpe: bloquea al agente, así que es
  lo más importante que hay en ese momento.

### Qué se narra y qué no

El filtro del nodo ([D4](02-arquitectura.md#d4--el-texto-se-narra-a-través-de-un-filtro-no-en-bruto)):

| En el texto | Se narra como |
|---|---|
| bloque de código | «sigue un bloque de código: N líneas de TypeScript» |
| diff | «un diff: 3 ficheros, 40 líneas añadidas, 12 quitadas» |
| salida de terminal | «salida de terminal, 20 líneas» o el error si acaba en fallo |
| tabla markdown | «una tabla de 5 filas» |
| URL larga | «un enlace» |
| ruta de fichero | leída como ruta, no como identificador: `src/net/AgentClient.kt` → «net, AgentClient punto kt» |
| lista | los elementos, con «uno», «dos»… delante |
| `**énfasis**` | el texto sin los asteriscos |

---

## 3 · Decisiones: la pantalla como botonera

### Lo que se quiere

Que cuando el agente pregunte cómo proceder, cada opción sea un botón enorme, y que se
pueda acertar sin apuntar y sin leer.

### La disposición

La pantalla entera, dividida en tantas franjas horizontales iguales como opciones (2–4).
Sin cabecera fija, sin márgenes, sin barra de navegación: el `WindowInsets` se consume y las
franjas llegan a los bordes. En un móvil de 6,1" cada franja de un caso de dos opciones mide
unos **7 cm de alto** — imposible de fallar con el pulgar sin mirar.

```
┌──────────────────────────────────────┐
│ ①  RESUMEN                      ⇢   │   ← tono "go": verde, borde grueso
│    el nodo manda lo que se perdió    │
├──────────────────────────────────────┤
│ ②  RECARGAR TODO                ⇢   │   ← tono "neutral": gris
│    la app pide la sesión completa    │
└──────────────────────────────────────┘
     ↑ número grande      ↑ label       ↑ description en cuerpo pequeño
```

Reglas:

- **Número grande a la izquierda.** Es la referencia compartida con la voz («opción dos») y
  con el auricular (dos pulsaciones). Sin número no hay forma de contestar sin mirar.
- **`label` en mayúsculas, ~28 sp, una o dos palabras.** Legible de reojo, a un brazo de
  distancia, en la calle y con sol.
- **`description` a ~14 sp, dos líneas como máximo, elidida.** Está para confirmar, no para
  decidir.
- **Color por `tone`, nunca por posición.** «Denegar» es siempre el mismo color esté arriba
  o abajo. Y como el color no puede ser el único canal: el tono también cambia el grosor del
  borde y el icono.
- **Nada más en pantalla.** Ni contador de coste, ni transcripción, ni «ver detalles». Un
  deslizamiento desde el borde muestra el contexto para quien quiera leerlo.

### Las tres formas de contestar

1. **Toque en la franja.** Confirmación háptica según el `tone`, no según la opción — así
   se *siente* si acabas de aprobar algo destructivo.
2. **Pulsaciones en el botón del auricular.** N pulsaciones = opción N, con 600 ms de
   ventana. Al entrar en una decisión, la voz enumera: «Uno: resumen. Dos: recargar todo.»
3. **Voz** (fase 2): «uno», «la primera», «resumen», «cancela».

En `multiSelect: true` cada franja alterna marcada/desmarcada y aparece una franja de
confirmación al pie. Es el caso menos frecuente y no se optimiza para ciego total.

### El comportamiento alrededor

- **Llegada:** vibración `largo`, la narración en curso se pausa, se enuncia la pregunta y
  las opciones. Si la pantalla estaba en modo negro, se ilumina a brillo automático.
- **Sin respuesta:** los permisos del agente **no caducan** — el agente se queda esperando
  indefinidamente. Así que no inventamos un timeout que deniegue por nosotros: la decisión
  queda pendiente, y se reinsiste con el aviso a los 30 s y a los 5 min. Es explícitamente mejor
  que un agente bloqueado sea un agente bloqueado, y no un agente que hizo algo que nadie
  aprobó.
- **Resuelta en otro sitio:** llega `decision.resolved` y la pantalla se cierra con un
  aviso hablado de quién contestó.
- **Cancelada por el agente:** igual, con `resolution: "cancelled"`.
- **«Permitir siempre»:** si la decisión traía `suggestions`, aparece como una cuarta franja
  más estrecha, nunca como una de las principales, y su háptica es la de `danger`.

### Preguntas que no son de opciones

`AskUserQuestion` siempre ofrece opciones, pero el agente también puede simplemente
preguntar algo en texto libre. Ahí la botonera no aplica: la app narra la pregunta y ofrece
dictado (el reconocedor del sistema) con confirmación hablada de lo transcrito antes de
enviarlo. Es el punto más flojo del diseño y está en
[decisiones](07-decisiones.md#5--entrada-por-voz-dictado-del-sistema).
