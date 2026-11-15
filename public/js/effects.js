// Sound (recorded samples in /sounds), confetti (canvas-confetti), and falling snow.
import confetti from './vendor/canvas-confetti-1.9.4.js';
import { prefersReducedMotion } from './util.js';

// ---------------------------------------------------------------- Sound
// Real recordings from the VSCO 2 Community Edition library (CC0). See docs/sounds.md in the repo.

const SOUND_FILES = {
  woodA: 'sounds/tick-wood-1.wav',
  woodB: 'sounds/tick-wood-2.wav',
  sleighTick: 'sounds/tick-sleigh.wav',
  sleighShake: 'sounds/sleigh-shake.wav',
  glockG5: 'sounds/glock-g5.wav',
  glockC6: 'sounds/glock-c6.wav',
  glockG6: 'sounds/glock-g6.wav',
};

// [sounding MIDI note, sample]: any note is played by re-pitching the nearest sample.
const GLOCK = [
  [79, 'glockG5'],
  [84, 'glockC6'],
  [91, 'glockG6'],
];

// Win tunes as [MIDI note, beats]. `bells` adds a sleigh-bell shake underneath.
const MELODIES = {
  jingle: { beat: 0.17, bells: true, notes: [[88, 1], [88, 1], [88, 2], [88, 1], [88, 1], [88, 2], [88, 1], [91, 1], [84, 1.5], [86, 0.5], [88, 4]] },
  twinkle: { beat: 0.13, notes: [[79, 1], [83, 1], [86, 1], [91, 1], [86, 1], [91, 4]] },
  spooky: { beat: 0.24, notes: [[81, 1], [84, 1], [88, 1], [87, 1], [81, 4]] },
  fanfare: { beat: 0.12, notes: [[84, 1], [88, 1], [91, 1], [96, 2], [91, 1], [96, 4]] },
};

let audio = null;
let master = null;
const buffers = {};
let fetched = null; // Promise of [key, ArrayBuffer | null] pairs

/** Download the sound files early (no audio playback yet, so no autoplay warnings). */
export function preloadSounds() {
  fetched ??= Promise.all(
    Object.entries(SOUND_FILES).map(async ([key, url]) => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(res.status);
        return [key, await res.arrayBuffer()];
      } catch (err) {
        console.warn('Could not load sound', url, err);
        return [key, null];
      }
    }),
  );
  return fetched;
}

function audioCtx() {
  if (!audio) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audio = new AC();
    master = audio.createGain();
    master.gain.value = 0.9;
    master.connect(audio.destination);
    preloadSounds().then((files) =>
      Promise.all(
        files.map(async ([key, data]) => {
          if (!data) return;
          try {
            buffers[key] = await audio.decodeAudioData(data);
          } catch (err) {
            console.warn('Could not decode sound', key, err);
          }
        }),
      ),
    );
  }
  // iOS can leave the context 'interrupted' (calls, Siri, screen lock), not just 'suspended'.
  if (audio.state !== 'running') audio.resume().catch(() => {});
  return audio;
}

/** Call from inside a click handler so iOS allows sound. */
export function unlockAudio() {
  audioCtx();
}

function play(key, { rate = 1, gain = 1, at = 0 } = {}) {
  const buffer = buffers[key];
  if (!audio || !buffer) return;
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  const volume = audio.createGain();
  volume.gain.value = gain;
  source.connect(volume).connect(master);
  source.start(Math.max(at, audio.currentTime));
}

function playNote(midi, options) {
  const [base, key] = GLOCK.reduce((best, s) => (Math.abs(s[0] - midi) < Math.abs(best[0] - midi) ? s : best));
  play(key, { ...options, rate: 2 ** ((midi - base) / 12) });
}

let lastTick = 0;
let tickCount = 0;
const MUSIC_BOX = [79, 81, 84, 86, 88, 91, 88, 86, 84, 81]; // pentatonic: always sounds pleasant
const wobble = () => 0.97 + Math.random() * 0.06; // tiny variation so repeats aren't robotic

