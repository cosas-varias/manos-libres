# 5. Seguridad

## La premisa incómoda

Esta app aprueba, desde un teléfono, que un agente ejecute comandos en tu servidor. Eso la
convierte en **un canal de ejecución remota de código**, y hay que diseñarla como tal. Un
token filtrado no significa «alguien lee mis conversaciones»: significa «alguien tiene una
shell en tu máquina con tus credenciales de Claude».

Todo lo que sigue existe por esa frase.

## Transporte

- **WSS obligatorio.** El nodo no acepta `ws://` salvo en `127.0.0.1` para desarrollo.
- **Terminación TLS en Caddy o nginx**, con certificado de Let's Encrypt. El nodo escucha
  en loopback; no se expone directamente.
- **HSTS** y **pinning del certificado en la app** (`network_security_config.xml` con el
  pin de la CA intermedia, no de la hoja, para no romperse en cada renovación).
- El nodo rechaza conexiones sin `Origin` esperado y limita a 4 conexiones por token.

## Emparejamiento

No hay contraseñas. Un dispositivo se empareja una vez:

```
1. En el servidor:  npm run pair
   → imprime un código de un uso, válido 5 minutos, y un QR con
     {url, code}
2. En la app: escanear el QR (o teclear url + código).
3. La app genera un par de claves Ed25519 en el Keystore de Android,
   con setUserAuthenticationRequired(false) y strongbox si existe.
4. Manda la clave pública + el código; el nodo devuelve un token de
   dispositivo de 256 bits y guarda la pública asociada.
5. El código de emparejamiento queda quemado.
```

A partir de ahí, cada `auth` incluye el token **y** una firma del reto que envía el nodo en
el `hello` previo. El token solo no sirve: hace falta la clave privada, que no sale del
Keystore. Un token robado del almacenamiento de la app es inútil sin acceso al hardware.

- Los tokens se listan y revocan con `npm run devices`. La revocación es inmediata: el nodo
  cierra las conexiones activas de ese token.
- Los tokens no caducan por tiempo. Caducan por revocación explícita, porque un token que
  caduca a media madrugada deja tu agente sin supervisión sin avisar.

## Superficie del agente

El nodo, no la app, decide qué puede hacer el agente:

- **`bypassPermissions` está prohibido.** El nodo no acepta ese modo de permisos ni por
  configuración; existir la opción es el fallo. El modo por defecto es el que pregunta.
- **Directorios en lista blanca.** `session.open` solo acepta un `cwd` que esté bajo alguna
  de las raíces de `ALLOWED_ROOTS`. Nada de abrir sesiones en `/` o en `~/.ssh`.
- **Herramientas denegadas por defecto** las que no tienen sentido en remoto y sí tienen
  consecuencias fuera del repo: se configura con `disallowedTools` en el arranque.
- **El agente no ve el token del dispositivo, ni la configuración del nodo, ni los tokens de
  push.** Viven fuera del `cwd` de cualquier sesión y en variables de entorno que no se
  propagan al proceso del agente.
- **La herramienta `avisar` no acepta texto arbitrario largo.** `mensaje` se recorta a 120
  caracteres y se escapa; es lo que acaba en una notificación del sistema.

## Datos

- **El nodo no guarda transcripciones propias.** Las sesiones ya las persiste Claude Code en
  `~/.claude`; duplicarlas solo añade un sitio del que se pueden filtrar.
- **El buffer de replay es en memoria y en anillo.** Se pierde al reiniciar, a propósito.
- **La app guarda en disco lo mínimo:** la lista de sesiones y la última posición de
  narración. La transcripción es efímera en memoria. Ver
  [decisión abierta](07-decisiones-abiertas.md#7-histórico-en-el-móvil).
- **El contenido del trabajo no pasa por terceros.** Es el argumento principal para usar el
  TTS del dispositivo ([D5](02-arquitectura.md#d5--el-motor-de-voz-es-el-tts-del-sistema-en-el-dispositivo)):
  un TTS en la nube significa mandar cada frase de tu código a un proveedor más.
- **El push sí pasa por un tercero.** Por eso los push son *data-only* y su contenido es un
  identificador y un patrón, nunca el texto del agente. El texto se recupera por el
  WebSocket cuando la app despierta.

## Límites de tasa y abuso

| Qué | Límite |
|---|---|
| intentos de `auth` fallidos | 5 por IP y 10 minutos, después bloqueo temporal |
| códigos de emparejamiento | 1 activo a la vez |
| `session.open` | 3 por minuto por token |
| `prompt` | 30 por minuto por token |
| tamaño de frame entrante | 64 KiB |
| conexiones simultáneas | 4 por token, 20 por nodo |

## La suscripción

Un aviso que no es técnico pero importa: **las suscripciones de Claude y de ChatGPT son
personales.** Poner el nodo a disposición de varias personas, aunque sea tu equipo, es un
uso que probablemente incumple sus condiciones — y en la práctica se detecta. Este diseño
asume **un nodo por persona, con varios dispositivos propios emparejados**. Si hace falta
multiusuario, la vía es API de pago con clave propia, no compartir la suscripción. Está en
[decisiones abiertas](07-decisiones-abiertas.md#2-un-usuario-o-varios).

## Fuera de alcance de la v1

Se declaran para que nadie asuma que están cubiertos:

- **Sin aislamiento del agente.** Corre con el usuario del nodo y su acceso al sistema de
  ficheros. Meterlo en un contenedor es lo primero que se debería añadir en producción.
- **Sin auditoría firmada.** Hay log, no hay cadena de integridad.
- **Sin cifrado extremo a extremo por encima de TLS.** El nodo ve todo en claro, que es
  inevitable porque es quien lanza el agente.
- **Sin protección contra un móvil comprometido.** Con el dispositivo desbloqueado en manos
  ajenas, la app aprueba lo que le pidan. El bloqueo del propio teléfono es la defensa.
