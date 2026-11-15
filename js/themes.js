// Themes. To add one, copy an entry and change the colors — everything else picks it up.
//
//   vars      CSS custom properties for the page (see css/styles.css)
//   font      display font for headings and the spin button
//   ambient   background effect: 'snow' or null
//   melody    win sound: 'jingle' | 'twinkle' | 'spooky' | 'fanfare' (see effects.js)
//   tick      default spin tick: 'wood' | 'chime' | 'sleigh'
//   wheel     colors used when drawing the wheel on the canvas
//   confetti  colors and shapes ('rect' | 'circle' | 'star' | 'flake')

export const THEMES = {
  christmas: {
    name: 'Christmas',
    emoji: '🎄',
    ambient: 'snow',
    melody: 'jingle',
    tick: 'sleigh',
    resultEmoji: '🎁',
    font: "'Mountains of Christmas', 'Fredoka', cursive",
    metaColor: '#0b2e1f',
    vars: {
      '--bg': 'radial-gradient(ellipse at top, #1d5c3f 0%, #0b2e1f 55%, #061a11 100%)',
      '--bg-text': '#fff8ec',
      '--bg-muted': 'rgba(255, 248, 236, 0.75)',
      '--surface': '#fffaf2',
      '--surface-text': '#3b1d14',
      '--surface-muted': '#8a6f63',
      '--border': '#e8d7c4',
      '--accent': '#c8102e',
      '--accent-text': '#ffffff',
      '--accent-shadow': '#7d0a1c',
      '--accent-2': '#1e7b45',
      '--accent-2-text': '#ffffff',
      '--tab-bg': 'rgba(255, 255, 255, 0.12)',
      '--tab-text': '#fff8ec',
      '--tab-active-bg': '#fff8ec',
      '--tab-active-text': '#8b1022',
      '--pointer': '#f2c14e',
    },
    wheel: {
      segments: [
        { bg: '#c62828', fg: '#ffffff' },
        { bg: '#2e7d32', fg: '#ffffff' },
        { bg: '#fff3e0', fg: '#b71c1c' },
        { bg: '#f2b81c', fg: '#4a2600' },
      ],
      rim: '#7d0a1c',
      divider: 'rgba(255, 255, 255, 0.6)',
      hub: '#fff8ec',
      hubEmoji: '⭐',
      lights: ['#ffd54f', '#ff5252', '#69f0ae', '#40c4ff'],
    },
    confetti: { colors: ['#c62828', '#2e7d32', '#f2c14e', '#ffffff'], shapes: ['star', 'rect', 'circle'] },
  },

  winter: {
    name: 'Winter Wonderland',
    emoji: '❄️',
    ambient: 'snow',
    melody: 'twinkle',
    tick: 'chime',
    resultEmoji: '⛄',
    font: "'Fredoka', system-ui, sans-serif",
    metaColor: '#14254a',
    vars: {
      '--bg': 'linear-gradient(180deg, #14254a 0%, #2b4c8c 60%, #7fa7d9 100%)',
      '--bg-text': '#f2f7ff',
      '--bg-muted': 'rgba(242, 247, 255, 0.75)',
      '--surface': '#f7fbff',
      '--surface-text': '#16264a',
      '--surface-muted': '#5c6f93',
      '--border': '#d3e1f3',
      '--accent': '#2f6fd6',
      '--accent-text': '#ffffff',
      '--accent-shadow': '#1b4590',
      '--accent-2': '#7fb3ef',
      '--accent-2-text': '#0e2246',
      '--tab-bg': 'rgba(255, 255, 255, 0.14)',
      '--tab-text': '#f2f7ff',
      '--tab-active-bg': '#f7fbff',
      '--tab-active-text': '#1b4590',
      '--pointer': '#ffffff',
    },
    wheel: {
      segments: [
        { bg: '#2f6fd6', fg: '#ffffff' },
        { bg: '#e8f1fc', fg: '#1b4590' },
        { bg: '#7fb3ef', fg: '#0e2246' },
        { bg: '#b6c6dd', fg: '#16264a' },
      ],
      rim: '#14254a',
      divider: 'rgba(255, 255, 255, 0.7)',
      hub: '#ffffff',
      hubEmoji: '❄️',
      lights: ['#ffffff', '#bfe0ff', '#8fc3ff'],
    },
    confetti: { colors: ['#ffffff', '#bfe0ff', '#7fb3ef', '#2f6fd6'], shapes: ['flake', 'circle'] },
  },

  halloween: {
    name: 'Halloween',
    emoji: '🎃',
    ambient: null,
    melody: 'spooky',
    tick: 'wood',
    resultEmoji: '👻',
    font: "'Creepster', 'Fredoka', cursive",
    metaColor: '#1a0f24',
    vars: {
      '--bg': 'radial-gradient(ellipse at top, #3a1d4f 0%, #1a0f24 60%, #0b0610 100%)',
      '--bg-text': '#ffe9d1',
      '--bg-muted': 'rgba(255, 233, 209, 0.75)',
      '--surface': '#241632',
      '--surface-text': '#ffe9d1',
      '--surface-muted': '#b79fc9',
      '--border': '#45305a',
      '--accent': '#ff7518',
      '--accent-text': '#1a0f24',
      '--accent-shadow': '#a3440a',
      '--accent-2': '#7b2fa8',
      '--accent-2-text': '#ffffff',
      '--tab-bg': 'rgba(255, 255, 255, 0.08)',
      '--tab-text': '#ffe9d1',
      '--tab-active-bg': '#ff7518',
      '--tab-active-text': '#1a0f24',
      '--pointer': '#9ccc65',
    },
    wheel: {
      segments: [
        { bg: '#ff7518', fg: '#1a0f24' },
        { bg: '#2a2a2a', fg: '#ff9a4d' },
        { bg: '#7b2fa8', fg: '#ffffff' },
        { bg: '#9ccc65', fg: '#1a0f24' },
      ],
      rim: '#0b0610',
      divider: 'rgba(0, 0, 0, 0.5)',
      hub: '#2a2a2a',
      hubEmoji: '🎃',
      lights: ['#ff7518', '#9ccc65', '#b06ad9'],
    },
    confetti: { colors: ['#ff7518', '#7b2fa8', '#9ccc65', '#2a2a2a'], shapes: ['rect', 'circle'] },
  },

  birthday: {
    name: 'Birthday',
    emoji: '🎂',
    ambient: null,
    melody: 'fanfare',
    tick: 'wood',
    resultEmoji: '🎉',
    font: "'Fredoka', system-ui, sans-serif",
    metaColor: '#ffd6ea',
    vars: {
      '--bg': 'linear-gradient(160deg, #ffd6ea 0%, #fff1c9 50%, #cfeaff 100%)',
      '--bg-text': '#4a2353',
      '--bg-muted': 'rgba(74, 35, 83, 0.7)',
      '--surface': '#ffffff',
      '--surface-text': '#3d2346',
      '--surface-muted': '#8a6d93',
      '--border': '#f0dcef',
      '--accent': '#e8458b',
      '--accent-text': '#ffffff',
      '--accent-shadow': '#a8255e',
      '--accent-2': '#7ad3b5',
      '--accent-2-text': '#183d32',
      '--tab-bg': 'rgba(255, 255, 255, 0.55)',
      '--tab-text': '#4a2353',
      '--tab-active-bg': '#e8458b',
      '--tab-active-text': '#ffffff',
      '--pointer': '#4a2353',
    },
    wheel: {
      segments: [
        { bg: '#ff8fb8', fg: '#4a1030' },
        { bg: '#ffd84d', fg: '#4a3300' },
        { bg: '#7ad3b5', fg: '#183d32' },
        { bg: '#b49cf2', fg: '#2a1857' },
        { bg: '#7cc4f5', fg: '#0f3350' },
      ],
      rim: '#ffffff',
      divider: 'rgba(255, 255, 255, 0.9)',
      hub: '#ffffff',
      hubEmoji: '🎂',
      lights: ['#ff8fb8', '#ffd84d', '#7ad3b5', '#b49cf2', '#7cc4f5'],
    },
    confetti: { colors: ['#ff8fb8', '#ffd84d', '#7ad3b5', '#b49cf2', '#7cc4f5'], shapes: ['rect', 'circle', 'star'] },
  },

  classic: {
    name: 'Classic',
    emoji: '🎯',
    ambient: null,
    melody: 'fanfare',
    tick: 'wood',
    resultEmoji: '🎉',
    font: "'Fredoka', system-ui, sans-serif",
    metaColor: '#f4f4f7',
    vars: {
      '--bg': '#f4f4f7',
      '--bg-text': '#1f2430',
      '--bg-muted': '#5d6475',
      '--surface': '#ffffff',
      '--surface-text': '#1f2430',
      '--surface-muted': '#6b7385',
      '--border': '#e2e4ea',
      '--accent': '#3757e8',
      '--accent-text': '#ffffff',
      '--accent-shadow': '#2034a0',
      '--accent-2': '#ffc934',
      '--accent-2-text': '#3a2a00',
      '--tab-bg': '#e6e8ef',
      '--tab-text': '#1f2430',
      '--tab-active-bg': '#3757e8',
      '--tab-active-text': '#ffffff',
      '--pointer': '#1f2430',
    },
    wheel: {
      segments: [
        { bg: '#ef4444', fg: '#ffffff' },
        { bg: '#f59e0b', fg: '#2b1a00' },
        { bg: '#22c55e', fg: '#06240f' },
        { bg: '#3b82f6', fg: '#ffffff' },
        { bg: '#a855f7', fg: '#ffffff' },
      ],
      rim: '#1f2430',
      divider: 'rgba(255, 255, 255, 0.85)',
      hub: '#ffffff',
      hubEmoji: '⭐',
      lights: null,
    },
    confetti: { colors: ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7'], shapes: ['rect', 'circle'] },
  },

  midnight: {
    name: 'Midnight',
    emoji: '🌙',
    ambient: null,
    melody: 'twinkle',
    tick: 'chime',
    resultEmoji: '✨',
    font: "'Fredoka', system-ui, sans-serif",
    metaColor: '#0d1117',
    vars: {
      '--bg': 'radial-gradient(ellipse at top, #1c2333 0%, #0d1117 70%)',
      '--bg-text': '#e6edf3',
      '--bg-muted': '#9aa5b4',
      '--surface': '#161b22',
      '--surface-text': '#e6edf3',
      '--surface-muted': '#8b949e',
      '--border': '#30363d',
      '--accent': '#7c5cff',
      '--accent-text': '#ffffff',
      '--accent-shadow': '#4b32b8',
      '--accent-2': '#2dd4bf',
      '--accent-2-text': '#04231f',
      '--tab-bg': 'rgba(255, 255, 255, 0.07)',
      '--tab-text': '#e6edf3',
      '--tab-active-bg': '#7c5cff',
      '--tab-active-text': '#ffffff',
      '--pointer': '#ffd166',
    },
    wheel: {
      segments: [
        { bg: '#7c5cff', fg: '#ffffff' },
        { bg: '#2dd4bf', fg: '#04231f' },
        { bg: '#f472b6', fg: '#3b0a24' },
        { bg: '#ffd166', fg: '#332400' },
      ],
      rim: '#0d1117',
      divider: 'rgba(13, 17, 23, 0.7)',
      hub: '#161b22',
      hubEmoji: '🌙',
      lights: ['#ffd166', '#7c5cff', '#2dd4bf'],
    },
    confetti: { colors: ['#7c5cff', '#2dd4bf', '#f472b6', '#ffd166'], shapes: ['star', 'circle'] },
  },
};

export const DEFAULT_THEME_ID = 'classic';

/** Spin tick sounds a theme (or the General setting) can choose. Played in effects.js. */
export const TICK_STYLES = {
  wood: 'Wooden click',
  chime: 'Music box',
  sleigh: 'Sleigh bells',
};

export function getTheme(id) {
  // Object.hasOwn, not THEMES[id]: ids like 'constructor' must not match built-in properties.
  return Object.hasOwn(THEMES, id) ? THEMES[id] : THEMES[DEFAULT_THEME_ID];
}

/** Apply a theme's CSS variables to the page and return the theme object. */
export function applyTheme(id) {
  const theme = getTheme(id);
  const root = document.documentElement;
  for (const [name, value] of Object.entries(theme.vars)) root.style.setProperty(name, value);
  root.style.setProperty('--font-display', theme.font);
  root.dataset.theme = Object.hasOwn(THEMES, id) ? id : DEFAULT_THEME_ID;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.metaColor);
  return theme;
}
