# 🏇 The Horse Racing

Sortea turnos y órdenes con una carrera de caballos con estilo de transmisión hípica.

- **Sorteo justo:** el orden de llegada se sortea antes de largar (Fisher–Yates con una semilla del generador criptográfico del navegador). **Cada orden posible tiene la misma probabilidad.** La carrera solo lo escenifica: remontadas, imprevistos y llegadas apretadas no cambian quién gana.
- **Transmisión:** cámara que sigue al grupo de punta, zoom y cámara lenta en los últimos metros, y fotografía en blanco y negro cuando la llegada es estrecha.
- **Relato en vivo** en pantalla y, si quieres, por voz (Web Speech API).
- **Imprevistos opcionales:** lluvia (pista pesada), trastabillones, salida lenta, caballo desbocado y colapso. El caballo que colapsa ya estaba sorteado último.
- **Zoom al último lugar (opcional):** tras anunciar al ganador, repetición en cámara lenta de la lucha por el último puesto, con fotografía si llegan juntos.
- **Resultado oficial** con márgenes (nariz, cabeza, cuerpos), botón para copiar el orden y un enlace que reproduce la misma carrera.
- De 2 a 12 participantes, con mandiles numerados en los colores estándar.

Sin frameworks, sin dependencias y sin compilar: HTML, CSS y JavaScript (módulos ES) dibujado en `<canvas>`. El sonido está sintetizado con Web Audio.

## Publicar en GitHub Pages

1. Crea un repositorio y sube todos los archivos tal cual (`index.html`, `styles.css` y la carpeta `js/`).
2. En el repositorio, entra a **Settings → Pages**.
3. En **Source**, elige *Deploy from a branch*, la rama `main` y la carpeta `/ (root)`. Guarda.
4. Al minuto queda en `https://<tu-usuario>.github.io/<repo>/`.

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
  render.js      escena: paisaje, pista, cámara, zoom, fotografía
  horse.js       dibujo procedural del caballo y el jinete
  commentary.js  relator
  audio.js       sonido (Web Audio) y voz
```

## Licencia

MIT
