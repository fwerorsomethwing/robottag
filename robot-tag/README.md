# Robot Tag

Juego multijugador estilo **Gorilla Tag de 2020** (jugadores robot) para el navegador, con Three.js, un servidor Node con WebSocket y **soporte VR (WebXR)**.

## Cómo correrlo

```bash
npm install
npm start          # http://localhost:3000
npm run https      # https://TU-IP:3000 (necesario para VR por red local)
npm test           # todas las pruebas
```

Abre la URL en una o varias pestañas (o en otros equipos de tu red) y juega.

## VR (Meta Quest y otros visores WebXR)

WebXR solo funciona en **contexto seguro** (HTTPS o `localhost`). Dos formas de usarlo con un Quest:

1. **HTTPS por red local**: en el PC ejecuta `npm run https`. En el navegador del Quest abre `https://IP-DEL-PC:3000`, acepta el aviso del certificado autofirmado (Avanzado → Continuar) y pulsa **ENTRAR EN VR**. El certificado se guarda en `cert/` y se reutiliza.
2. **Cable USB**: con `adb reverse tcp:3000 tcp:3000` y `npm start`, abre `http://localhost:3000` en el Quest.

### Controles en VR

- **Mueve los brazos y toca el suelo, las paredes, el cubo o la esfera**: tu cuerpo se mueve al revés que la mano, como en Gorilla Tag. Empuja hacia abajo/atrás alternando manos para correr y saltar.
- Al soltar la superficie sales lanzado con la velocidad de tus manos (tope de salto 6,5 m/s; el jugador LAVA va un 12 % más rápido).
- **Stick derecho**: giro de 45° por salto.
- Los mandos vibran al tocar una superficie.
- Panel pequeño abajo a la izquierda con jugadores, estado y velocidad; los avisos (¡Eres LAVA!) salen en el centro.
- Al salir de VR vuelves al menú y puedes seguir en PC.

## Compilar como APK (Android)

El APK es un envoltorio (Capacitor) que abre el juego desde tu servidor, así que **el servidor tiene que estar en internet con HTTPS**. Pasos:

1. **Aloja el servidor.** Sube esta carpeta a un hosting con Node (Render, Railway, Fly.io...). Comando de arranque: `npm start` (usa la variable `PORT` del hosting). Te dará una dirección `https://...`; ábrela en el navegador para comprobar que el juego carga.
2. **Compila el APK sin instalar nada** (GitHub Actions):
   - Sube el proyecto a un repositorio de GitHub.
   - En el repositorio: *Settings → Secrets and variables → Actions → Variables* → crea la variable `GAME_URL` con tu dirección `https://...`.
   - Pestaña *Actions* → **Compilar APK** → *Run workflow*. Al terminar, descarga `robot-tag-apk` (contiene `app-debug.apk`).
3. **Instálalo.** Pasa el APK al teléfono/visor y ábrelo (activa "instalar apps desconocidas"), o usa `adb install app-debug.apk`. En un Quest se instala con SideQuest.

Para compilar en tu PC en vez de GitHub: instala Node, Java 17 y Android Studio, pon tu URL en `android-app/capacitor.config.json` y ejecuta:

```bash
cd android-app
npm install
npx cap add android
npx cap sync android
npx cap open android      # en Android Studio: Build -> Build APK(s)
```

Notas:
- El APK de este flujo es de depuración (firmado con la clave de debug): sirve para instalarlo a mano, no para subirlo a Google Play.
- En el teléfono el juego usa controles táctiles: arrastra el dedo para mirar y pulsa **MANO IZQ / MANO DER** para empujar el suelo o las paredes hacia donde apunta la mira.
- **El modo VR (WebXR) puede no funcionar dentro de un WebView de Android**; para VR en Quest lo seguro es abrir la dirección del juego en el navegador del visor.

## Multijugador en línea (1.0.2)

El juego solo es "en línea" cuando el servidor está en internet. En tu PC es local (solo tu wifi).