/** One tick as a slice passes the pointer. Quieter while the wheel is fast, crisper as it slows. */
export function playTick(style = 'wood') {
  const a = audioCtx();
  if (!a) return;
  const now = a.currentTime;
  const gap = now - lastTick;
  if (gap < 0.04) return; // skip ticks that would blur into a buzz
  lastTick = now;
  const loudness = Math.min(1, Math.max(0.35, (gap - 0.04) / 0.2));
  tickCount++;

  if (style === 'chime') playNote(MUSIC_BOX[tickCount % MUSIC_BOX.length], { gain: 0.32 * loudness });
  else if (style === 'sleigh') play('sleighTick', { gain: 0.4 * loudness, rate: wobble() });
  else play(tickCount % 2 ? 'woodA' : 'woodB', { gain: 0.55 * loudness, rate: wobble() });
}

/** Play a short slowing-down run of ticks so a style can be auditioned in settings. */
export function previewTicks(style) {
  audioCtx(); // start audio inside the click, or iOS stays silent
  const gaps = [50, 55, 65, 75, 90, 110, 140, 180, 240, 330];
  let delay = 0;
  for (const gap of gaps) {
    delay += gap;
    setTimeout(() => playTick(style), delay);
  }
}

export function playMelody(name) {
  const a = audioCtx();
  if (!a) return;
  const melody = MELODIES[name] ?? MELODIES.fanfare;
  let t = a.currentTime + 0.05;
  if (melody.bells) play('sleighShake', { gain: 0.45, at: t });
  for (const [note, beats] of melody.notes) {
    playNote(note, { gain: 0.6, at: t });
    t += beats * melody.beat;
  }
}

// ---------------------------------------------------------------- Confetti

let cannon = null;
let cannonCanvas = null;
const shapeCache = {};

function confettiShape(name) {
  if (name === 'rect') return 'square';
  if (name === 'flake') {
    // Emoji shapes are drawn once and reused.
    shapeCache.flake ??= confetti.shapeFromText({ text: '❄️', scalar: 2 });
    return shapeCache.flake;
  }
  return name; // 'circle' | 'star'
}

export function confettiBurst(canvas, { colors, shapes }) {
  if (prefersReducedMotion()) return;
  if (cannonCanvas !== canvas) {
    cannon = confetti.create(canvas, { resize: true, disableForReducedMotion: true });
    cannonCanvas = canvas;
  }
  const options = { colors, shapes: shapes.map(confettiShape), ticks: 260, scalar: 1.1 };
  // Two side cannons, then a pop from the middle.
  cannon({ ...options, particleCount: 70, angle: 60, spread: 55, startVelocity: 60, origin: { x: 0, y: 0.8 } });
  cannon({ ...options, particleCount: 70, angle: 120, spread: 55, startVelocity: 60, origin: { x: 1, y: 0.8 } });
  setTimeout(() => cannon({ ...options, particleCount: 60, spread: 110, startVelocity: 35, origin: { x: 0.5, y: 0.35 } }), 250);
}

// ---------------------------------------------------------------- Ambient snow

function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(window.innerWidth * dpr);
  const h = Math.round(window.innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

let snow = { canvas: null, ctx: null, flakes: [], raf: 0, last: 0 };

export function setAmbient(canvas, kind) {
  cancelAnimationFrame(snow.raf);
  snow.raf = 0;
  const ctx = fitCanvas(canvas);
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  if (kind !== 'snow' || prefersReducedMotion()) return;

  snow.canvas = canvas;
  snow.ctx = ctx;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const count = Math.min(140, Math.round((W * H) / 9000));
  snow.flakes = Array.from({ length: count }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    r: 1 + Math.random() * 2.6,
    vy: 0.3 + Math.random() * 0.9,
    phase: Math.random() * Math.PI * 2,
    sway: 0.2 + Math.random() * 0.5,
    alpha: 0.4 + Math.random() * 0.5,
  }));
  snow.last = performance.now();
  snow.raf = requestAnimationFrame(stepSnow);
}

function stepSnow(now) {
  const dt = Math.min(3, (now - snow.last) / 16.67);
  snow.last = now;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const { ctx } = snow;
  ctx.clearRect(0, 0, W, H);
  for (const f of snow.flakes) {
    f.phase += 0.01 * dt;
    f.y += f.vy * dt;
    f.x += Math.sin(f.phase) * f.sway * dt;
    if (f.y > H + 5) {
      f.y = -5;
      f.x = Math.random() * W;
    }
    if (f.x > W + 5) f.x = -5;
    if (f.x < -5) f.x = W + 5;
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${f.alpha})`;
    ctx.fill();
  }
  snow.raf = requestAnimationFrame(stepSnow);
}

window.addEventListener('resize', () => {
  if (snow.canvas && snow.raf) snow.ctx = fitCanvas(snow.canvas);
});
