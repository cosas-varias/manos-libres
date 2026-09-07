/**
 * Una sesión de agente.
 *
 * Traduce los eventos del adaptador a frames del protocolo, los numera, los guarda para el
 * replay y los reparte entre los clientes suscritos. También es quien mantiene las
 * decisiones pendientes: mientras una lo esté, el agente está parado.
 */

import { aNarrable, etiquetaHerramienta } from './narratable.js';
import { config } from './config.js';
import type { AdapterHost, AgentAdapter, AgentEvent, DecisionAnswer, DecisionRequest } from './adapters/types.js';
import type { ServerFrame, SessionInfo, SessionState } from './protocol.js';

const MAX_TEXTO = 16 * 1024;

interface DecisionPendiente {
  id: string;
  request: DecisionRequest;
  resolver: (answer: DecisionAnswer) => void;
  desde: number;
}

export type Suscriptor = (frame: ServerFrame) => void;

export class Session implements AdapterHost {
  readonly sessionId: string;
  readonly cwd: string;
  readonly engine: string;
  title: string;
  state: SessionState = 'idle';

  private seq = 0;
  /** Buffer en anillo para `session.attach {sinceSeq}`. En memoria y volátil a propósito. */
  private replay: ServerFrame[] = [];
  private suscriptores = new Set<Suscriptor>();
  private decisiones = new Map<string, DecisionPendiente>();
  private siguienteDecision = 1;
  private ultimaActividad = Date.now();

  constructor(
    sessionId: string,
    private adapter: AgentAdapter,
    opts: { cwd: string; title?: string },
  ) {
    this.sessionId = sessionId;
    this.cwd = opts.cwd;
    this.engine = adapter.engine;
    this.title = opts.title ?? opts.cwd.split('/').pop() ?? sessionId;
  }

  async start(model: string): Promise<void> {
    await this.adapter.start(this, { cwd: this.cwd, model });
  }

  info(): SessionInfo {
    return {
      sessionId: this.sessionId,
      title: this.title,
      cwd: this.cwd,
      engine: this.engine,
      state: this.state,
      seq: this.seq,
      updatedAt: this.ultimaActividad,
      pendingDecisions: this.decisiones.size,
    };
  }

  // ── Suscripción y replay ───────────────────────────────────────────────────

  /**
   * Suscribe un cliente y le reenvía lo que se perdió.
   *
   * Devuelve `false` si `sinceSeq` es más viejo que el buffer: el hub debe entonces mandar
   * un `error` con `replay_gap` y un resumen, en vez de dejar al cliente creyendo que está
   * al día.
   */
  attach(sub: Suscriptor, sinceSeq: number): boolean {
    this.suscriptores.add(sub);

    const primero = this.replay[0];
    const hueco = primero !== undefined && seqDe(primero) > sinceSeq + 1;

    for (const frame of this.replay) {
      const s = seqDe(frame);
      if (s > sinceSeq) sub(frame);
    }
    // Las decisiones aún pendientes se reenvían siempre: reconectar no debe perder que el
    // agente está bloqueado esperando a una persona.
    for (const d of this.decisiones.values()) {
      sub(this.frameDecision(d));
    }
    return !hueco;
  }

  detach(sub: Suscriptor): void {
    this.suscriptores.delete(sub);
  }

  get suscriptoresActivos(): number {
    return this.suscriptores.size;
  }

  // ── Emisión ────────────────────────────────────────────────────────────────

  private publicar(frame: ServerFrame): void {
    this.ultimaActividad = Date.now();
    this.replay.push(frame);
    if (this.replay.length > config.replayBuffer) this.replay.shift();
    for (const sub of this.suscriptores) sub(frame);
    // TODO(H2): si no hay suscriptores y el frame está en WAKEUP_FRAMES, mandar push.
  }

