/**
 * El filtro narrable y el segmentado en frases.
 *
 * Dos trabajos, y los dos se hacen aquí en el nodo y no en el móvil:
 *
 *  1. **Filtrar.** Un mensaje de un agente de código está lleno de cosas que no se pueden
 *     escuchar: bloques de código, diffs, salidas de terminal, URLs. Se sustituyen por un
 *     anuncio de una frase. Sin esto el modo voz es inusable.
 *
 *  2. **Segmentar.** La frase es la unidad de narración, y su índice —junto al id del
 *     mensaje— es la coordenada que hace baratos el retroceso y la reanudación tras
 *     reconectar. Si el segmentado viviera en el móvil, esa coordenada sería local y no se
 *     podría compartir con el nodo.
 */

import type { Narratable } from './protocol.js';

const NOMBRES_LENGUAJE: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript',
  kt: 'Kotlin', java: 'Java', py: 'Python', rs: 'Rust', go: 'Go',
  sh: 'shell', bash: 'shell', json: 'JSON', yaml: 'YAML', yml: 'YAML',
  sql: 'SQL', html: 'HTML', css: 'CSS', diff: 'diff', md: 'Markdown',
};

function plural(n: number, sing: string, plur: string): string {
  return n === 1 ? `una ${sing}` : `${n} ${plur}`;
}

/** «sigue un bloque de código: cuatro líneas de TypeScript» */
function anunciarCodigo(lang: string | undefined, cuerpo: string): string {
  const lineas = cuerpo.split('\n').filter((l) => l.trim() !== '').length;
  const nombre = lang ? NOMBRES_LENGUAJE[lang] ?? lang : undefined;
  const de = nombre ? ` de ${nombre}` : '';
  return `Sigue un bloque de código: ${plural(lineas, 'línea', 'líneas')}${de}.`;
}

/** «un diff: 3 ficheros, 40 líneas añadidas, 12 quitadas» */
function anunciarDiff(cuerpo: string): string {
  const lineas = cuerpo.split('\n');
  const ficheros = lineas.filter((l) => l.startsWith('+++ ')).length;
  const mas = lineas.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length;
  const menos = lineas.filter((l) => l.startsWith('-') && !l.startsWith('---')).length;
  return `Un diff: ${plural(ficheros, 'fichero', 'ficheros')}, ${mas} añadidas, ${menos} quitadas.`;
}

/**
 * Convierte texto markdown de un agente en algo que se pueda escuchar.
 *
 * TODO(H4): tablas, listas numeradas con «uno, dos…», y marcar los fragmentos de código
 * en línea para que la app los pronuncie deletreando en vez de con voz española
 * (ver docs/07-decisiones-abiertas.md §6).
 */
export function aNarrable(texto: string): Narratable {
  let elided = 0;

  const sinBloques = texto.replace(
    /```([\w+-]*)\n([\s\S]*?)```/g,
    (_m, lang: string, cuerpo: string) => {
      elided += 1;
      const esDiff = lang === 'diff' || /^[+-]{3} /m.test(cuerpo);
      return `\n${esDiff ? anunciarDiff(cuerpo) : anunciarCodigo(lang || undefined, cuerpo)}\n`;
    },
  );

  const limpio = sinBloques
    // enlaces markdown: se dice el texto, no la URL
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1')
    // URLs desnudas
    .replace(/https?:\/\/\S+/g, () => {
      elided += 1;
      return 'un enlace';
    })
    // énfasis y código en línea: se dice el contenido, sin los signos
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(?<!`)`([^`]+)`(?!`)/g, '$1')
    // encabezados
    .replace(/^#{1,6}\s+/gm, '')
    // viñetas
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n');

  return { sentences: segmentar(limpio), elided };
}

/**
 * Corta en frases.
 *
 * `Intl.Segmenter` con granularidad de frase hace el trabajo bien en español y evita
 * dependencias, pero se equivoca con las abreviaturas y con los números de versión
 * («2.1.263») porque el punto le parece final de frase. Se remienda pegando los
 * fragmentos demasiado cortos al anterior.
 */
export function segmentar(texto: string, locale = 'es'): string[] {
  const seg = new Intl.Segmenter(locale, { granularity: 'sentence' });
  const bruto: string[] = [];
  for (const parte of seg.segment(texto)) {
    const s = parte.segment.trim();
    if (s) bruto.push(s);
  }

  const frases: string[] = [];
  for (const s of bruto) {
    const previa = frases[frases.length - 1];
    // Un fragmento de menos de 3 caracteres, o que sigue a algo que acaba en dígito,
    // casi siempre es un falso corte («2.» + «1.» + «263»).
    if (previa !== undefined && (s.length < 3 || /\d\.$/.test(previa))) {
      frases[frases.length - 1] = `${previa} ${s}`;
    } else {
      frases.push(s);
    }
  }
  return frases;
}

/**
 * Etiqueta corta y narrable para una llamada a herramienta: «editando protocol.ts»,
 * «buscando "seq"», «ejecutando npm test».
 *
 * TODO(H4): cubrir las herramientas MCP, que traen nombres como `mcp__servidor__accion`.
 */
export function etiquetaHerramienta(nombre: string, input: Record<string, unknown>): string {
  const base = (p: unknown) => (typeof p === 'string' ? p.split('/').pop() ?? p : '');
  switch (nombre) {
    case 'Read':  return `leyendo ${base(input['file_path'])}`;
    case 'Edit':  return `editando ${base(input['file_path'])}`;
    case 'Write': return `escribiendo ${base(input['file_path'])}`;
    case 'Bash':  return `ejecutando ${String(input['description'] ?? input['command'] ?? '').slice(0, 60)}`;
    case 'Grep':  return `buscando ${String(input['pattern'] ?? '')}`;
    case 'Glob':  return `listando ficheros`;
    case 'Task':  return `delegando a un subagente`;
    default:      return nombre;
  }
}
