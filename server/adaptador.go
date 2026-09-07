// El contrato que cumple cualquier motor de agente.
//
// Un adaptador solo tiene que saber hacer cinco cosas: arrancar, aceptar texto del usuario,
// emitir eventos normalizados, pedir una decisión e interrumpir. Todo lo específico del
// motor —flags de la CLI, formas de sus mensajes, nombres de sus herramientas, su modelo de
// permisos— queda dentro del adaptador.
//
// El contrato es estrecho a propósito: es lo que permite añadir un motor sin tocar el hub ni
// el protocolo, y lo que se validará en H6 con un segundo motor.
package main

import "context"

// Clase de evento que emite un adaptador. La sesión lo numera y lo convierte en frames.
type ClaseEvento string

const (
	EvEstado      ClaseEvento = "state"
	EvDelta       ClaseEvento = "delta"
	EvMensaje     ClaseEvento = "message"
	EvHerramienta ClaseEvento = "tool"
	EvAviso       ClaseEvento = "alert"
	EvHecho       ClaseEvento = "done"
	EvError       ClaseEvento = "error"
)

// Evento es lo que un adaptador emite. Es un struct plano y no una unión porque en Go la
// alternativa —una interfaz por clase— obligaría a un type switch en cada consumidor sin
// ganar nada: el único consumidor es `Sesion.Emitir`.
type Evento struct {
	Clase ClaseEvento

	Estado  Estado // EvEstado
	Detalle string // EvEstado

	MessageID string // EvDelta, EvMensaje
	Texto     string // EvDelta, EvMensaje
	Rol       string // EvMensaje: assistant | user
	Tipo      string // EvMensaje: text | thinking | result | system

	ToolUseID string         // EvHerramienta
	Fase      string         // EvHerramienta: start | end
	Nombre    string         // EvHerramienta
	Input     map[string]any // EvHerramienta
	Ok        *bool          // EvHerramienta

	Patron  Patron // EvAviso
	Origen  string // EvAviso: agent | node
	Mensaje string // EvAviso, EvError
	Sonido  string // EvAviso

	Resumen    string  // EvHecho
	CosteUsd   float64 // EvHecho
	DuracionMs int64   // EvHecho
}

// PeticionDecision es una pregunta que el adaptador necesita que conteste una persona.
type PeticionDecision struct {
	Origen   Origen
	Pregunta string
	Opciones []Opcion
	Multiple bool
}

// RespuestaDecision es lo que vuelve del teléfono.
type RespuestaDecision struct {
	OpcionIDs []string
	Siempre   bool
}

// Anfitrion es lo que el adaptador puede hacer sobre su sesión.
//
// `Decidir` es la pieza interesante: **bloquea hasta que alguien contesta en el teléfono**.
// Mientras tanto el agente está parado. No hay plazo que lo resuelva por nosotros:
// preferimos un agente parado a un agente que hizo algo que nadie aprobó
// (ver docs/04-ux-manos-libres.md).
type Anfitrion interface {
	Emitir(Evento)
	Decidir(context.Context, PeticionDecision) (RespuestaDecision, error)
}

type OpcionesAdaptador struct {
	Cwd    string
	Modelo string
	// Sesión del propio motor a reanudar, si la hay.
	Reanudar string
}

type Adaptador interface {
	Motor() string
	// Id de sesión del propio motor, cuando lo publica. Sirve para reanudar.
	SesionDelMotor() string

	Arrancar(context.Context, Anfitrion, OpcionesAdaptador) error
	// Texto del usuario. El adaptador decide si encola o rechaza si hay turno en curso.
	Enviar(string) error
	Interrumpir() error
	Parar() error
}
