/**
 * Adaptador de Claude Code sobre `@anthropic-ai/claude-agent-sdk`.
 *
 * Este es el sitio donde se materializa la decisión de arquitectura que define el proyecto:
 * no llamamos a la API de mensajes, **conducimos un proceso de Claude Code**. Es la única
 * forma de consumir una suscripción (las credenciales OAuth de `~/.claude` solo las lee el
 * binario de Claude Code) y de paso heredamos su bucle de agente, sus herramientas, sus
 * hooks y su gestión de contexto.
 *
 * Tres cables importantes salen de aquí:
 *
 *  · `canUseTool`  → decisiones a pantalla completa. Bloquea al agente hasta que alguien
 *                    contesta en el teléfono.
 *  · `mcpServers`  → la herramienta `avisar`, con la que el agente hace vibrar el móvil.
 *  · `hooks`       → `Stop` y `TaskCompleted` generan el aviso de fin de tarea sin
 *                    depender de que el modelo se acuerde de pedirlo.
 *
 * VERIFICAR: los tipos del Agent SDK cambian entre versiones y siguen la versión del CLI
 * que empaquetan. Está fijado a 0.3.263 en package.json; al subirlo, revisar los tres
 * puntos marcados con VERIFICAR más abajo.
 */

import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import type { CanUseTool, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { etiquetaHerramienta } from '../narratable.js';
import type {
  AdapterHost,
  AdapterOptions,
  AgentAdapter,
  DecisionRequest,
} from './types.js';
import type { AlertPattern, DecisionOption } from '../protocol.js';

/** Cola de un solo consumidor que alimenta la entrada en streaming de `query()`. */
class ColaDePrompts {
  private pendientes: string[] = [];
  private despertar: (() => void) | undefined;
  private cerrada = false;

  push(text: string): void {
    this.pendientes.push(text);
    this.despertar?.();
  }

  close(): void {
    this.cerrada = true;
    this.despertar?.();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<unknown> {
    while (!this.cerrada) {
      const text = this.pendientes.shift();
      if (text === undefined) {
        await new Promise<void>((r) => { this.despertar = r; });
        continue;
      }
      // VERIFICAR: forma de SDKUserMessage en la versión fijada del SDK.
      yield {
        type: 'user',
        message: { role: 'user', content: text },
        parent_tool_use_id: null,
        session_id: '',
      };
    }
  }
}

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly engine = 'claude-code';
  engineSessionId: string | undefined;

  private cola = new ColaDePrompts();
  private host!: AdapterHost;
  private bucle: Promise<void> | undefined;
  private abortar = new AbortController();

  async start(host: AdapterHost, options: AdapterOptions): Promise<void> {
    this.host = host;

    const stream = query({
      prompt: this.cola as AsyncIterable<never>,
      options: {
        cwd: options.cwd,
        model: options.model,
        resume: options.resume,
        // Los deltas alimentan la pantalla. La narración espera el mensaje completo.
        includePartialMessages: true,
        // El modo que pregunta. `bypassPermissions` está prohibido en este proyecto:
        // ver docs/05-seguridad.md.
        permissionMode: 'default',
        canUseTool: this.canUseTool,
        mcpServers: { manos_libres: this.servidorMcp() },
        // La herramienta de avisos no debe generar una decisión cada vez que se usa.
        allowedTools: ['mcp__manos_libres__avisar'],
        hooks: {
          Stop: [{ hooks: [this.alTerminar] }],
          TaskCompleted: [{ hooks: [this.alTerminar] }],
        },
        // TODO(H6): `disallowedTools` con lo que no tiene sentido en remoto.
      },
    });

    this.bucle = this.consumir(stream);
  }

  async send(text: string): Promise<void> {
    this.cola.push(text);
  }

  async interrupt(): Promise<void> {
    // TODO(H1): el objeto que devuelve query() expone `interrupt()`; usarlo en vez de
    // abortar, que mata la sesión entera en lugar del turno en curso.
    this.abortar.abort();
  }

  async stop(): Promise<void> {
    this.cola.close();
    this.abortar.abort();
    await this.bucle?.catch(() => {});
  }

  // ── Consumo del stream ─────────────────────────────────────────────────────

  private async consumir(stream: AsyncIterable<Record<string, unknown>>): Promise<void> {
    try {
      for await (const msg of stream) {
        switch (msg['type']) {
          case 'system': {
            const id = msg['session_id'];
            if (typeof id === 'string') this.engineSessionId = id;
            this.host.emit({ kind: 'state', state: 'idle' });
            break;
          }

          case 'stream_event': {
            // Un evento de streaming de la Messages API. Solo nos interesan los deltas
            // de texto; el resto es ruido para la pantalla.
            const ev = msg['event'] as { type?: string; delta?: { type?: string; text?: string } };
            if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
              this.host.emit({
                kind: 'delta',
                messageId: String(msg['uuid'] ?? ''),
                text: ev.delta.text ?? '',
              });
            }
            break;
          }

          case 'assistant': {
            const m = msg['message'] as { content?: unknown[] } | undefined;
            const bloques = m?.content ?? [];
            const texto = bloques
              .filter((b): b is { type: 'text'; text: string } =>
                (b as { type?: string }).type === 'text')
              .map((b) => b.text)
              .join('\n');

            if (texto.trim()) {
              this.host.emit({
                kind: 'message',
                messageId: String(msg['uuid'] ?? ''),
                role: 'assistant',
                type: 'text',
                text: texto,
              });
            }

            for (const b of bloques) {
              const bloque = b as { type?: string; id?: string; name?: string; input?: Record<string, unknown> };
              if (bloque.type === 'tool_use') {
                this.host.emit({
                  kind: 'tool',
                  toolUseId: bloque.id ?? '',
                  phase: 'start',
                  name: bloque.name ?? '',
                  input: bloque.input ?? {},
                });
                this.host.emit({ kind: 'state', state: 'working' });
              }
            }
            break;
          }

          case 'result': {
            const ok = msg['subtype'] === 'success';
            if (!ok) {
              this.host.emit({ kind: 'error', message: String(msg['result'] ?? 'el turno falló') });
              break;
            }
            this.host.emit({
              kind: 'done',
              summary: String(msg['result'] ?? '').slice(0, 400),
              costUsd: typeof msg['total_cost_usd'] === 'number' ? msg['total_cost_usd'] : undefined,
              durationMs: typeof msg['duration_ms'] === 'number' ? msg['duration_ms'] : undefined,
            });
            this.host.emit({ kind: 'state', state: 'idle' });
            break;
          }

          default:
            // El SDK emite muchos más tipos (tareas, hooks, reintentos, compactación…).
            // Ignorarlos es correcto: lo que no se sabe traducir, no se narra.
            break;
        }
      }
    } catch (err) {
      this.host.emit({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      this.host.emit({ kind: 'state', state: 'error' });
    }
  }

  // ── Decisiones ─────────────────────────────────────────────────────────────

  /**
   * Se invoca cuando el flujo de permisos del agente llega a preguntar. Trae campos ya
   * pensados para pintar interfaz —`title`, `displayName`, `description`, `suggestions`—
   * que es exactamente lo que necesita la botonera a pantalla completa.
   *
   * La promesa no se resuelve hasta que alguien contesta en el teléfono. Los permisos no
   * caducan: si nadie contesta, el agente espera. Ver docs/04-ux-manos-libres.md.
   */
  private canUseTool: CanUseTool = async (toolName, input, ctx) => {
    this.host.emit({ kind: 'state', state: 'waiting' });

    const peticion: DecisionRequest =
      toolName === 'AskUserQuestion'
        ? decisionDesdePregunta(input)
        : decisionDesdePermiso(toolName, input, ctx);

    const respuesta = await this.host.decide(peticion);
    this.host.emit({ kind: 'state', state: 'working' });

    if (toolName === 'AskUserQuestion') {
      // VERIFICAR: el host contesta a AskUserQuestion rellenando el input de la propia
      // herramienta. El nombre del campo depende del esquema de la versión fijada del
      // SDK — comprobarlo en sdk-tools.d.ts (AskUserQuestionInput) antes de confiar.
      return {
        behavior: 'allow',
        updatedInput: { ...input, answers: respuestasDePregunta(input, respuesta.optionIds) },
      };
    }

    const elegida = respuesta.optionIds[0];
    if (elegida === 'deny') {
      return { behavior: 'deny', message: 'Denegado desde el teléfono.' };
    }
    return {
      behavior: 'allow',
      // «Permitir siempre»: se devuelven las sugerencias que trajo el propio SDK, para
      // que no vuelva a preguntar por esto en la sesión.
      ...(respuesta.always && ctx.suggestions ? { updatedPermissions: ctx.suggestions } : {}),
    };
  };

  // ── Avisos ─────────────────────────────────────────────────────────────────

  /**
   * La herramienta con la que el agente llama la atención del usuario. La descripción
   * importa tanto como la implementación: es lo que decide *cuándo* el modelo la usa.
   */
  private servidorMcp() {
    return createSdkMcpServer({
      name: 'manos_libres',
      version: '0.0.0',
      instructions:
        'El usuario está lejos del ordenador, con el teléfono en el bolsillo y ' +
        'escuchando. No puede ver la pantalla. Usa `avisar` para llamar su atención.',
      tools: [
        tool(
          'avisar',
          'Hace vibrar y sonar el teléfono del usuario para llamar su atención. Úsala ' +
            'cuando termines algo que estaba esperando, cuando encuentres un problema que ' +
            'le afecta, o antes de una pregunta que te bloquea. No la uses para cada paso ' +
            'intermedio: un aviso que llega siempre deja de significar nada.',
          {
            patron: z
              .enum(['corto', 'doble', 'largo', 'urgente'])
              .describe(
                'corto: algo ha pasado, sin urgencia. doble: tarea terminada. ' +
                  'largo: necesito que decida. urgente: algo va mal.',
              ),
            mensaje: z
              .string()
              .max(120)
              .optional()
              .describe('Una frase corta para la notificación. Se lee en voz alta.'),
            sonido: z.string().optional().describe('Clave de un sonido del catálogo.'),
          },
          async ({ patron, mensaje, sonido }) => {
            this.host.emit({
              kind: 'alert',
              source: 'agent',
              pattern: patron as AlertPattern,
              message: mensaje,
              sound: sonido,
            });
            return { content: [{ type: 'text' as const, text: 'Avisado.' }] };
          },
          { annotations: { readOnlyHint: true } },
        ),
      ],
    });
  }

  /** `Stop` y `TaskCompleted`: el aviso de fin de tarea no depende del criterio del modelo. */
  private alTerminar = async (): Promise<Record<string, never>> => {
    this.host.emit({ kind: 'alert', source: 'node', pattern: 'doble' });
    return {};
  };
}

// ── Traducción a decisiones ──────────────────────────────────────────────────

/**
 * Un permiso se convierte en dos o tres franjas. `displayName` es la etiqueta corta que ya
 * viene pensada para un botón; `title` es la frase completa del permiso.
 */
function decisionDesdePermiso(
  toolName: string,
  input: Record<string, unknown>,
  ctx: { title?: string; displayName?: string; description?: string; suggestions?: PermissionUpdate[] },
): DecisionRequest {
  const accion = ctx.displayName ?? etiquetaHerramienta(toolName, input);
  const pregunta = ctx.title ?? `¿Permito «${accion}»?`;

  const options: DecisionOption[] = [
    { id: 'allow', label: 'Permitir', spoken: 'permitir', tone: 'go', description: ctx.description },
    { id: 'deny', label: 'Denegar', spoken: 'denegar', tone: 'stop' },
  ];
  if (ctx.suggestions?.length) {
    options.push({
      id: 'always',
      label: 'Siempre',
      spoken: 'permitir siempre',
      description: 'No volver a preguntar por esto en esta sesión.',
      tone: 'danger',
      sticky: true,
    });
  }

  return { source: 'permission', prompt: pregunta, options, multiSelect: false };
}

/**
 * `AskUserQuestion` es el caso que mejor encaja con la botonera: llega con 2–4 opciones ya
 * etiquetadas y descritas.
 *
 * TODO(H3): el esquema admite varias preguntas por llamada. Aquí se toma la primera; la
 * app necesita poder encadenarlas para cubrir el caso completo.
 */
function decisionDesdePregunta(input: Record<string, unknown>): DecisionRequest {
  const preguntas = (input['questions'] ?? []) as Array<{
    question?: string;
    multiSelect?: boolean;
    options?: Array<{ label?: string; description?: string }>;
  }>;
  const p = preguntas[0];

  return {
    source: 'ask_user_question',
    prompt: p?.question ?? 'El agente pregunta cómo proceder.',
    multiSelect: p?.multiSelect ?? false,
    options: (p?.options ?? []).map((o, i) => ({
      id: `o${i + 1}`,
      label: o.label ?? `Opción ${i + 1}`,
      spoken: (o.label ?? `opción ${i + 1}`).toLowerCase(),
      description: o.description,
      tone: i === 0 ? 'go' : 'neutral',
    })),
  };
}

/** VERIFICAR contra el esquema de AskUserQuestionInput de la versión fijada del SDK. */
function respuestasDePregunta(
  input: Record<string, unknown>,
  optionIds: string[],
): Record<string, string> {
  const preguntas = (input['questions'] ?? []) as Array<{
    question?: string;
    options?: Array<{ label?: string }>;
  }>;
  const p = preguntas[0];
  const indices = optionIds.map((id) => Number(id.replace(/^o/, '')) - 1);
  const etiquetas = indices
    .map((i) => p?.options?.[i]?.label)
    .filter((l): l is string => typeof l === 'string');
  return p?.question ? { [p.question]: etiquetas.join(', ') } : {};
}
