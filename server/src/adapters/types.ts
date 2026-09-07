/**
 * El contrato que cumple cualquier motor de agente.
 *
 * Un adaptador solo tiene que saber hacer cinco cosas: arrancar, aceptar texto del
 * usuario, emitir eventos normalizados, pedir una decisión e interrumpir. Todo lo
 * específico del motor —flags de la CLI, formas de sus mensajes, nombres de sus
 * herramientas, su modelo de permisos— queda dentro del adaptador.
 *
 * El contrato es estrecho a propósito: es lo que permite añadir un motor sin tocar el hub
 * ni el protocolo, y lo que se validará en H6 con un segundo motor.
 */

import type {
  AlertPattern,
  DecisionOption,
  DecisionSource,
  MessageKind,
  SessionState,
} from '../protocol.js';

/** Lo que un adaptador emite. El `Session` lo numera y lo convierte en frames. */
export type AgentEvent =
  | { kind: 'state'; state: SessionState; detail?: string }
  | { kind: 'delta'; messageId: string; text: string }
  | { kind: 'message'; messageId: string; role: 'assistant' | 'user'; type: MessageKind; text: string }
  | { kind: 'tool'; toolUseId: string; phase: 'start' | 'end'; name: string; input: Record<string, unknown>; ok?: boolean }
  | { kind: 'alert'; pattern: AlertPattern; source: 'agent' | 'node'; message?: string; sound?: string }
  | { kind: 'done'; summary: string; costUsd?: number; durationMs?: number }
  | { kind: 'error'; message: string };

/** Una pregunta que el adaptador necesita que conteste una persona. */
export interface DecisionRequest {
  source: DecisionSource;
  prompt: string;
  options: DecisionOption[];
  multiSelect: boolean;
}

/** La respuesta que vuelve del teléfono. */
export interface DecisionAnswer {
  optionIds: string[];
  always: boolean;
}

/**
 * Lo que el adaptador puede hacer sobre su sesión.
 *
 * `decide` es la pieza interesante: devuelve una promesa que **no se resuelve hasta que
 * alguien contesta en el teléfono**. Mientras está pendiente, el agente está bloqueado. No
 * hay plazo que la resuelva por nosotros: preferimos un agente parado a un agente que hizo
 * algo que nadie aprobó (ver docs/04-ux-manos-libres.md).
 */
export interface AdapterHost {
  emit(event: AgentEvent): void;
  decide(request: DecisionRequest): Promise<DecisionAnswer>;
}

export interface AdapterOptions {
  cwd: string;
  model: string;
  /** Sesión del motor a reanudar, si la hay. */
  resume?: string;
}

export interface AgentAdapter {
  readonly engine: string;
  /** Id de sesión del propio motor, cuando lo publica. Sirve para reanudar. */
  readonly engineSessionId: string | undefined;

  start(host: AdapterHost, options: AdapterOptions): Promise<void>;
  /** Texto del usuario. El adaptador decide si encola o rechaza si hay turno en curso. */
  send(text: string): Promise<void>;
  interrupt(): Promise<void>;
  stop(): Promise<void>;
}
