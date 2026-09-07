package main

import (
	"context"
	"testing"
	"time"
)

// adaptadorFalso deja arrancar una sesión sin un CLI detrás.
type adaptadorFalso struct{ enviados []string }

func (a *adaptadorFalso) Motor() string          { return "falso" }
func (a *adaptadorFalso) SesionDelMotor() string { return "" }
func (a *adaptadorFalso) Arrancar(context.Context, Anfitrion, OpcionesAdaptador) error {
	return nil
}
func (a *adaptadorFalso) Enviar(t string) error { a.enviados = append(a.enviados, t); return nil }
func (a *adaptadorFalso) Interrumpir() error    { return nil }
func (a *adaptadorFalso) Parar() error          { return nil }

func nuevaSesionDePrueba(maxReplay int) *Sesion {
	difundir = nil // el hub no participa en estas pruebas
	return NuevaSesion("s_1", &adaptadorFalso{}, "/tmp/proyecto", "", maxReplay)
}

func recibir(t *testing.T, sub Suscriptor) Frame {
	t.Helper()
	select {
	case f := <-sub:
		return f
	case <-time.After(time.Second):
		t.Fatal("no llegó ningún frame")
		return nil
	}
}

func TestSeqEsMonotonoYElTituloSaleDelCwd(t *testing.T) {
	s := nuevaSesionDePrueba(10)
	if s.Info().Titulo != "proyecto" {
		t.Errorf("Titulo = %q, quería el último tramo del cwd", s.Info().Titulo)
	}

	sub := make(Suscriptor, 8)
	s.Suscribir(sub, 0)

	for i := 0; i < 3; i++ {
		s.Emitir(Evento{Clase: EvMensaje, MessageID: "m", Rol: "assistant", Tipo: "text",
			Texto: "hola"})
	}
	for i := int64(1); i <= 3; i++ {
		if seq := recibir(t, sub).Seq(); seq != i {
			t.Errorf("seq = %d, quería %d", seq, i)
		}
	}
}

func TestReanudarSoloReenviaLoQueFalta(t *testing.T) {
	s := nuevaSesionDePrueba(10)
	for i := 0; i < 4; i++ {
		s.Emitir(Evento{Clase: EvEstado, Estado: EstadoTrabajando})
	}

	sub := make(Suscriptor, 8)
	if completo := s.Suscribir(sub, 2); !completo {
		t.Error("no debería haber hueco: el buffer llega hasta el seq 1")
	}

	// Se pidió desde el 2, así que llegan el 3 y el 4 y nada más.
	if seq := recibir(t, sub).Seq(); seq != 3 {
		t.Errorf("primer frame reenviado seq = %d, quería 3", seq)
	}
	if seq := recibir(t, sub).Seq(); seq != 4 {
		t.Errorf("segundo frame reenviado seq = %d, quería 4", seq)
	}
	select {
	case f := <-sub:
		t.Errorf("llegó un frame de más: %s seq=%d", f.Tipo(), f.Seq())
	default:
	}
}

func TestReanudarAvisaDelHueco(t *testing.T) {
	// Buffer de 2 y 5 frames emitidos: los tres primeros ya no están.
	s := nuevaSesionDePrueba(2)
	for i := 0; i < 5; i++ {
		s.Emitir(Evento{Clase: EvEstado, Estado: EstadoTrabajando})
	}

	sub := make(Suscriptor, 8)
	if completo := s.Suscribir(sub, 1); completo {
		t.Error("debería avisar de que faltan frames en vez de dejar al cliente creyéndose al día")
	}
}

