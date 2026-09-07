# 1. Visión

## El problema

Trabajar con un agente de IA en un ordenador funciona porque hay un teclado y una pantalla
grande. En el móvil, la misma interacción se rompe por tres sitios:

- **Espera ciega.** El agente tarda minutos en tareas largas. Con la app actual hay que
  volver a abrirla y mirar para saber si terminó, o si está bloqueado esperando permiso.
- **Lectura obligatoria.** Todo el estado del agente llega como texto. Para saber qué pasa
  hay que leer, y leer en el móvil exige mirar fijamente una pantalla pequeña.
- **Decisiones de precisión.** Las preguntas del agente («¿aplico este cambio?»,
  «¿qué enfoque prefieres?») se contestan tocando enlaces o botones pequeños, lo que exige
  atención visual completa justo en el momento menos oportuno.

El resultado es que el móvil solo sirve para consultar, no para trabajar. Las tareas largas
—las que más se beneficiarían de lanzarse y olvidarse— son precisamente las peores.

## El usuario

Alguien que ya tiene agentes corriendo en su propio servidor y que quiere dirigirlos
mientras hace otra cosa: andando por la calle, en el coche, en el gimnasio, cocinando, o
simplemente lejos del escritorio. Sabe qué está construyendo; no necesita que el móvil le
enseñe el diff, necesita que le diga qué ha pasado y le deje decidir.

## Principios de diseño

1. **El oído es el canal principal; la vista es el canal de excepción.** Todo estado
   relevante debe poder consumirse sin mirar. La pantalla se usa cuando hay que decidir.
2. **Ningún estado del agente se descubre mirando.** Si algo cambia y te afecta, el
   teléfono te lo dice: vibra, suena, o lo narra. El silencio significa «sigue trabajando».
3. **Un gesto, un significado, en toda la app.** El vocabulario de gestos es pequeño y
   estable. Se aprende una vez y funciona con el teléfono en el bolsillo.
4. **Los objetivos táctiles se miden en centímetros, no en píxeles.** Una decisión ocupa la
   pantalla entera dividida en franjas; nada que haya que apuntar con la vista.
5. **No se lee en voz alta lo que no se puede escuchar.** El código, los diffs y las salidas
   de terminal se *anuncian* («treinta y dos líneas en `Narrator.kt`»), no se recitan.
6. **El servidor piensa, el móvil reacciona.** Segmentado en frases, resumen narrable y
   estado de sesión se calculan en el nodo. Así el móvil puede caerse, reconectar y seguir
   exactamente donde estaba.
7. **Toda acción destructiva pasa por una decisión explícita.** Un canal remoto que aprueba
   permisos es un canal de ejecución remota; el diseño lo trata como tal
   ([05-seguridad.md](05-seguridad.md)).

## Lo que esta app no es

- **No es un editor.** No se revisan diffs línea a línea ni se navega el árbol de ficheros.
  Para eso está el ordenador.
- **No es un cliente de chat de propósito general.** No compite con la app de Claude en
  conversación libre; compite en *supervisión de trabajo en curso*.
- **No ejecuta el agente en el teléfono.** El agente vive en tu servidor, con tu sistema de
  ficheros, tu repo y tus credenciales. El móvil es un mando a distancia.
- **No aloja nada nuestro.** No hay servicio central, no hay cuenta que crear. Tu nodo, tu
  suscripción, tu dominio.

## Cómo sabremos que funciona

Métricas de la propia experiencia, no del producto:

- Una tarea de 20 minutos se supervisa de principio a fin **sin desbloquear el teléfono**.
- Desde que el agente pregunta hasta que recibe respuesta pasan **menos de 10 segundos**
  con el móvil en el bolsillo.
- Al final de una sesión de narración, el usuario **sabe qué se ha hecho** sin haber leído
  la pantalla.
