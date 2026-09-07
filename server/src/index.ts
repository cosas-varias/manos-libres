/**
 * Arranque del nodo.
 *
 * Escucha en loopback a propósito: el TLS lo termina Caddy o nginx delante
 * (ver server/README.md). Exponer esto directamente a internet sin TLS sería publicar una
 * shell en tu máquina.
 */

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { Hub } from './hub.js';

const http = createServer((req, res) => {
  if (req.url === '/salud') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, protocolo: 'manos-libres/1' }));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server: http, maxPayload: 64 * 1024 });
const hub = new Hub(wss);

http.listen(config.port, config.host, () => {
  console.log(`nodo escuchando en ws://${config.host}:${config.port}`);
  console.log(`raíces permitidas: ${config.allowedRoots.join(', ')}`);
  if (process.env['ANTHROPIC_API_KEY']) {
    console.warn(
      'ANTHROPIC_API_KEY está definida: se facturará por token contra la API en lugar de ' +
        'usar la suscripción. Quítala si no era lo que querías.',
    );
  }
});

for (const senal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(senal, () => {
    console.log('\ncerrando sesiones…');
    hub.cerrar().finally(() => process.exit(0));
  });
}
