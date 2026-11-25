# Bot de stickers con audio para WhatsApp

Bot hecho con Baileys + ffmpeg. Convierte imágenes/videos/GIFs en stickers y manda el audio justo después
(WhatsApp no permite meter el sonido dentro del sticker, así que van como dos mensajes seguidos).

## Instalar

Requisitos: Node.js 18 o superior (ffmpeg viene incluido vía `ffmpeg-static`).

```bash
npm install
npm start
```

La primera vez se muestra un QR en la terminal. En el iPhone: WhatsApp > Configuración > Dispositivos
vinculados > Vincular un dispositivo.

¿Prefieres vincular con código en vez de QR? Define tu número con código de país, sin `+`:

```bash
PHONE=591XXXXXXXX npm start
```

Luego WhatsApp > Dispositivos vinculados > Vincular > "Vincular con número de teléfono" e ingresa el código.

La sesión se guarda en la carpeta `auth/`. Si quieres empezar de cero, bórrala.

## Comandos

Escríbelos como texto (o como pie de foto de una imagen/video). Puedes usarlos en tu chat "Tú".

| Comando | Qué hace |
|---|---|
| `/sticker` (o `/s`) | Imagen/video/GIF -> sticker. Úsalo de pie de foto, o respondiendo al medio. |
| `/sa` | Video -> sticker animado + el audio del video como nota de voz (máx. 10 s). |
| `/audio` | Respondiendo a un audio, nota de voz o video: manda tu último sticker + ese audio. El último sticker vale 10 minutos. |
| `/menu` | Ayuda. |

### Flujo para un sticker con tu propio audio

1. Mándate una imagen o video con el pie `/sticker` -> el bot te devuelve el sticker.
2. Mándate el audio que quieras (o grábalo) y respóndele con `/audio` -> el bot manda el sticker y el audio.

## Notas

- Los stickers animados duran hasta 8 s y se comprimen para pesar menos de 500 KB (límite de WhatsApp).
- El audio se recorta a 10 s y se manda como nota de voz.
- Baileys no es oficial. WhatsApp puede bloquear números que usen bots, así que conviene usar un número
  secundario, no el principal.
- Se usa `@whiskeysockets/baileys` 6.7.22 o superior: las versiones anteriores tienen un aviso de seguridad.
- Pruebas de las conversiones: `npm test`.

## Desplegar en la nube (sin PC)

Hay un `Dockerfile` listo. Pasos generales en cualquier hosting que corra Docker (Railway, Fly.io, un VPS):
1. Sube este proyecto a un repositorio de GitHub.
2. Crea el servicio desde ese repo y añade un **volumen persistente montado en `/data`** (ahí se guarda la sesión; sin él tendrías que volver a vincular en cada reinicio).
3. Define la variable `PHONE` con tu número (código de país, sin `+`).
4. Arranca y mira los **logs**: ahí aparece el código de 8 caracteres para vincular.