  /** Implementa `AdapterHost.emit`: de evento normalizado a frame del protocolo. */
  emit(ev: AgentEvent): void {
    const seq = ++this.seq;
    const sessionId = this.sessionId;

    switch (ev.kind) {
      case 'state':
        this.state = ev.state;
        this.publicar({ t: 'session.state', sessionId, seq, state: ev.state, detail: ev.detail });
        break;

      case 'delta':
        this.publicar({ t: 'text.delta', sessionId, seq, messageId: ev.messageId, text: ev.text });
        break;

      case 'message': {
        const text = ev.text.length > MAX_TEXTO ? ev.text.slice(0, MAX_TEXTO) : ev.text;
        this.publicar({
          t: 'message',
          sessionId,
          seq,
          messageId: ev.messageId,
          role: ev.role,
          kind: ev.type,
          text,
          narratable: aNarrable(text),
        });
        break;
      }

      case 'tool':
        this.publicar({
          t: 'tool',
          sessionId,
          seq,
          toolUseId: ev.toolUseId,
          phase: ev.phase,
          label: etiquetaHerramienta(ev.name, ev.input),
          ok: ev.ok,
        });
        break;

      case 'alert':
        this.publicar({
          t: 'alert',
          sessionId,
          seq,
          pattern: ev.pattern,
          source: ev.source,
          message: ev.message,
          spoken: ev.message ? aNarrable(ev.message).sentences.join(' ') : undefined,
          sound: ev.sound,
        });
        break;

      case 'done':
        this.publicar({
          t: 'task.done',
          sessionId,
          seq,
          summary: ev.summary,
          spoken: aNarrable(ev.summary).sentences.slice(0, 2).join(' '),
          costUsd: ev.costUsd,
          durationMs: ev.durationMs,
        });
        break;

      case 'error':
        this.publicar({ t: 'error', sessionId, seq, code: 'engine_error', message: ev.message });
        break;
    }
  }

  // ── Decisiones ─────────────────────────────────────────────────────────────

  /**
   * Implementa `AdapterHost.decide`. La promesa se queda pendiente hasta que llega un
   * `decision.answer`. No hay plazo que la resuelva: un agente parado es preferible a un
   * agente que hizo algo que nadie aprobó.
   */
  decide(request: DecisionRequest): Promise<DecisionAnswer> {
    const id = `d_${this.siguienteDecision++}`;
    return new Promise<DecisionAnswer>((resolver) => {
      const pendiente: DecisionPendiente = { id, request, resolver, desde: Date.now() };
      this.decisiones.set(id, pendiente);
      this.seq += 1;
      this.publicar(this.frameDecision(pendiente));
      // TODO(H3): reinsistir por push a los 30 s y a los 5 min si sigue pendiente.
    });
  }

  answer(decisionId: string, optionIds: string[], always: boolean, by?: string): boolean {
    const pendiente = this.decisiones.get(decisionId);
    if (!pendiente) return false;
    this.decisiones.delete(decisionId);
    pendiente.resolver({ optionIds, always });
    this.publicar({
      t: 'decision.resolved',
      sessionId: this.sessionId,
      seq: ++this.seq,
      decisionId,
      resolution: 'answered',
      by,
    });
    return true;
  }

  private frameDecision(d: DecisionPendiente): ServerFrame {
    return {
      t: 'decision.request',
      sessionId: this.sessionId,
      seq: this.seq,
      decisionId: d.id,
      source: d.request.source,
      multiSelect: d.request.multiSelect,
      prompt: d.request.prompt,
      spoken: enunciar(d.request),
      options: d.request.options,
    };
  }

  // ── Ciclo de vida ──────────────────────────────────────────────────────────

  async prompt(text: string): Promise<void> {
    this.emit({ kind: 'state', state: 'thinking' });
    await this.adapter.send(text);
  }

  async interrupt(): Promise<void> {
    await this.adapter.interrupt();
  }

  async close(): Promise<void> {
    for (const d of this.decisiones.values()) {
      // Cerrar con decisiones pendientes las deniega: cerrar no puede significar aprobar.
      d.resolver({ optionIds: ['deny'], always: false });
    }
    this.decisiones.clear();
    await this.adapter.stop();
  }
}

/**
 * La versión hablada de una decisión: la pregunta, y las opciones numeradas.
 *
 * El número es lo que hace posible contestar sin mirar — por voz o por N pulsaciones del
 * botón del auricular— así que va delante de cada opción, siempre.
 */
function enunciar(request: DecisionRequest): string {
  const opciones = request.options
    .filter((o) => !o.sticky)
    .map((o, i) => `Opción ${i + 1}: ${o.spoken}.`)
    .join(' ');
  return `${request.prompt} ${opciones}`;
}

function seqDe(frame: ServerFrame): number {
  return 'seq' in frame && typeof frame.seq === 'number' ? frame.seq : 0;
}
