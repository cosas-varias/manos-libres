# 5. Seguridad

## La premisa incómoda

Esta app aprueba, desde un teléfono, que un agente ejecute comandos en tu servidor. Eso la
convierte en **un canal de ejecución remota de código**, y hay que diseñarla como tal. Un
token filtrado no significa «alguien lee mis conversaciones»: significa «alguien tiene una
shell en tu máquina con tus credenciales de Claude».

Todo lo que sigue existe por esa frase.

## Transporte

- **Cifrado obligatorio.** HTTP/3 lleva TLS 1.3 dentro por definición, y el repliegue es
  HTTPS. El nodo solo escucha en claro en loopback, detrás de Caddy.
- **Certificado de Let's Encrypt, y el nodo en loopback.** Caddy termina TLS y HTTP/3 y hace
  de proxy en claro dentro de la red de compose; el nodo no habla QUIC ni ve un certificado.
- **UDP/443 abierto** para HTTP/3, además del TCP/443 del repliegue. La superficie nueva la
  atiende Caddy, no el nodo.
- **Pinning del certificado en la app** (pin de la CA intermedia, no de la hoja, para no
  romperse en cada renovación), y **HSTS**.
- **El token va en `Authorization: Bearer`, nunca en la URL.** En `echo-server` viaja en la
  URL porque Echo no deja configurar cabeceras, y el precio es que acaba en los registros de
  acceso de Caddy. La app de manos-libres es nuestra y no paga ese precio.
- El nodo limita a 4 conexiones por token.

## Emparejamiento

No hay contraseñas. Un dispositivo se empareja una vez:

```
1. En el servidor:  go run . pair
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

- Los tokens se listan y revocan con `go run . devices`. La revocación es inmediata: el nodo
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
- **`ALLOWED_ROOTS` no cubre lo que el repo trae dentro.** El nodo ejecuta el CLI sin
  `--bare`, porque en modo bare no lee las credenciales OAuth y dejaría de usar la
  suscripción. El precio es que la sesión carga el `CLAUDE.md`, las skills, los servidores
  MCP y **los hooks** del directorio de trabajo, y un hook es un comando que se ejecuta solo.
  Que el `cwd` esté bajo una raíz permitida no dice nada de quién escribió su
  `.claude/settings.json`. Es la razón de peso para contenerizar el agente en H6; hasta
  entonces, abrir una sesión en un repo es confiar en ese repo.
- **El agente no ve el token del dispositivo ni la configuración del nodo.** Viven fuera del
  `cwd` de cualquier sesión y en variables de entorno que no se propagan al proceso del
  agente.
- **La herramienta `avisar` no acepta texto arbitrario largo.** `mensaje` se recorta a 120
  caracteres y se escapa; es lo que acaba en una notificación del sistema.

## Datos

- **El nodo no guarda transcripciones propias.** Las sesiones ya las persiste Claude Code en
  `~/.claude`; duplicarlas solo añade un sitio del que se pueden filtrar.
- **El buffer de replay es en memoria y en anillo.** Se pierde al reiniciar, a propósito.
- **La app guarda en disco lo mínimo:** la lista de sesiones y la última posición de
  narración. La transcripción es efímera en memoria. Ver
  [decisión](07-decisiones.md#7--histórico-en-el-móvil-no-en-la-v1).
- **El contenido del trabajo no pasa por terceros.** Es el argumento principal para usar el
  TTS del dispositivo ([D5](02-arquitectura.md#d5--el-motor-de-voz-es-el-tts-del-sistema-en-el-dispositivo)):
  un TTS en la nube significa mandar cada frase de tu código a un proveedor más.
- **Nada pasa por un tercero.** No hay proveedor de push: el aviso viaja por la misma
  conexión QUIC que el resto del protocolo, entre tu móvil y tu servidor y nadie más
  ([07 §3](07-decisiones.md#3--canal-de-despertar-quic-sin-terceros)).

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
[decisiones](07-decisiones.md#2--un-usuario-por-nodo).

## Fuera de alcance de la v1

Se declaran para que nadie asuma que están cubiertos:

- **Sin aislamiento del agente.** Corre con el usuario del nodo y su acceso al sistema de
  ficheros. Meterlo en un contenedor es lo primero que se debería añadir en producción.
- **Sin auditoría firmada.** Hay log, no hay cadena de integridad.
- **Sin cifrado extremo a extremo por encima de TLS.** El nodo ve todo en claro, que es
  inevitable porque es quien lanza el agente.
- **Sin protección contra un móvil comprometido.** Con el dispositivo desbloqueado en manos
  ajenas, la app aprueba lo que le pidan. El bloqueo del propio teléfono es la defensa.
