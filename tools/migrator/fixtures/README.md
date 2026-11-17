# Fixtures del migrador

Páginas reales de un sitio hecho con inmobiliariaya (`www.castroymeirelles.com.uy`, cuenta 417), bajadas el
2026-11-17 con el User-Agent del migrador y una consulta por segundo. Las usan las pruebas de `../test/`: los
parsers se prueban contra estas páginas, sin red.

| Archivo | Qué es |
|---|---|
| `home.html` | Portada: página 0 del listado (21 tarjetas), datos de la inmobiliaria y contadores por tipo, ciudad y operación |
| `items-page-12.html` | Respuesta de «Ver más» (`items1.php?…&contadorItems=12`): 21 tarjetas y el número de la página siguiente |
| `ficha-casa-64640.html` | Ficha de una casa en venta, con coordenadas y 16 fotos |
| `ficha-campo-58450.html` | Ficha de una chacra en hectáreas, sin mapa (solo Street View) |
| `ficha-alquiler-62562.html` | Ficha de un local en alquiler por mes |

Se quitó la clave de Google Maps de los mapas incrustados (`REDACTED_GOOGLE_KEY`): no es nuestra y el repo es
público.

El HTML y el HAR que menciona la especificación (sección 11) no llegaron con el documento; estas páginas los
reemplazan. Si el sitio de origen cambia, se vuelven a bajar y se actualizan las pruebas.
