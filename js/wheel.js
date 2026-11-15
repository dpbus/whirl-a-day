// Draws the wheel on a <canvas> and animates spins.
// The result is chosen BEFORE spinning (see main.js); spinTo() just animates to land on it.

const TAU = Math.PI * 2;
const POINTER_ANGLE = -Math.PI / 2; // pointer sits at 12 o'clock
const LABEL_FONT = "'Fredoka', system-ui, -apple-system, sans-serif";
const LIGHT_COUNT = 24;

export class WheelView {
  constructor(canvas, { onTick } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onTick = onTick;
    this.labels = [];
    this.theme = null;
    this.rotation = 0;
    this.lightsPhase = 0;
    this.spinning = false;
    this.labelCache = { key: '', size: 0, fitted: [] };

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();

    // Gentle twinkle for themes with rim lights.
    setInterval(() => {
      if (this.spinning || document.hidden || !this.theme?.lights) return;
      this.lightsPhase++;
      this.draw();
    }, 700);
  }

  resize() {
    const size = Math.round(this.canvas.getBoundingClientRect().width * (window.devicePixelRatio || 1));
    if (!size) return;
    if (this.canvas.width !== size) {
      this.canvas.width = size;
      this.canvas.height = size;
    }
    this.draw();
  }

  setTheme(wheelTheme) {
    this.theme = wheelTheme;
    this.draw();
  }

  setLabels(labels) {
    this.labels = labels;
    this.draw();
  }

  /** Index of the segment currently under the pointer. */
  segmentAtPointer() {
    const n = this.labels.length;
    if (!n) return -1;
    const angle = (((POINTER_ANGLE - this.rotation) % TAU) + TAU) % TAU;
    return Math.floor(angle / (TAU / n)) % n;
  }

  /** Forget cached label sizes (e.g. once the web font has loaded) and redraw. */
  invalidateLabels() {
    this.labelCache = { key: '', size: 0, fitted: [] };
    this.draw();
  }

  /** Animate so segment `index` ends under the pointer. Resolves when done. */
  spinTo(index, durationMs, { turns: requestedTurns } = {}) {
    const n = this.labels.length;
    if (!n) return Promise.resolve();
    const seg = TAU / n;
    const landAt = 0.15 + Math.random() * 0.7; // somewhere inside the slice, not on a line
    const base = POINTER_ANGLE - (index + landAt) * seg;
    const start = this.rotation;
    const delta = (((base - start) % TAU) + TAU) % TAU;
    const turns = requestedTurns ?? Math.max(2, Math.round((durationMs / 1000) * 1.1));
    const target = start + delta + turns * TAU;

    this.spinning = true;
    return new Promise((resolve) => {
      const t0 = performance.now();
      let lastSegment = this.segmentAtPointer();
      const frame = (now) => {
        const p = Math.min(1, (now - t0) / durationMs);
        const eased = 1 - Math.pow(1 - p, 4); // ease-out-quart: fast start, long suspenseful finish
        this.rotation = start + (target - start) * eased;
        this.lightsPhase = Math.floor(now / 110);
        const current = this.segmentAtPointer();
        if (current !== lastSegment) {
          lastSegment = current;
          this.onTick?.();
        }
        this.draw();
        if (p < 1) {
          requestAnimationFrame(frame);
        } else {
          this.rotation = target % TAU;
          this.spinning = false;
          resolve();
        }
      };
      requestAnimationFrame(frame);
    });
  }

  colorFor(i, n) {
    const palette = this.theme.segments;
    const k = palette.length;
    let idx = i % k;
    // Avoid the last slice matching the first one next to it.
    if (n > 1 && i === n - 1 && idx === 0 && k > 2) idx = 1;
    return palette[idx];
  }

