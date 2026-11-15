// Starting points for a wheel. Add new presets here — they show up everywhere automatically.
// `theme` (optional) is the theme a new wheel gets when made from the preset.
import { range, uid } from './util.js';

export const PRESETS = [
  {
    id: 'twelve-days',
    theme: 'christmas',
    name: '12 Days of Christmas (1–12)',
    title: '12 Days of Christmas',
    options: range(1, 12),
    removeAfterSpin: true,
    spinsPerDay: 1,
  },
  {
    id: 'advent-24',
    theme: 'christmas',
    name: 'Advent calendar (1–24)',
    title: 'Advent Calendar',
    options: range(1, 24),
    removeAfterSpin: true,
    spinsPerDay: 1,
  },
  {
    id: 'advent-25',
    theme: 'christmas',
    name: 'Advent calendar (1–25)',
    title: 'Advent Calendar',
    options: range(1, 25),
    removeAfterSpin: true,
    spinsPerDay: 1,
  },
  {
    id: 'yes-no',
    name: 'Yes / No',
    title: 'Yes or No?',
    options: ['Yes', 'No'],
    removeAfterSpin: false,
    spinsPerDay: 0,
  },
  {
    id: 'dinner',
    name: "What's for dinner?",
    title: "What's for Dinner?",
    options: ['Pizza', 'Tacos', 'Pasta', 'Breakfast for dinner', 'Soup', 'Stir fry', 'Burgers', 'Leftovers'],
    removeAfterSpin: false,
    spinsPerDay: 0,
  },
  {
    id: 'chores',
    name: 'Chore wheel',
    title: 'Chore Wheel',
    options: ['Dishes', 'Vacuum', 'Laundry', 'Trash', 'Tidy room', 'Feed pets'],
    removeAfterSpin: true,
    spinsPerDay: 0,
  },
  {
    id: 'blank',
    name: 'Blank — write your own',
    title: 'My Wheel',
    options: [],
    removeAfterSpin: true,
    spinsPerDay: 0,
  },
];

export const DEFAULT_PRESET_ID = 'twelve-days';

export function getPreset(id) {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

/** The options and rules of a preset, with fresh option ids. */
export function wheelFromPreset(presetId) {
  const preset = getPreset(presetId);
  return {
    title: preset.title,
    options: preset.options.map((label) => ({ id: uid(), label, surprise: '' })),
    removeAfterSpin: preset.removeAfterSpin,
    spinsPerDay: preset.spinsPerDay,
  };
}
