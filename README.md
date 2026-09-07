# Manos Libres

**Concepto** de una app Android para dirigir agentes de IA que se ejecutan en tu propio
servidor, usando tus suscripciones (Claude, OpenAI, …) en lugar de la API de pago.

Hace lo que hoy hace la app de Claude para Android, pero con una premisa distinta:
**el móvil no es donde lees ni escribes, es donde escuchas y decides.** Está pensada para
usarse mientras caminas, conduces, cocinas o tienes las manos ocupadas: el teléfono en el
bolsillo, unos auriculares, y como mucho un gesto grande cuando el agente pregunta algo.

> Estado: **concepto + esqueleto**. La documentación de `docs/` es la especificación de
> referencia; `server/` y `app/` son andamiajes compilables con la estructura y los tipos
> del protocolo, no una implementación terminada. Ver [docs/06-roadmap.md](docs/06-roadmap.md).

---

## Las tres cosas que justifican construirla

1. **El agente puede llamar tu atención.** No hay que mirar la pantalla para saber si
   terminó. El agente dispone de una herramienta para hacer vibrar el teléfono o emitir un
   sonido a propósito, y el fin de cada tarea genera un aviso automático.
   → [docs/04-ux-manos-libres.md#1-avisos](docs/04-ux-manos-libres.md#1-avisos-el-agente-te-busca)

2. **Modo narración con la pantalla apagada.** El texto del agente se lee en voz alta,
   frase a frase, con control por gestos grandes o por los botones del auricular: doble
   toque retrocede una frase, mantener acelera la reproducción.
   → [docs/04-ux-manos-libres.md#2-narración](docs/04-ux-manos-libres.md#2-narración-escuchar-en-vez-de-leer)

3. **Decisiones a pantalla completa.** Cuando el agente pregunta cómo proceder, la pantalla
   se convierte en 2–4 franjas del tamaño de la mano, una por opción, narradas y numeradas.
   Se acierta sin mirar y sin leer.
   → [docs/04-ux-manos-libres.md#3-decisiones](docs/04-ux-manos-libres.md#3-decisiones-la-pantalla-como-botonera)

## Cómo encaja

```
┌─────────────────────────┐         WSS + token          ┌──────────────────────────────┐
│  Android (Kotlin)       │◄────────────────────────────►│  nodo (Node + TypeScript)    │
│                         │   protocolo manos-libres/1   │                              │
│  · Narrador (TTS)       │                              │  · Hub de sesiones           │
│  · Superficie de gestos │         FCM / UnifiedPush    │  · Segmentado en frases      │
│  · Botonera de decisión │◄─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│  · Adaptadores de agente     │
│  · Háptica y avisos     │         (app cerrada)        │  · Herramienta MCP `avisar`  │
└─────────────────────────┘                              └──────────────┬───────────────┘
                                                                        │
                                            ┌───────────────────────────┴───────────────┐
                                            │  Claude Code / Agent SDK  (suscripción)   │
                                            │  Codex CLI, otros          (fase 2)       │
                                            └───────────────────────────────────────────┘
```

El nodo es el único que ve credenciales. La app nunca tiene una clave de proveedor: solo un
token de dispositivo contra tu servidor.

**Por qué la suscripción obliga a esta forma:** una suscripción de Claude no se puede usar
con la API de mensajes — se usa a través del binario de Claude Code, que lee las
credenciales OAuth del usuario del servidor. Por eso el nodo *envuelve un agente*, no
*llama a un modelo*. Ver [docs/02-arquitectura.md](docs/02-arquitectura.md).

## Documentación

| Documento | Contenido |
|---|---|
| [01-vision.md](docs/01-vision.md) | Problema, usuario, principios de diseño y lo que explícitamente no hacemos |
| [02-arquitectura.md](docs/02-arquitectura.md) | Componentes, adaptadores, suscripción vs API, decisiones tomadas |
| [03-protocolo.md](docs/03-protocolo.md) | `manos-libres/1`: frames, secuencias, reconexión |
| [04-ux-manos-libres.md](docs/04-ux-manos-libres.md) | Las tres funciones en detalle, con los límites reales de Android |
| [05-seguridad.md](docs/05-seguridad.md) | Emparejamiento, transporte, y por qué esto es ejecución remota de código |
| [06-roadmap.md](docs/06-roadmap.md) | Hitos, del andamiaje al uso diario |
| [07-decisiones-abiertas.md](docs/07-decisiones-abiertas.md) | Lo que falta decidir, con recomendación para cada punto |

## Estructura

```
server/            nodo: hub WebSocket, sesiones, adaptadores de agente
  src/protocol.ts  fuente de verdad del protocolo (tipos compartidos)
  src/adapters/    claude-code.ts (Agent SDK) y el contrato que cumple cualquier motor
app/               cliente Android (Kotlin + Compose)
docs/              la especificación
```

## Puesta en marcha del andamiaje

```bash
# nodo
cd server && npm install && cp .env.example .env && npm run dev

# app
cd app && ./gradlew installDebug     # requiere Android Studio / SDK 35
```

Detalles y requisitos en [server/README.md](server/README.md) y [app/README.md](app/README.md).
