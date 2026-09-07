// El filtro narrable y el segmentado en frases.
//
// Dos trabajos, y los dos se hacen aquí en el nodo y no en el móvil:
//
//  1. **Filtrar.** Un mensaje de un agente de código está lleno de cosas que no se pueden
//     escuchar: bloques de código, diffs, salidas de terminal, URLs. Se sustituyen por un
//     anuncio de una frase. Sin esto el modo voz es inusable.
//
//  2. **Segmentar.** La frase es la unidad de narración, y su índice —junto al id del
//     mensaje— es la coordenada que hace baratos el retroceso y la reanudación tras
//     reconectar. Si el segmentado viviera en el móvil, esa coordenada sería local y no se
//     podría compartir con el nodo.
package main

import (
	"fmt"
	"regexp"
	"strings"
	"unicode"
)

var nombresLenguaje = map[string]string{
	"ts": "TypeScript", "tsx": "TypeScript", "js": "JavaScript", "jsx": "JavaScript",
	"kt": "Kotlin", "java": "Java", "py": "Python", "rs": "Rust", "go": "Go",
	"sh": "shell", "bash": "shell", "json": "JSON", "yaml": "YAML", "yml": "YAML",
	"sql": "SQL", "html": "HTML", "css": "CSS", "diff": "diff", "md": "Markdown",
}

var (
	reBloque       = regexp.MustCompile("(?s)```([\\w+-]*)\\n(.*?)```")
	reEnlaceMd     = regexp.MustCompile(`\[([^\]]+)\]\([^)]+\)`)
	reUrl          = regexp.MustCompile(`https?://\S+`)
	reNegrita      = regexp.MustCompile(`\*\*([^*]+)\*\*`)
	reCodigo       = regexp.MustCompile("`([^`]+)`")
	reEncabezado   = regexp.MustCompile(`(?m)^#{1,6}\s+`)
	reVinneta      = regexp.MustCompile(`(?m)^\s*[-*]\s+`)
	reBlancos      = regexp.MustCompile(`\n{3,}`)
	reCabeceraDiff = regexp.MustCompile(`(?m)^[+-]{3} `)
)

// plural devuelve «un fichero» / «3 ficheros». El singular llega con su artículo porque el
// género lo decide la palabra: la versión en TypeScript lo fijaba en «una» y soltaba «una
// fichero» cada vez que un diff tocaba un solo archivo.
func plural(n int, sing, plur string) string {
	if n == 1 {
		return sing
	}
	return fmt.Sprintf("%d %s", n, plur)
}

// «Sigue un bloque de código: cuatro líneas de TypeScript.»
func anunciarCodigo(lang, cuerpo string) string {
	lineas := 0
	for _, l := range strings.Split(cuerpo, "\n") {
		if strings.TrimSpace(l) != "" {
			lineas++
		}
	}
	de := ""
	if lang != "" {
		nombre, ok := nombresLenguaje[lang]
		if !ok {
			nombre = lang
		}
		de = " de " + nombre
	}
	return fmt.Sprintf("Sigue un bloque de código: %s%s.", plural(lineas, "una línea", "líneas"), de)
}

// «Un diff: 3 ficheros, 40 añadidas, 12 quitadas.»
func anunciarDiff(cuerpo string) string {
	var ficheros, mas, menos int
	for _, l := range strings.Split(cuerpo, "\n") {
		switch {
		case strings.HasPrefix(l, "+++ "):
			ficheros++
		case strings.HasPrefix(l, "+++"), strings.HasPrefix(l, "---"):
		case strings.HasPrefix(l, "+"):
			mas++
		case strings.HasPrefix(l, "-"):
			menos++
		}
	}
	return fmt.Sprintf("Un diff: %s, %d añadidas, %d quitadas.",
		plural(ficheros, "un fichero", "ficheros"), mas, menos)
}

