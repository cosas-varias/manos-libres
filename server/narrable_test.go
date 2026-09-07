package main

import (
	"strings"
	"testing"
)

func TestSegmentarNoParteNumerosNiRutas(t *testing.T) {
	casos := []struct {
		nombre string
		texto  string
		quiero []string
	}{
		{
			"frases normales",
			"Ya están los tests. Pasan los cuarenta y uno.",
			[]string{"Ya están los tests.", "Pasan los cuarenta y uno."},
		},
		{
			// El punto de un número de versión no termina una frase: es el fallo clásico
			// del segmentado, y la razón de que exista el remiendo.
			"número de versión",
			"Actualicé a la 2.1.263 y compila.",
			[]string{"Actualicé a la 2.1.263 y compila."},
		},
		{
			// Sin el «solo si sigue un espacio», esto se parte en «protocolo.» y «go».
			"nombre de fichero",
			"Toqué protocolo.go y sesion.go.",
			[]string{"Toqué protocolo.go y sesion.go."},
		},
		{
			"pregunta",
			"¿Sigo? Me quedan dos ficheros.",
			[]string{"¿Sigo?", "Me quedan dos ficheros."},
		},
	}

	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			tengo := Segmentar(c.texto)
			if len(tengo) != len(c.quiero) {
				t.Fatalf("%d frases, quería %d: %q", len(tengo), len(c.quiero), tengo)
			}
			for i := range tengo {
				if tengo[i] != c.quiero[i] {
					t.Errorf("frase %d = %q, quería %q", i, tengo[i], c.quiero[i])
				}
			}
		})
	}
}

func TestANarrableSustituyeLoQueNoSePuedeEscuchar(t *testing.T) {
	texto := "Cambié esto:\n\n```go\nfunc a() {}\n\nfunc b() {}\n```\n\nY mira " +
		"https://ejemplo.tld/algo para el resto."

	n := ANarrable(texto)
	todo := strings.Join(n.Frases, " ")

	if strings.Contains(todo, "func a()") {
		t.Errorf("el bloque de código sigue en la narración: %q", todo)
	}
	if !strings.Contains(todo, "2 líneas de Go") {
		t.Errorf("falta el anuncio del bloque: %q", todo)
	}
	if strings.Contains(todo, "https://") {
		t.Errorf("la URL sigue en la narración: %q", todo)
	}
	if !strings.Contains(todo, "un enlace") {
		t.Errorf("falta la sustitución de la URL: %q", todo)
	}
	// Un bloque de código y una URL.
	if n.Elididos != 2 {
		t.Errorf("Elididos = %d, quería 2", n.Elididos)
	}
}

func TestANarrableCuentaUnDiff(t *testing.T) {
	texto := "```diff\n--- a/x.go\n+++ b/x.go\n-viejo\n+nuevo\n+otro\n```"
	todo := strings.Join(ANarrable(texto).Frases, " ")

	if !strings.Contains(todo, "un fichero") {
		t.Errorf("no contó los ficheros: %q", todo)
	}
	if !strings.Contains(todo, "2 añadidas") || !strings.Contains(todo, "1 quitadas") {
		t.Errorf("no contó las líneas: %q", todo)
	}
}

func TestEnunciarNumeraLasOpciones(t *testing.T) {
	// El número es lo que permite contestar sin mirar, así que va delante siempre; y la
	// opción fija («permitir siempre») no entra en la numeración.
	hablada := Enunciar("¿Borro el fichero?", []Opcion{
		{ID: "allow", Hablada: "sí, adelante"},
		{ID: "deny", Hablada: "no, para"},
		{ID: "always", Hablada: "sí, y no preguntes más", Fija: true},
	})

	quiero := "¿Borro el fichero? Opción uno: sí, adelante. Opción dos: no, para."
	if hablada != quiero {
		t.Errorf("Enunciar() = %q\n            quería %q", hablada, quiero)
	}
}

func TestEtiquetaHerramientaUsaSoloElNombreDelFichero(t *testing.T) {
	// La ruta entera es ilegible en voz: «barra home barra usuario barra…».
	tengo := EtiquetaHerramienta("Edit", map[string]any{"file_path": "/home/jse/p/sesion.go"})
	if tengo != "editando sesion.go" {
		t.Errorf("EtiquetaHerramienta() = %q", tengo)
	}
}