func TestUnaDecisionBloqueaAlAgenteHastaQueAlguienContesta(t *testing.T) {
	s := nuevaSesionDePrueba(10)
	sub := make(Suscriptor, 8)
	s.Suscribir(sub, 0)

	respuestas := make(chan RespuestaDecision, 1)
	go func() {
		r, err := s.Decidir(context.Background(), PeticionDecision{
			Origen:   OrigenPermiso,
			Pregunta: "¿Borro?",
			Opciones: []Opcion{{ID: "allow"}, {ID: "deny"}},
		})
		if err != nil {
			t.Errorf("Decidir: %v", err)
		}
		respuestas <- r
	}()

	f := recibir(t, sub)
	pide, ok := f.(*PideDecision)
	if !ok {
		t.Fatalf("primer frame = %s, quería decision.request", f.Tipo())
	}
	if s.Info().Pendientes != 1 {
		t.Errorf("Pendientes = %d, quería 1", s.Info().Pendientes)
	}

	// Sin respuesta, el agente sigue parado.
	select {
	case <-respuestas:
		t.Fatal("Decidir volvió sin que nadie contestara")
	case <-time.After(50 * time.Millisecond):
	}

	if !s.Responder(pide.DecisionID, []string{"allow"}, false, "movil") {
		t.Fatal("Responder no encontró la decisión")
	}

	select {
	case r := <-respuestas:
		if len(r.OpcionIDs) != 1 || r.OpcionIDs[0] != "allow" {
			t.Errorf("respuesta = %v", r.OpcionIDs)
		}
	case <-time.After(time.Second):
		t.Fatal("Decidir no volvió tras contestar")
	}

	if s.Info().Pendientes != 0 {
		t.Errorf("Pendientes = %d tras contestar, quería 0", s.Info().Pendientes)
	}
}

func TestSegundaRespuestaALaMismaDecisionNoCuela(t *testing.T) {
	// Dos dispositivos contestan a la vez: el segundo tiene que enterarse de que ya está
	// resuelta, no reabrirla ni bloquear.
	s := nuevaSesionDePrueba(10)
	go s.Decidir(context.Background(), PeticionDecision{Pregunta: "¿?",
		Opciones: []Opcion{{ID: "allow"}}})

	sub := make(Suscriptor, 8)
	s.Suscribir(sub, 0)
	pide := recibir(t, sub).(*PideDecision)

	if !s.Responder(pide.DecisionID, []string{"allow"}, false, "movil") {
		t.Fatal("la primera respuesta debería valer")
	}
	if s.Responder(pide.DecisionID, []string{"deny"}, false, "reloj") {
		t.Error("la segunda respuesta no debería valer")
	}
}

func TestCerrarConDecisionesPendientesLasDeniega(t *testing.T) {
	// Cerrar no puede significar aprobar.
	s := nuevaSesionDePrueba(10)

	respuestas := make(chan RespuestaDecision, 1)
	go func() {
		r, _ := s.Decidir(context.Background(), PeticionDecision{Pregunta: "¿borro /?",
			Opciones: []Opcion{{ID: "allow"}, {ID: "deny"}}})
		respuestas <- r
	}()

	// Espera a que la decisión esté registrada antes de cerrar.
	for i := 0; i < 100 && s.Info().Pendientes == 0; i++ {
		time.Sleep(time.Millisecond)
	}

	if err := s.Cerrar(); err != nil {
		t.Fatalf("Cerrar: %v", err)
	}
	select {
	case r := <-respuestas:
		if len(r.OpcionIDs) != 1 || r.OpcionIDs[0] != "deny" {
			t.Errorf("al cerrar la respuesta fue %v, quería deny", r.OpcionIDs)
		}
	case <-time.After(time.Second):
		t.Fatal("cerrar dejó la decisión colgada")
	}
}

func TestUnSuscriptorLentoNoBloqueaAlAgente(t *testing.T) {
	// Cola de 1 y tres frames: el móvil lento pierde frames y reconectará pidiendo replay,
	// pero el agente no se queda esperándole.
	s := nuevaSesionDePrueba(10)
	lento := make(Suscriptor, 1)
	s.Suscribir(lento, 0)

	hecho := make(chan bool, 1)
	go func() {
		for i := 0; i < 3; i++ {
			s.Emitir(Evento{Clase: EvEstado, Estado: EstadoTrabajando})
		}
		hecho <- true
	}()

	select {
	case <-hecho:
	case <-time.After(time.Second):
		t.Fatal("el agente se bloqueó por un suscriptor que no vacía su cola")
	}
}

func TestElTextoSeRecortaAntesDeNarrarlo(t *testing.T) {
	s := nuevaSesionDePrueba(10)
	sub := make(Suscriptor, 4)
	s.Suscribir(sub, 0)

	largo := ""
	for len(largo) < MaxTexto*2 {
		largo += "palabra "
	}
	s.Emitir(Evento{Clase: EvMensaje, MessageID: "m", Rol: "assistant", Tipo: "text", Texto: largo})

	msg := recibir(t, sub).(*Mensaje)
	if len([]rune(msg.Texto)) > MaxTexto {
		t.Errorf("el texto no se recortó: %d runas", len([]rune(msg.Texto)))
	}
}
