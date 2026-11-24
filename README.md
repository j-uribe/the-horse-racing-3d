# 🏇 The Horse Racing

Sortea turnos y órdenes con una carrera de caballos con estilo de transmisión hípica.

La carrera se transmite en 3D:

- **Óvalo completo**: largada en la recta opuesta, curva y recta final frente a la tribuna, con laguna en el césped interior y cordillera alrededor.
- **Caballos y jinetes 3D** armados por código (sin modelos externos). Se cierran hacia la baranda y abren por fuera para adelantar; es solo escenificación, el orden de llegada sigue siendo el sorteado.
- **Tres cámaras** (Transmisión, Cerca y Aérea; teclas 1, 2 y 3) y nombres flotando sobre cada caballo.
- **Repetición de la llegada** vista de frente y en cámara lenta (opcional).
- **Podio** con los tres primeros, el ganador celebrando y papel picado.
- **Público animado** que se levanta y salta en la recta final.
- **Hora del día**: tarde, atardecer, noche con focos o al azar (el azar sale de la semilla, así que un enlace compartido se ve igual).
- **Video de la llegada**: se graba solo desde unos segundos antes del disco hasta el podio y se descarga desde el resultado (MP4 o WebM según el navegador).

**▶ Jugar:** https://rinorambuena.github.io/the-horse-racing/

- **Sorteo justo:** el orden de llegada se sortea antes de largar (Fisher–Yates con una semilla del generador criptográfico del navegador). **Cada orden posible tiene la misma probabilidad.** La carrera solo lo escenifica: remontadas, imprevistos y llegadas apretadas no cambian quién gana.
- **Transmisión:** cámara que sigue al grupo de punta, zoom y cámara lenta en los últimos metros, y fotografía en blanco y negro cuando la llegada es estrecha.
- **Relato en vivo** en pantalla y, si quieres, por voz (Web Speech API).
- **Imprevistos opcionales:** lluvia (pista pesada), trastabillones, salida lenta, caballo desbocado y colapso. El caballo que colapsa ya estaba sorteado último.
- **Zoom al último lugar (opcional):** tras anunciar al ganador, repetición en cámara lenta de la lucha por el último puesto, con fotografía si llegan juntos.
- **Resultado oficial** con márgenes (nariz, cabeza, cuerpos), botón para copiar el orden y un enlace que reproduce la misma carrera.
- De 2 a 12 participantes, con mandiles numerados en los colores estándar.

Sin frameworks y sin compilar: HTML, CSS y JavaScript (módulos ES). La escena 3D usa [Three.js](https://threejs.org) 0.160, importado como módulo desde jsDelivr. El sonido está sintetizado con Web Audio.

## Publicación

El sitio se publica con GitHub Pages desde la rama `master`, carpeta raíz (**Settings → Pages → Deploy from a branch**). Cada cambio en `master` se refleja en https://rinorambuena.github.io/the-horse-racing/ en uno o dos minutos.

Una carrera compartida es un enlace con los participantes y la semilla; quien lo abre ve exactamente la misma carrera:

```
https://rinorambuena.github.io/the-horse-racing/?p=Ana|Benjamín|Constanza&s=<semilla>&d=30&e=20-35-25-0
```

El botón **Compartir carrera** del resultado lo genera solo.

## Probar en local

Los módulos ES no cargan si abres `index.html` con doble clic (`file://`). Levanta un servidor simple en la carpeta:

```bash
python3 -m http.server 8000
# y abre http://localhost:8000
```

## Estructura

```
index.html
styles.css
js/
  app.js         interfaz, bucle principal, resultados y enlaces
  race.js        sorteo del orden y coreografía de la carrera (determinista por semilla)
  rng.js         generador con semilla y barajado uniforme
  render.js      escena 3D: óvalo, partidor, tribuna con público, cámaras, hora del día, lluvia, podio, nombres y minimapa
  track.js       geometría del óvalo (metros recorridos y distancia a la baranda → mundo)
  lanes.js       trayectoria lateral de cada caballo: cerrarse, abrirse para adelantar, no montarse
  recorder.js    grabación de la llegada en video
  horse3d.js     caballo y jinete 3D hechos con primitivas, con la animación del galope
  commentary.js  relator
  audio.js       sonido (Web Audio) y voz
```

## Licencia

MIT — ver [LICENSE](LICENSE).
