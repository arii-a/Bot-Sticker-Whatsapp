import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import ffmpegStatic from 'ffmpeg-static';

// Usa el ffmpeg del sistema si FFMPEG_PATH está definido; si no, el que trae ffmpeg-static.
const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg';

const MAX_ANIMATED_BYTES = 500 * 1024; // WhatsApp rechaza stickers animados más pesados
const MAX_STICKER_SECONDS = 8;
const FFMPEG_TIMEOUT_MS = 60 * 1000;
export const MAX_AUDIO_SECONDS = 10;

function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
    // Seguro anti-cuelgues: si ffmpeg tarda demasiado, se corta.
    const timer = setTimeout(() => p.kill('SIGKILL'), FFMPEG_TIMEOUT_MS);
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg falló (código ${code}): ${err.trim() || 'tiempo agotado'}`));
    });
  });
}

async function withTmp(buffer, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stkbot-'));
  const id = crypto.randomBytes(4).toString('hex');
  const input = path.join(dir, `in-${id}`);
  try {
    await fs.writeFile(input, buffer);
    return await fn(input, dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const SQUARE =
  'format=rgba,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:-1:-1:color=0x00000000';

/** Imagen -> sticker WebP estático 512x512 con fondo transparente. */
export function imageToSticker(buffer) {
  return withTmp(buffer, async (input, dir) => {
    const out = path.join(dir, 'out.webp');
    await run(['-i', input, '-vf', SQUARE, '-frames:v', '1', '-c:v', 'libwebp', '-q:v', '80', out]);
    return fs.readFile(out);
  });
}

/** Video/GIF -> sticker WebP animado. Baja calidad hasta que pese <= 500 KB. */
export function videoToSticker(buffer) {
  return withTmp(buffer, async (input, dir) => {
    const out = path.join(dir, 'out.webp');
    const attempts = [
      { fps: 15, q: 60 },
      { fps: 15, q: 40 },
      { fps: 12, q: 30 },
      { fps: 10, q: 20 },
      { fps: 8, q: 10 },
    ];
    let last;
    for (const { fps, q } of attempts) {
      await run([
        '-t', String(MAX_STICKER_SECONDS),
        '-i', input,
        '-vf', `fps=${fps},${SQUARE}`,
        '-an',
        '-c:v', 'libwebp',
        '-loop', '0',
        '-q:v', String(q),
        out,
      ]);
      last = await fs.readFile(out);
      if (last.length <= MAX_ANIMATED_BYTES) return last;
    }
    throw new Error('El video es demasiado pesado para ser sticker. Prueba con uno más corto.');
  });
}

/** Cualquier audio/video -> nota de voz (ogg/opus) de hasta 10 s. */
export function toVoiceNote(buffer, maxSeconds = MAX_AUDIO_SECONDS) {
  return withTmp(buffer, async (input, dir) => {
    const out = path.join(dir, 'out.ogg');
    await run([
      '-t', String(maxSeconds),
      '-i', input,
      '-vn',
      '-c:a', 'libopus',
      '-b:a', '48k',
      '-ar', '48000',
      '-ac', '1',
      '-f', 'ogg',
      out,
    ]);
    return fs.readFile(out);
  });
}