1. Sube la carpeta a un repositorio de GitHub (sin `node_modules`).
2. En [render.com](https://render.com): **New → Blueprint**, elige el repositorio. Ya trae `render.yaml`. Te da una dirección `https://robot-tag-xxxx.onrender.com`.
3. Cualquiera abre esa dirección (PC, celular, Quest) y entra a la misma partida. HTTPS ya viene incluido, así que **JUGAR EN VR** funciona sin certificados.
4. Prueba que vive en `https://TU-DIRECCION/health`. El plan gratis de Render se duerme tras unos minutos sin uso y la primera visita tarda ~1 minuto en despertar.

- **Salas**: cada mapa tiene salas públicas de hasta 10 jugadores (se abre otra cuando se llena). Con un **código de sala privada** (hasta 8 letras o números) juegan solo tus amigos, hasta 16.
- **Servidor en otra dirección**: en el menú, "Servidor (avanzado)". Sirve para abrir el cliente desde otro sitio (o desde el APK) apuntando a tu servidor.
- Si se corta la conexión, el juego reintenta solo.

## Mapas

En la **Plaza** hay 4 columnas de luz al fondo; entra en una para viajar. En cada mapa, la columna blanca **VOLVER** te regresa.

- **Plaza**: el mapa clásico con el cubo y la esfera, los cursos, la computadora y la tienda.
- **Bosque**: árboles para trepar, ramas, troncos y una casa del árbol.
- **Cueva**: oscura, con estalactitas, pilares y una pirámide de roca.
- **Cañón**: mesas de roca, pasillos para saltar de pared a pared y un arco.
- **Ciudad**: edificios, calles, coches y tejados.

Los mapas están en `public/maps.js` (se generan con semilla fija, así todos ven lo mismo). Para abrir uno directo: `?map=forest`.

## Tienda

Un local al fondo de la Plaza, enfrente de donde apareces. Los cosméticos flotan sobre pedestales con su precio. Apunta y haz clic (PC), toca el botón de mano (celular) o toca el objeto con la mano (VR) para comprarlo, ponértelo o quitártelo. Comprar con monedas pide tocarlo dos veces. Código en `public/shop.js`.

## Cursos, computadora y cosméticos

- **Cursos**: a la izquierda de la arena está el **CURSO NOOB** (verde, plataformas grandes) y a la derecha el **CURSO PRO** (rojo, plataformas pequeñas, vigas y una esfera). Párate en la plataforma de salida, sal de ella y el cronómetro empieza; toca la plataforma dorada de la meta para terminar. Si vuelves a la salida, se reinicia.
- **Monedas**: NOOB da 20 la primera vez (5 después); PRO da 60 (15 después). Ajústalo en `public/courses.js` (`reward`).
- **Computadora** (en el centro, cerca de la aparición): cambia tu nombre, tu color, tus cosméticos y teletranspórtate a un curso. PC: apunta y haz clic. Móvil: toca un botón de mano mirando la pantalla. VR: toca la pantalla con la mano.
- **Cosméticos**: *Early Access Badge* (gratis, ya puesto) y *Headphones* (50 monedas). Los demás jugadores los ven. Precios y catálogo en `public/cosmetics.js`. El perfil se guarda en el navegador.
- Pruebas: `npm test` (locomoción, cursos, cosméticos, computadora, mapas, tienda, red y salas).

## Controles en PC

- **Mouse**: mirar
- **Click izquierdo / derecho**: empujar con la mano izquierda / derecha
- Apunta al suelo o a una pared y haz clic alternando manos para correr y saltar
- Mantén el clic sobre una superficie para agarrarte y frenar
- **Esc**: soltar el mouse

Jugadores de PC y de VR comparten partida.

## Reglas

Con 2 o más jugadores, uno es **LAVA** (naranja). Si toca a otro jugador, lo contagia. Tras un contagio hay 3 segundos de inmunidad.

## Mapa

La Plaza es una arena de 60×60 con paredes, un **cubo** naranja y una **esfera** azul. Mira la sección Mapas para los demás.

## Dónde ajustar las físicas

- VR: `public/locomotion.js` (objeto `CFG`: radio de mano, tope de salto, gravedad, bonus de LAVA...). La lógica sigue el esquema del locomotion de Gorilla Tag: las manos que chocan fijan el cuerpo en el sitio, y la velocidad de salida es el promedio de los últimos frames.
- PC: constantes al inicio de `public/index.html`.

## Estructura

```
server.js               servidor HTTP/HTTPS + WebSocket
rooms.js               salas por mapa, códigos privados y lógica del tag
render.yaml            despliegue en Render
public/index.html       cliente (escena, robots, PC y VR)
public/locomotion.js    física de manos para VR (sin DOM, con pruebas)
public/maps.js          los mapas (Plaza, Bosque, Cueva, Cañón, Ciudad)
public/shop.js          tienda física
public/net.js           dirección del servidor y reconexión
test/                   pruebas
```
