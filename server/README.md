# nodo

Servidor de Manos Libres. Mantiene las sesiones de agente, las traduce al protocolo
`manos-libres/1` y las sirve por WebSocket.

## Requisitos

- Node 20 o superior.
- **Claude Code instalado y con sesión iniciada** en la máquina: `claude login`. Sin eso el
  Agent SDK no tiene credenciales y el adaptador falla al arrancar. Es también lo que hace
  que se consuma la suscripción en lugar de la API — ver
  [docs/02-arquitectura.md](../docs/02-arquitectura.md#por-qué-el-nodo-envuelve-un-agente-y-no-llama-a-un-modelo).

## Arranque

```bash
npm install
cp .env.example .env      # ajusta ALLOWED_ROOTS y DEV_TOKEN
npm run dev
```

Comprobación rápida sin la app:

```bash
npx wscat -c ws://127.0.0.1:8787
> {"t":"auth","token":"<DEV_TOKEN>","device":"cli","protocol":"manos-libres/1"}
> {"t":"session.open","cwd":"/home/tu-usuario/proyectos/algo"}
> {"t":"prompt","sessionId":"s_1","text":"¿qué hay en este directorio?"}
```

## Publicación

El nodo escucha en loopback a propósito. Delante va un terminador de TLS; con Caddy:

```
agente.tu-dominio.tld {
    reverse_proxy 127.0.0.1:8787
}
```

## Mapa del código

| Fichero | Responsabilidad |
|---|---|
| `src/protocol.ts` | Los tipos del protocolo. Fuente de verdad; la app los replica en Kotlin. |
| `src/config.ts` | Lectura y validación del entorno. |
| `src/index.ts` | Arranque: servidor HTTP + WebSocket. |
| `src/hub.ts` | Conexiones, autenticación, encaminamiento de frames, fan-out y replay. |
| `src/session.ts` | Una sesión de agente: numeración de `seq`, buffer, decisiones pendientes. |
| `src/narratable.ts` | El filtro narrable y el segmentado en frases. |
| `src/push.ts` | Envío por push de lo que no se entregó por WebSocket. |
| `src/adapters/types.ts` | El contrato que cumple cualquier motor de agente. |
| `src/adapters/claude-code.ts` | Implementación sobre `@anthropic-ai/claude-agent-sdk`. Aquí viven también la herramienta MCP `avisar` y los hooks que generan el aviso de fin de tarea. |

## Estado

Andamiaje (H0): `npm run typecheck` pasa limpio, pero el nodo no se ha probado contra un
agente real y el emparejamiento con `pair` / `devices` (docs/05-seguridad.md) llega en H6.
Los `TODO` del código marcan lo que falta; los `VERIFICAR` marcan sitios
donde la forma exacta depende de la versión del Agent SDK y hay que comprobarla contra la
fijada en `package.json` antes de confiar en ella.
