# 7. Decisiones abiertas

Lo que falta decidir. Cada punto lleva una recomendación, para que la respuesta pueda ser
«vale» y no un ensayo.

---

### 1 · ¿Una sesión o varias en paralelo?

Trabajar con tres repos a la vez es normal en el escritorio. En el móvil, con narración, hace
falta decidir qué significa «la sesión activa»: solo una narra, ¿y las demás vibran?

**Recomendación:** una sesión narrando, todas avisando. El protocolo ya está diseñado para
varias (todo va con `sessionId`), pero la app trata una como *en foco* y las demás mandan
`alert` y `decision.request` con el nombre del proyecto por delante. Implementarlo en H6, no
antes.

---

### 2 · ¿Un usuario o varios?

Determina si esto puede usarlo un equipo. Y no es una decisión técnica: las suscripciones de
Claude y ChatGPT son personales ([05 §La suscripción](05-seguridad.md#la-suscripción)).

**Recomendación:** un nodo por persona. Si aparece la necesidad de equipo, que sea con
claves de API propias y facturación por token, no compartiendo una suscripción.

---

### 3 · Canal de push

**FCM** funciona mejor con Doze y ahorro de batería, pero exige Google Play Services y
manda los tokens por Firebase. **UnifiedPush** con un `ntfy` autoalojado no depende de
Google y encaja con la filosofía de «tu servidor», pero la entrega con la pantalla apagada
y el ahorro de batería agresivo de algunos fabricantes es notablemente menos fiable — y
justo la fiabilidad es lo que estamos vendiendo.

**Recomendación:** FCM en H2 para no pelearse con la entrega mientras se valida el
concepto, con la capa de push aislada tras una interfaz (`push.ts` en el nodo, un
`PushProvider` en la app) para poder añadir UnifiedPush después sin tocar nada más.
**Pregunta concreta: ¿es aceptable depender de Google Play Services?**

---

### 4 · Calidad de voz

El TTS del sistema es gratis, offline y no manda tu código a nadie, pero escuchar media
hora de una voz sintética mediocre cansa. Un TTS neuronal en el servidor (o de un
proveedor) suena mucho mejor, a cambio de coste por carácter, latencia, y de mandar el
texto del agente a un tercero más.

**Recomendación:** empezar con el del sistema y medirlo en uso real antes de gastar. Si
cansa, la salida intermedia es un TTS neuronal **local en el servidor** (Piper o similar):
mejor voz, sin terceros, a cambio de CPU. El protocolo no cambia — el nodo mandaría audio
en vez de texto para narrar, así que conviene que `narratable` no asuma que se sintetiza en
el móvil.

---

### 5 · Entrada por voz

Contestar una pregunta abierta es hoy el punto flojo. Dictado del sistema (gratis, offline
en Android reciente, precisión discreta con términos técnicos) frente a Whisper en el nodo
(mejor con nombres de fichero y jerga, pero hay que grabar, subir y esperar).

**Recomendación:** dictado del sistema en H5, con confirmación hablada de lo transcrito
antes de enviar. Whisper en el nodo solo si el dictado falla demasiado con nombres de
símbolos y rutas — que es exactamente lo que uno acaba dictando.

---

### 6 · Idioma

El agente puede responder en español y citar identificadores en inglés en la misma frase.
Un TTS con la voz equivocada convierte `AgentClient.kt` en algo incomprensible.

**Recomendación:** voz fija configurada por el usuario, y que el filtro narrable del nodo
marque los fragmentos de código y las rutas para que la app los pronuncie deletreando o
con voz inglesa. No detectar idioma automáticamente: cambia de voz a media frase y suena
peor que equivocarse consistentemente.

---

### 7 · Histórico en el móvil

¿Puede el usuario leer lo que pasó hace tres horas sin conexión?

**Recomendación:** no en la v1. La app mantiene en memoria la sesión en curso y nada más.
Un histórico local es un sitio más del que se filtra el contenido de tu trabajo, y el nodo
ya tiene las transcripciones de Claude Code para cuando de verdad haga falta.

---

### 8 · Distribución

**Recomendación:** APK firmado en las releases de este repo, más F-Droid si algún día
interesa a alguien de fuera. Play Store no aporta nada a una app que necesita un servidor
propio para funcionar, y sí aporta un proceso de revisión hostil a los permisos que
usamos (`FOREGROUND_SERVICE`, notificaciones a pantalla completa, botones de medios).

---

### 9 · ¿Es el reloj la superficie correcta?

La botonera de decisión en un smartwatch es un encaje casi perfecto: dos opciones, pantalla
entera, vibración en la muñeca, sin sacar el móvil.

**Recomendación:** no distraerse con esto hasta H6, pero no cerrar la puerta: mantener la
lógica de decisión en el nodo y la app como pura presentación hace que una superficie de
Wear OS sea trabajo de interfaz, no rediseño.

---

### 10 · Qué hacer con las tareas muy largas

Si el agente trabaja 40 minutos sin decir nada, la narración calla y el usuario no sabe si
sigue vivo. Se puede narrar la actividad de herramientas («editando `hub.ts`»), pero eso es
ruido constante en el oído.

**Recomendación:** un latido hablado configurable — cada N minutos de silencio, una frase
de estado corta («sigo, llevo doce minutos, tres ficheros tocados»). El nodo ya tiene la
información en los frames `tool`; es cuestión de resumirla en vez de narrarla en bruto.
**Pregunta concreta: ¿cada cuánto sería tolerable? ¿tres minutos, cinco?**