  /**
   * One font size for every label so the wheel looks even, plus each label shortened to fit.
   * Measured once per layout and reused on every animation frame.
   */
  layoutLabels(r, maxWidth) {
    const n = this.labels.length;
    const key = `${n}|${r}|${this.labels.join('\u0000')}`;
    if (this.labelCache.key === key) return this.labelCache;

    const seg = TAU / n;
    const chord = n === 1 ? r : 2 * r * 0.62 * Math.sin(Math.min(seg, Math.PI) / 2);
    let size = Math.min(r * 0.2, chord * 0.55);
    this.ctx.font = `600 ${size}px ${LABEL_FONT}`;
    const widest = this.labels.reduce((max, label) => Math.max(max, this.ctx.measureText(label).width), 0);
    if (widest > maxWidth) size = Math.max(size * (maxWidth / widest), r * 0.065);

    this.ctx.font = `600 ${size}px ${LABEL_FONT}`;
    const fitted = this.labels.map((label) => this.fitText(label, maxWidth));
    this.labelCache = { key, size, fitted };
    return this.labelCache;
  }

  /** Shorten text with an ellipsis until it fits (binary search over the length). */
  fitText(text, maxWidth) {
    if (this.ctx.measureText(text).width <= maxWidth) return text;
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.ctx.measureText(text.slice(0, mid) + '…').width <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    return text.slice(0, Math.max(1, lo)) + '…';
  }

  draw() {
    const { ctx, canvas, theme } = this;
    const W = canvas.width;
    if (!theme || !W) return;

    const c = W / 2;
    const R = c * 0.97;
    const rimWidth = R * 0.075;
    const r = R - rimWidth;
    const n = this.labels.length;
    const seg = n ? TAU / n : TAU;

    ctx.clearRect(0, 0, W, W);

    // Rim
    ctx.beginPath();
    ctx.arc(c, c, R, 0, TAU);
    ctx.fillStyle = theme.rim;
    ctx.fill();

    if (n === 0) {
      ctx.beginPath();
      ctx.arc(c, c, r, 0, TAU);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.fill();
    } else {
      // Slices
      for (let i = 0; i < n; i++) {
        const a0 = this.rotation + i * seg;
        ctx.beginPath();
        ctx.moveTo(c, c);
        ctx.arc(c, c, r, a0, a0 + seg);
        ctx.closePath();
        ctx.fillStyle = this.colorFor(i, n).bg;
        ctx.fill();
      }
      // Dividers
      if (n > 1) {
        ctx.strokeStyle = theme.divider;
        ctx.lineWidth = Math.max(1, W * 0.004);
        for (let i = 0; i < n; i++) {
          const a0 = this.rotation + i * seg;
          ctx.beginPath();
          ctx.moveTo(c, c);
          ctx.lineTo(c + r * Math.cos(a0), c + r * Math.sin(a0));
          ctx.stroke();
        }
      }
      // Labels, reading outward from the center
      const maxWidth = r * 0.66;
      const { size, fitted } = this.layoutLabels(r, maxWidth);
      ctx.font = `600 ${size}px ${LABEL_FONT}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < n; i++) {
        ctx.save();
        ctx.translate(c, c);
        ctx.rotate(this.rotation + (i + 0.5) * seg);
        ctx.fillStyle = this.colorFor(i, n).fg;
        ctx.fillText(fitted[i], r * 0.88, 0);
        ctx.restore();
      }
    }

    // Inner edge shadow
    ctx.beginPath();
    ctx.arc(c, c, r, 0, TAU);
    ctx.lineWidth = Math.max(2, W * 0.006);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.stroke();

    // Rim lights (or plain studs)
    const lightR = R - rimWidth / 2;
    for (let k = 0; k < LIGHT_COUNT; k++) {
      const a = this.rotation + (k / LIGHT_COUNT) * TAU;
      ctx.beginPath();
      ctx.arc(c + lightR * Math.cos(a), c + lightR * Math.sin(a), rimWidth * 0.24, 0, TAU);
      if (theme.lights?.length) {
        const color = theme.lights[(k + this.lightsPhase) % theme.lights.length];
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = rimWidth * 0.7;
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      }
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Hub
    const hubR = r * 0.17;
    ctx.beginPath();
    ctx.arc(c, c, hubR, 0, TAU);
    ctx.fillStyle = theme.hub;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = W * 0.02;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = W * 0.008;
    ctx.strokeStyle = theme.rim;
    ctx.stroke();
    ctx.font = `${hubR * 1.05}px 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(theme.hubEmoji, c, c + hubR * 0.08);
  }
}
