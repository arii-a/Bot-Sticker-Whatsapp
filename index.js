import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  normalizeMessageContent,
  fetchLatestBaileysVersion,
  Browsers,
} from '@whiskeysockets/baileys';
import http from 'node:http';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { imageToSticker, videoToSticker, toVoiceNote } from './lib/media.js';

const logger = pino({ level: 'silent' });
const PHONE = process.env.PHONE?.replace(/\D/g, ''); // opcional: vincular con código en vez de QR
const LAST_STICKER_TTL = 10 * 60 * 1000; // 10 min

// Último sticker creado por chat, para combinarlo luego con /audio
const lastSticker = new Map();

const HELP = [
  '*Bot de stickers con audio*',
  '',
  '• `/sticker` — pon el comando como texto en una imagen/video/GIF (o respóndelo con el comando) y te devuelvo el sticker.',
  '• `/sa` — con un *video*: te devuelvo el sticker animado y justo después su audio como nota de voz (máx. 10 s).',
  '• `/audio` — responde a un *audio, nota de voz o video* con este comando y mando el último sticker que hiciste + ese audio.',
  '',
  'Nota: WhatsApp no deja meter el sonido dentro del sticker, por eso van como dos mensajes seguidos.',
].join('\n');

function getText(content) {
  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    ''
  );
}

function getContextInfo(content) {
  const inner =
    content.extendedTextMessage ||
    content.imageMessage ||
    content.videoMessage ||
    content.audioMessage ||
    {};
  return inner.contextInfo;
}

function mediaKind(content) {
  if (!content) return null;
  if (content.imageMessage) return 'image';
  if (content.videoMessage) return 'video';
  if (content.audioMessage) return 'audio';
  return null;
}

/**
 * Busca el medio del comando: primero en el propio mensaje, si no en el mensaje citado.
 * Devuelve { kind, buffer } o null.
 */
async function resolveMedia(sock, msg, content) {
  const own = mediaKind(content);
  if (own) {
    const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
      logger,
      reuploadRequest: sock.updateMediaMessage,
    });
    return { kind: own, buffer };
  }

  const ctx = getContextInfo(content);
  if (!ctx?.quotedMessage) return null;
  const quoted = normalizeMessageContent(ctx.quotedMessage);
  const kind = mediaKind(quoted);
  if (!kind) return null;

  const fake = {
    key: {
      remoteJid: msg.key.remoteJid,
      id: ctx.stanzaId,
      participant: ctx.participant,
      fromMe: false,
    },
    message: ctx.quotedMessage,
  };
  const buffer = await downloadMediaMessage(fake, 'buffer', {}, {
    logger,
    reuploadRequest: sock.updateMediaMessage,
  });
  return { kind, buffer };
}

async function sendVoice(sock, jid, buffer, quoted) {
  const ogg = await toVoiceNote(buffer);
  await sock.sendMessage(
    jid,
    { audio: ogg, mimetype: 'audio/ogg; codecs=opus', ptt: true },
    { quoted }
  );
}

async function handleMessage(sock, msg) {
  if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;
  const jid = msg.key.remoteJid;
  const content = normalizeMessageContent(msg.message);
  if (!content) return;

  const text = getText(content).trim();
  if (!text.startsWith('/')) return;
  const cmd = text.split(/\s+/)[0].toLowerCase();

  const reply = (t) => sock.sendMessage(jid, { text: t }, { quoted: msg });

  try {
    if (cmd === '/menu' || cmd === '/ayuda' || cmd === '/help') {
      return void (await reply(HELP));
    }

    if (cmd === '/sticker' || cmd === '/s' || cmd === '/sa') {
      const media = await resolveMedia(sock, msg, content);
      if (!media || media.kind === 'audio') {
        return void (await reply(
          'Mándame una imagen, video o GIF con el comando como texto, o respóndelo con el comando.'
        ));
      }

      const animated = media.kind === 'video';
      const sticker = animated
        ? await videoToSticker(media.buffer)
        : await imageToSticker(media.buffer);
      await sock.sendMessage(jid, { sticker }, { quoted: msg });
      lastSticker.set(jid, { sticker, at: Date.now() });

      if (cmd === '/sa') {
        if (!animated) {
          return void (await reply('Para /sa necesito un video (el audio sale de ahí). Usa /sticker + /audio.'));
        }
        try {
          await sendVoice(sock, jid, media.buffer, msg);
        } catch {
          await reply('Ese video no tiene audio que pueda extraer.');
        }
      }
      return;
    }

    if (cmd === '/audio') {
      const media = await resolveMedia(sock, msg, content);
      if (!media) {
        return void (await reply('Responde a un audio, nota de voz o video con /audio.'));
      }
      const last = lastSticker.get(jid);
      if (!last || Date.now() - last.at > LAST_STICKER_TTL) {
        return void (await reply('Primero crea un sticker con /sticker (vale por 10 minutos) y luego usa /audio.'));
      }
      await sock.sendMessage(jid, { sticker: last.sticker }, { quoted: msg });
      await sendVoice(sock, jid, media.buffer, msg);
    }
  } catch (err) {
    console.error('Error en comando', cmd, err);
    await reply(`No pude procesarlo: ${err.message}`.slice(0, 300)).catch(() => {});
  }
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(process.env.AUTH_DIR || 'auth');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: Browsers.ubuntu('Chrome'),
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  sock.ev.on('creds.update', saveCreds);

  // Vincular con número (código de 8 caracteres) si se definió PHONE
  if (PHONE && !sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(PHONE);
        console.log(`\nCódigo de vinculación: ${code}`);
        console.log('WhatsApp > Dispositivos vinculados > Vincular con número de teléfono\n');
      } catch (e) {
        console.error('No pude pedir el código de vinculación:', e.message);
      }
    }, 3000);
  }

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr && !PHONE) {
      console.log('Escanea este QR: WhatsApp > Dispositivos vinculados > Vincular un dispositivo\n');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') console.log('Bot conectado. Escribe /menu en WhatsApp.');
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log('Sesión cerrada. Borra la carpeta "auth" y vuelve a vincular.');
        process.exit(1);
      }
      console.log(`Conexión cerrada (código ${code ?? 'desconocido'}), reconectando en 5 s...`);
      sock.ev.removeAllListeners();
      setTimeout(start, 5000);
    }
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) handleMessage(sock, msg);
  });
}

// Algunos hostings (p. ej. Render) exigen que el servicio escuche un puerto.
if (process.env.PORT) {
  http.createServer((_, res) => res.end('ok')).listen(process.env.PORT);
}

start();
