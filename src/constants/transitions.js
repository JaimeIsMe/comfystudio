export const FRAME_RATE = 24

export const TRANSITION_DURATIONS = [
  { frames: 6, seconds: 6 / FRAME_RATE },
  { frames: 12, seconds: 12 / FRAME_RATE },
  { frames: 24, seconds: 24 / FRAME_RATE },
  { frames: 48, seconds: 48 / FRAME_RATE },
]

export const TRANSITION_TYPES = [
  { id: 'dissolve', name: 'Cross Dissolve', icon: '⚪' },
  { id: 'fade-black', name: 'Fade to Black', icon: '⬛' },
  { id: 'fade-white', name: 'Fade to White', icon: '⬜' },
  { id: 'wipe-left', name: 'Wipe Left', icon: '◀' },
  { id: 'wipe-right', name: 'Wipe Right', icon: '▶' },
  { id: 'wipe-up', name: 'Wipe Up', icon: '▲' },
  { id: 'wipe-down', name: 'Wipe Down', icon: '▼' },
  { id: 'slide-left', name: 'Slide Left', icon: '⇠' },
  { id: 'slide-right', name: 'Slide Right', icon: '⇢' },
  { id: 'slide-up', name: 'Slide Up', icon: '⇡' },
  { id: 'slide-down', name: 'Slide Down', icon: '⇣' },
  { id: 'zoom-in', name: 'Zoom In', icon: '🔍' },
  { id: 'zoom-out', name: 'Zoom Out', icon: '🔎' },
  { id: 'blur', name: 'Blur Dissolve', icon: '💨' },
]

export const TRANSITION_CATEGORIES = [
  {
    id: 'dissolve',
    label: 'Dissolve',
    items: ['dissolve', 'blur', 'fade-black', 'fade-white'],
  },
  {
    id: 'motion',
    label: 'Motion',
    items: ['slide-left', 'slide-right', 'slide-up', 'slide-down', 'zoom-in', 'zoom-out'],
  },
  {
    id: 'wipe',
    label: 'Wipe',
    items: ['wipe-left', 'wipe-right', 'wipe-up', 'wipe-down'],
  },
]

export const TRANSITION_DEFAULT_SETTINGS = {
  'zoom-in': { zoomAmount: 0.1 },
  'zoom-out': { zoomAmount: 0.1 },
  blur: { blurAmount: 8 },
}
