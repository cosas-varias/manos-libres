/**
 * Envío por push de lo que no se pudo entregar por WebSocket.
 *
 * El WebSocket solo existe mientras la app corre. Con el foreground service activo aguanta
 * la pantalla bloqueada y el segundo plano, pero si el sistema mata el proceso hace falta
 * despertar la app desde fuera.
 *
 * Regla: si un `alert`, un `task.done` o un `decision.request` no se entrega en 2 segundos,
 * se manda como push *data-only*.
 *
 * **El contenido nunca viaja en el push.** Va un identificador y un patrón; el texto se
 * recupera por el WebSocket cuando la app despierta. El push pasa por un tercero
 * (ver docs/05-seguridad.md §Datos) y el contenido del trabajo no tiene por qué pasar
 * por ahí.
 *
 * El proveedor está detrás de esta interfaz porque cuál usar sigue en discusión
 * (docs/07-decisiones-abiertas.md §3).
 */

import type { AlertPattern } from './protocol.js';

export interface Despertar {
  sessionId: string;
  /** `seq` desde el que la app debe pedir replay al reconectar. */
  seq: number;
  pattern: AlertPattern;
  /** Qué tipo de frame lo provocó, para elegir el canal de notificación. */
  motivo: 'alert' | 'decision' | 'done';
}

export interface PushProvider {
  readonly nombre: string;
  enviar(deviceToken: string, aviso: Despertar): Promise<void>;
}

class SinPush implements PushProvider {
  readonly nombre = 'none';
  async enviar(): Promise<void> {
    // H1 funciona sin push: la app tiene que estar abierta. H2 lo arregla.
  }
}

export function crearPushProvider(nombre: string): PushProvider {
  switch (nombre) {
    // TODO(H2): 'fcm' con una cuenta de servicio, y 'unifiedpush' contra un ntfy propio.
    default:
      return new SinPush();
  }
}
