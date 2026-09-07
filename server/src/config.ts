import { resolve, sep } from 'node:path';

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`falta la variable de entorno ${name} (ver .env.example)`);
  return v;
}

export const config = {
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 8787),
  devToken: req('DEV_TOKEN'),
  allowedRoots: req('ALLOWED_ROOTS').split(':').filter(Boolean).map((p) => resolve(p)),
  replayBuffer: Number(process.env.REPLAY_BUFFER ?? 500),
  defaultEngine: process.env.DEFAULT_ENGINE ?? 'claude-code',
  agentModel: process.env.AGENT_MODEL ?? 'opus',
  pushProvider: (process.env.PUSH_PROVIDER ?? 'none') as 'fcm' | 'unifiedpush' | 'none',
} as const;

/**
 * Un `cwd` solo se acepta si está bajo una de las raíces permitidas. Es la barrera que
 * evita abrir una sesión de agente en `/` o en `~/.ssh` desde el teléfono.
 */
export function isAllowedRoot(cwd: string): boolean {
  const target = resolve(cwd);
  return config.allowedRoots.some(
    (root) => target === root || target.startsWith(root + sep),
  );
}
