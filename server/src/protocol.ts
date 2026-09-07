/**
 * Protocolo `manos-libres/1`.
 *
 * Fuente de verdad de la conversación entre la app y el nodo. La app replica estos tipos
 * en Kotlin (`app/.../net/Protocol.kt`); cualquier cambio aquí se refleja allí.
 *
 * Reglas que el sistema de tipos no expresa y que están en docs/03-protocolo.md:
 *  - Todo frame nodo→app perteneciente a una sesión lleva `seq`, monótono por sesión.
 *  - El receptor ignora los `t` que no conoce: añadir frames no rompe compatibilidad.
 *  - Quitar un frame o cambiar la forma de uno existente exige `manos-libres/2`.
 */

export const PROTOCOL_VERSION = 'manos-libres/1' as const;

// ── Vocabulario compartido ───────────────────────────────────────────────────

/** Estado de una sesión. Lo único que la app mira para saber si «está pasando algo». */
export type SessionState =
  | 'idle'      // esperando al usuario
  | 'thinking'  // el modelo está generando
  | 'working'   // ejecutando herramientas
  | 'waiting'   // bloqueado en una decisión
  | 'error';

/**
 * Patrones hápticos. Son cuatro a propósito: en el bolsillo, con abrigo, no se distinguen
 * más. El mapeo a milisegundos es del cliente, no del protocolo.
 */
export type AlertPattern = 'corto' | 'doble' | 'largo' | 'urgente';

/**
 * Carga afectiva de una opción de decisión. Determina color, grosor de borde, icono y
 * háptica de confirmación — de modo que aprobar algo destructivo se *sienta* distinto de
 * aprobar algo inocuo, sin necesidad de leer.
 */
export type OptionTone = 'neutral' | 'go' | 'stop' | 'danger';

/** De dónde viene una decisión. Cambia el encabezado y si un plazo tiene sentido. */
export type DecisionSource = 'permission' | 'ask_user_question' | 'node';

export type MessageKind = 'text' | 'thinking' | 'result' | 'system';

export interface SessionInfo {
  sessionId: string;
  title: string;
  cwd: string;
  engine: string;
  state: SessionState;
  /** Último `seq` emitido. La app lo usa como `sinceSeq` al reconectar. */
  seq: number;
  updatedAt: number;
  /** Decisiones pendientes: reconectar no debe perder que el agente está bloqueado. */
  pendingDecisions: number;
}

/**
 * Lo que se narra, frente a lo que se ve.
 *
 * `sentences` es la unidad de narración: cada elemento se encola como una locución
 * independiente, y su índice —junto al `messageId`— es la coordenada estable que permite
 * el retroceso frase a frase y la continuidad tras reconectar.
 */
export interface Narratable {
  sentences: string[];
  /** Cuántos fragmentos (código, diffs, salidas) se sustituyeron por un anuncio. */
  elided: number;
}

export interface DecisionOption {
  id: string;
  /** Lo que se pinta en la franja: una o dos palabras, legible de reojo. */
  label: string;
  /** Lo que se pronuncia: sin puntuación rara ni identificadores en snake_case. */
  spoken: string;
  /** El detalle. Solo se muestra o se lee si el usuario lo pide. */
  description?: string;
  tone: OptionTone;
  /**
   * Marca la opción de «permitir siempre». Se pinta como una franja estrecha aparte, nunca
   * como una de las principales.
   */
  sticky?: boolean;
}

// ── App → nodo ───────────────────────────────────────────────────────────────

export type ClientFrame =
  | { t: 'auth'; token: string; device: string; protocol: string; signature?: string }
  | { t: 'sessions.list' }
  | { t: 'session.open'; cwd: string; engine?: string; title?: string }
  | { t: 'session.attach'; sessionId: string; sinceSeq: number }
  | { t: 'session.detach'; sessionId: string }
  | { t: 'prompt'; sessionId: string; text: string }
  | {
      t: 'decision.answer';
      sessionId: string;
      decisionId: string;
      optionIds: string[];
      /** El usuario eligió «permitir siempre»: aplica también `suggestions`. */
      always?: boolean;
    }
  | { t: 'interrupt'; sessionId: string }
  /**
   * Dónde va la narración. No es telemetría decorativa: es lo que permite que, tras
   * reconectar o despertar de un push, el nodo sepa qué ha oído ya el usuario.
   */
  | { t: 'narration'; sessionId: string; at: { messageId: string; sentence: number } }
  | { t: 'ping' };

// ── Nodo → app ───────────────────────────────────────────────────────────────

export type ServerFrame =
  | {
      t: 'hello';
      protocol: string;
      node: string;
      engines: string[];
      sessions: SessionInfo[];
      /** Reto a firmar con la clave del Keystore en el siguiente `auth`. */
      challenge?: string;
    }
  | { t: 'session.list'; sessions: SessionInfo[] }
  | { t: 'session.state'; sessionId: string; seq: number; state: SessionState; detail?: string }
  /** Texto en streaming. Solo para la pantalla: narrar deltas corta la entonación. */
  | { t: 'text.delta'; sessionId: string; seq: number; messageId: string; text: string }
  | {
      t: 'message';
      sessionId: string;
      seq: number;
      messageId: string;
      role: 'assistant' | 'user';
      kind: MessageKind;
      /** Lo que se ve. Recortado a 16 KiB por el nodo. */
      text: string;
      /** Lo que se oye. */
      narratable: Narratable;
    }
  /** Actividad de herramientas, ya resumida a una etiqueta corta y narrable. */
  | {
      t: 'tool';
      sessionId: string;
      seq: number;
      toolUseId: string;
      phase: 'start' | 'end';
      label: string;
      ok?: boolean;
    }
  | {
      t: 'decision.request';
      sessionId: string;
      seq: number;
      decisionId: string;
      source: DecisionSource;
      multiSelect: boolean;
      /** La pregunta tal cual, para la pantalla. */
      prompt: string;
      /** La pregunta más la enumeración de opciones, para la voz. */
      spoken: string;
      options: DecisionOption[];
      /**
       * Plazo informativo. Los permisos del agente no caducan, así que el nodo nunca
       * responde por el usuario: pasado el plazo solo insiste por push.
       */
      deadlineMs?: number;
    }
  | {
      t: 'decision.resolved';
      sessionId: string;
      seq: number;
      decisionId: string;
      resolution: 'answered' | 'cancelled' | 'expired';
      /** Qué dispositivo contestó, para avisar en los demás. */
      by?: string;
    }
  | {
      t: 'alert';
      sessionId: string;
      seq: number;
      pattern: AlertPattern;
      /** `agent` cuando lo pidió el agente con la herramienta `avisar`. */
      source: 'agent' | 'node';
      message?: string;
      spoken?: string;
      sound?: string;
    }
  | {
      t: 'task.done';
      sessionId: string;
      seq: number;
      summary: string;
      spoken: string;
      costUsd?: number;
      durationMs?: number;
    }
  | { t: 'error'; sessionId?: string; seq?: number; code: ErrorCode; message: string }
  | { t: 'pong' };

export type ErrorCode =
  | 'auth_failed'
  | 'protocol_mismatch'
  | 'session_gone'
  | 'replay_gap'
  | 'engine_error'
  | 'busy'
  | 'bad_request'
  | 'forbidden_path'
  | 'rate_limited';

/** Frames que, si no llegan por WebSocket, se reintentan por push. */
export const WAKEUP_FRAMES: ReadonlySet<ServerFrame['t']> = new Set([
  'alert',
  'decision.request',
  'task.done',
]);