// ANarrable convierte texto markdown de un agente en algo que se pueda escuchar.
//
// TODO(H4): tablas, listas numeradas con «uno, dos…», y marcar los fragmentos de código en
// línea para que la app los pronuncie deletreando en vez de con voz española
// (ver docs/07-decisiones.md §6).
func ANarrable(texto string) Narrable {
	elididos := 0

	sinBloques := reBloque.ReplaceAllStringFunc(texto, func(m string) string {
		partes := reBloque.FindStringSubmatch(m)
		lang, cuerpo := partes[1], partes[2]
		elididos++
		if lang == "diff" || reCabeceraDiff.MatchString(cuerpo) {
			return "\n" + anunciarDiff(cuerpo) + "\n"
		}
		return "\n" + anunciarCodigo(lang, cuerpo) + "\n"
	})

	// Enlaces markdown: se dice el texto, no la URL.
	limpio := reEnlaceMd.ReplaceAllString(sinBloques, "$1")
	// URLs desnudas.
	limpio = reUrl.ReplaceAllStringFunc(limpio, func(string) string {
		elididos++
		return "un enlace"
	})
	// Énfasis y código en línea: se dice el contenido, sin los signos.
	limpio = reNegrita.ReplaceAllString(limpio, "$1")
	limpio = reCodigo.ReplaceAllString(limpio, "$1")
	limpio = reEncabezado.ReplaceAllString(limpio, "")
	limpio = reVinneta.ReplaceAllString(limpio, "")
	limpio = reBlancos.ReplaceAllString(limpio, "\n\n")

	return Narrable{Frases: Segmentar(limpio), Elididos: elididos}
}

// Segmentar corta en frases.
//
// La versión en TypeScript usaba `Intl.Segmenter`, que en Go no tiene equivalente en la
// biblioteca estándar y no compensa una dependencia. Un corte por puntuación terminal hace
// el mismo trabajo en español, con el mismo defecto: se equivoca con las abreviaturas y con
// los números de versión («2.1.263»), porque el punto le parece final de frase. Se remienda
// igual que allí, pegando al anterior los fragmentos que no pueden ser una frase.
func Segmentar(texto string) []string {
	var bruto []string
	var actual strings.Builder

	runas := []rune(texto)
	for i, r := range runas {
		actual.WriteRune(r)
		if r != '.' && r != '!' && r != '?' && r != '\n' && r != '…' {
			continue
		}
		// Termina la frase solo si lo que sigue es espacio o el final del texto: así
		// «fichero.go» o «3.14» no se parten por la mitad.
		if i+1 < len(runas) && !unicode.IsSpace(runas[i+1]) {
			continue
		}
		if s := strings.TrimSpace(actual.String()); s != "" {
			bruto = append(bruto, s)
		}
		actual.Reset()
	}
	if s := strings.TrimSpace(actual.String()); s != "" {
		bruto = append(bruto, s)
	}

	frases := make([]string, 0, len(bruto))
	for _, s := range bruto {
		if len(frases) > 0 && (len([]rune(s)) < 3 || acabaEnDigitoYPunto(frases[len(frases)-1])) {
			frases[len(frases)-1] += " " + s
			continue
		}
		frases = append(frases, s)
	}
	return frases
}

// «2.» y «1.» son cortes falsos de un número de versión, no frases.
func acabaEnDigitoYPunto(s string) bool {
	r := []rune(s)
	if len(r) < 2 || r[len(r)-1] != '.' {
		return false
	}
	return unicode.IsDigit(r[len(r)-2])
}

// EtiquetaHerramienta da una etiqueta corta y narrable para una llamada a herramienta:
// «editando protocolo.go», «buscando seq», «ejecutando go test».
//
// TODO(H4): cubrir las herramientas MCP, que traen nombres como `mcp__servidor__accion`.
func EtiquetaHerramienta(nombre string, input map[string]any) string {
	base := func(clave string) string {
		s, _ := input[clave].(string)
		if i := strings.LastIndex(s, "/"); i >= 0 {
			return s[i+1:]
		}
		return s
	}
	texto := func(claves ...string) string {
		for _, c := range claves {
			if s, ok := input[c].(string); ok && s != "" {
				return recortar(s, 60)
			}
		}
		return ""
	}

	switch nombre {
	case "Read":
		return "leyendo " + base("file_path")
	case "Edit":
		return "editando " + base("file_path")
	case "Write":
		return "escribiendo " + base("file_path")
	case "Bash":
		return "ejecutando " + texto("description", "command")
	case "Grep":
		return "buscando " + texto("pattern")
	case "Glob":
		return "listando ficheros"
	case "Task":
		return "delegando a un subagente"
	default:
		return nombre
	}
}

func recortar(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max])
}
