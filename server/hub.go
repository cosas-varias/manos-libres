// El hub: inventario de sesiones y canal de control.
//
// No sabe nada de motores de agente ni de narración, y desde el cambio a HTTP/3 tampoco sabe
// nada de conexiones: eso vive en transporte.go. Aquí solo queda qué sesiones hay, cómo se
// abren y cómo se cierran, más el canal de control por el que se difunden los frames de
// despertar de las sesiones que nadie está siguiendo.
package main

import (
	"context"
	"fmt"
	"sync"
)

type Hub struct {
	cfg Config
	// El contexto de vida del nodo, no el de ninguna petición. Una sesión dura lo que dure
	// el trabajo, y el POST que la abre se responde en milisegundos: colgarla del contexto
	// de esa petición le manda un SIGINT al agente en cuanto se contesta.
	ctx context.Context

	mu       sync.Mutex
	sesiones map[string]*Sesion
	orden    []string // para listar en orden de creación y no al azar
	sigID    int

	// Suscriptores del canal de control. Reciben `session.list` y los frames de despertar.
	control map[Suscriptor]bool
}

func NuevoHub(ctx context.Context, cfg Config) *Hub {
	h := &Hub{
		cfg:      cfg,
		ctx:      ctx,
		sesiones: map[string]*Sesion{},
		sigID:    1,
		control:  map[Suscriptor]bool{},
	}
	// La sesión no conoce al hub; le pasamos por dónde difundir.
	difundir = h.Difundir
	return h
}

func (h *Hub) Sesion(id string) *Sesion {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.sesiones[id]
}

func (h *Hub) Listar() []InfoSesion {
	h.mu.Lock()
	sesiones := make([]*Sesion, 0, len(h.orden))
	for _, id := range h.orden {
		if s := h.sesiones[id]; s != nil {
			sesiones = append(sesiones, s)
		}
	}
	h.mu.Unlock()

	// Fuera del mutex del hub: `Info` toma el de la sesión y anidarlos invita a un abrazo
	// mortal el día que una sesión llame al hub.
	infos := make([]InfoSesion, 0, len(sesiones))
	for _, s := range sesiones {
		infos = append(infos, s.Info())
	}
	return infos
}

// Abrir crea una sesión y arranca su adaptador.
func (h *Hub) Abrir(cwd, titulo string) (*Sesion, error) {
	if !h.cfg.RaizPermitida(cwd) {
		return nil, fmt.Errorf("%s no está bajo ALLOWED_ROOTS", cwd)
	}

	h.mu.Lock()
	id := fmt.Sprintf("s_%d", h.sigID)
	h.sigID++
	s := NuevaSesion(id, NuevoAdaptadorClaudeCode(h.cfg), cwd, titulo, h.cfg.BufferReplay)
	h.sesiones[id] = s
	h.orden = append(h.orden, id)
	h.mu.Unlock()

	if err := s.Arrancar(h.ctx, h.cfg.ModeloAgente); err != nil {
		h.mu.Lock()
		delete(h.sesiones, id)
		h.mu.Unlock()
		return nil, err
	}
	h.AnunciarLista()
	return s, nil
}

// ── Canal de control ────────────────────────────────────────────────────────────────────

func (h *Hub) SuscribirControl(sub Suscriptor) {
	h.mu.Lock()
	h.control[sub] = true
	h.mu.Unlock()
}

func (h *Hub) DesuscribirControl(sub Suscriptor) {
	h.mu.Lock()
	delete(h.control, sub)
	h.mu.Unlock()
}

// Difundir manda un frame a todos los que escuchan el canal de control.
//
// Solo pasan por aquí los frames de despertar, y es la razón de que el canal exista: una
// sesión que la app no está siguiendo tiene que poder reclamar atención. La app deduplica
// por `sessionId` y `seq`, que es lo que hace barato que un frame llegue por los dos sitios.
func (h *Hub) Difundir(f Frame) {
	h.mu.Lock()
	subs := make([]Suscriptor, 0, len(h.control))
	for sub := range h.control {
		subs = append(subs, sub)
	}
	h.mu.Unlock()

	for _, sub := range subs {
		entregar(sub, f)
	}
}

func (h *Hub) AnunciarLista() {
	h.Difundir(&ListaSesiones{cabecera: cabecera{T: "session.list"}, Sesiones: h.Listar()})
}

func (h *Hub) Cerrar() {
	h.mu.Lock()
	sesiones := make([]*Sesion, 0, len(h.sesiones))
	for _, s := range h.sesiones {
		sesiones = append(sesiones, s)
	}
	h.sesiones = map[string]*Sesion{}
	h.orden = nil
	h.mu.Unlock()

	for _, s := range sesiones {
		_ = s.Cerrar()
	}
}
