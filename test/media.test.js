import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import ffmpegStatic from 'ffmpeg-static';
import { imageToSticker, videoToSticker, toVoiceNote } from '../lib/media.js';

const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stktest-'));

function gen(name, args) {
  const out = path.join(dir, name);
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args, out]);
  assert.equal(r.status, 0, r.stderr?.toString());
  return fs.readFileSync(out);
}

const png = gen('t.png', ['-f', 'lavfi', '-i', 'testsrc=size=800x400:rate=1', '-frames:v', '1']);
const mp4 = gen('t.mp4', [
  '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
  '-t', '12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
]);
const silent = gen('s.mp4', [
  '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
]);

const isWebp = (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP';

const img = await imageToSticker(png);
assert.ok(isWebp(img), 'imagen -> webp');
console.log('imagen->sticker OK', img.length, 'bytes');

const anim = await videoToSticker(mp4);
assert.ok(isWebp(anim), 'video -> webp');
assert.ok(anim.length <= 500 * 1024, 'sticker animado <= 500KB');
assert.ok(anim.includes(Buffer.from('ANIM')), 'webp animado');
console.log('video->sticker OK', anim.length, 'bytes');

const ogg = await toVoiceNote(mp4);
assert.equal(ogg.subarray(0, 4).toString(), 'OggS');
console.log('video->nota de voz OK', ogg.length, 'bytes');

await assert.rejects(toVoiceNote(silent), /ffmpeg/, 'video sin audio debe fallar');
console.log('video sin audio falla como se espera OK');

fs.rmSync(dir, { recursive: true, force: true });
console.log('Todo OK');
