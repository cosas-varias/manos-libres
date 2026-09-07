/**
 * El hub: conexiones, autenticación y encaminamiento de frames.
 *
 * Mantiene el inventario de sesiones y traduce cada `ClientFrame` en una llamada a la
 * sesión correspondiente. No sabe nada de motores de agente ni de narración.
 */

import type { WebSocket, WebSocketServer } from 'ws';
import { config, isAllowedRoot } from './config.js';
import { Session, type Suscriptor } from './session.js';
import { ClaudeCodeAdapter } from './adapters/claude-code.js';
import { PROTOCOL_VERSION, type ClientFrame, type ErrorCode, type ServerFrame } from './protocol.js';

interface Conexion {
  ws: WebSocket;
  device: string;
  autenticada: boolean;
  suscripciones: Map<string, Suscriptor>;
}

export class Hub {
  private sesiones = new Map<string, Session>();
  private siguienteSesion = 1;

  constructor(wss: WebSocketServer) {
    wss.on('connection', (ws) => this.aceptar(ws));
  }

  private aceptar(ws: WebSocket): void {
    const con: Conexion = { ws, device: 'desconocido', autenticada: false, suscripciones: new Map() };

    // Sin `auth` en 5 segundos, fuera. Evita conexiones colgadas de escaneos.
    const plazo = setTimeout(() => {
      if (!con.autenticada) ws.close(4001, 'auth timeout');
    }, 5000);

    ws.on('message', (data) => {
      let frame: ClientFrame;
      try {
        frame = JSON.parse(String(data)) as ClientFrame;
      } catch {
        return enviarError(ws, 'bad_request', 'frame no es JSON válido');
      }
      this.manejar(con, frame).catch((err) => {
        enviarError(ws, 'engine_error', err instanceof Error ? err.message : String(err));
      });
    });

    ws.on('close', () => {
      clearTimeout(plazo);
      for (const [sessionId, sub] of con.suscripciones) {
        this.sesiones.get(sessionId)?.detach(sub);
      }
    });
  }

  private async manejar(con: Conexion, frame: ClientFrame): Promise<void> {
    if (frame.t === 'auth') {
      if (frame.protocol !== PROTOCOL_VERSION) {
        return enviarError(con.ws, 'protocol_mismatch', `este nodo habla ${PROTOCOL_VERSION}`);
      }
      // TODO(H6): sustituir por token de dispositivo + firma Ed25519 del reto del `hello`
      // (ver docs/05-seguridad.md §Emparejamiento). Comparación en tiempo constante.
      if (frame.token !== config.devToken) {
        return enviarError(con.ws, 'auth_failed', 'token inválido');
      }
      con.autenticada = true;
      con.device = frame.device;
      return enviar(con.ws, {
        t: 'hello',
        protocol: PROTOCOL_VERSION,
        node: 'manos-libres/nodo 0.0.0',
        engines: ['claude-code'],
        sessions: [...this.sesiones.values()].map((s) => s.info()),
      });
    }

    if (!con.autenticada) return enviarError(con.ws, 'auth_failed', 'falta autenticarse');

    switch (frame.t) {
      case 'ping':
        return enviar(con.ws, { t: 'pong' });

      case 'sessions.list':
        return enviar(con.ws, {
          t: 'session.list',
          sessions: [...this.sesiones.values()].map((s) => s.info()),
        });

      case 'session.open': {
        if (!isAllowedRoot(frame.cwd)) {
          return enviarError(con.ws, 'forbidden_path', `${frame.cwd} no está bajo ALLOWED_ROOTS`);
        }
        const sessionId = `s_${this.siguienteSesion++}`;
        const sesion = new Session(sessionId, new ClaudeCodeAdapter(), {
          cwd: frame.cwd,
          title: frame.title,
        });
        this.sesiones.set(sessionId, sesion);
        await sesion.start(config.agentModel);
        this.suscribir(con, sesion, 0);
        return enviar(con.ws, {
          t: 'session.list',
          sessions: [...this.sesiones.values()].map((s) => s.info()),
        });
      }

      case 'session.attach': {
        const sesion = this.sesiones.get(frame.sessionId);
        if (!sesion) return enviarError(con.ws, 'session_gone', frame.sessionId);
        const completo = this.suscribir(con, sesion, frame.sinceSeq);
        if (!completo) {
          enviarError(con.ws, 'replay_gap', 'faltan frames: el buffer no llega tan atrás');
        }
        return;
      }

      case 'session.detach': {
        const sub = con.suscripciones.get(frame.sessionId);
        if (sub) {
          this.sesiones.get(frame.sessionId)?.detach(sub);
          con.suscripciones.delete(frame.sessionId);
        }
        return;
      }

      case 'prompt': {
        const sesion = this.sesiones.get(frame.sessionId);
        if (!sesion) return enviarError(con.ws, 'session_gone', frame.sessionId);
        return sesion.prompt(frame.text);
      }

      case 'decision.answer': {
        const sesion = this.sesiones.get(frame.sessionId);
        if (!sesion) return enviarError(con.ws, 'session_gone', frame.sessionId);
        const ok = sesion.answer(frame.decisionId, frame.optionIds, frame.always ?? false, con.device);
        if (!ok) {
          // Ya la contestó otro dispositivo. No es un error del cliente: se le informa y
          // su pantalla de decisión se cierra sola.
          enviar(con.ws, {
            t: 'decision.resolved',
            sessionId: frame.sessionId,
            seq: sesion.info().seq,
            decisionId: frame.decisionId,
            resolution: 'answered',
          });
        }
        return;
      }

      case 'interrupt': {
        const sesion = this.sesiones.get(frame.sessionId);
        if (!sesion) return enviarError(con.ws, 'session_gone', frame.sessionId);
        return sesion.interrupt();
      }

      case 'narration':
        // TODO(H4): guardar la posición por dispositivo, para que un push que despierta la
        // app pueda reanudar la narración donde se quedó.
        return;

      default:
        // Frame desconocido: se ignora. Añadir frames no debe romper a un nodo viejo.
        return;
    }
  }

  private suscribir(con: Conexion, sesion: Session, sinceSeq: number): boolean {
    const previa = con.suscripciones.get(sesion.sessionId);
    if (previa) sesion.detach(previa);
    const sub: Suscriptor = (frame) => enviar(con.ws, frame);
    con.suscripciones.set(sesion.sessionId, sub);
    return sesion.attach(sub, sinceSeq);
  }

  async cerrar(): Promise<void> {
    await Promise.all([...this.sesiones.values()].map((s) => s.close()));
    this.sesiones.clear();
  }
}

function enviar(ws: WebSocket, frame: ServerFrame): void {
  ws.send(JSON.stringify(frame));
}

function enviarError(ws: WebSocket, code: ErrorCode, message: string): void {
  enviar(ws, { t: 'error', code, message });
}
