// 线性图标（24×24），配合文字标签使用，不单独依赖图标传达含义。
const s = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const ICON = {
  play: s('<path d="M7 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>'),
  pause: s('<path d="M8 5v14M16 5v14"/>'),
  restart: s('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4"/>'),
  sound: s('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  mute: s('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
  gear: s('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>'),
  explore: s('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/><path d="M11 8v6M8 11h6"/>'),
  lock: s('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  back: s('<path d="M15 5l-7 7 7 7"/>'),
  home: s('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>'),
  plus: s('<path d="M12 5v14M5 12h14"/>'),
  minus: s('<path d="M5 12h14"/>'),
  ffwd: s('<path d="M4 6l8 6-8 6zM12 6l8 6-8 6z" fill="currentColor" stroke="none"/>'),
  book: s('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>'),
  close: s('<path d="M6 6l12 12M18 6L6 18"/>'),
  follow: s('<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>'),
  down: s('<path d="M6 9l6 6 6-6"/>'),
  up: s('<path d="M6 15l6-6 6 6"/>'),
  motion: s('<path d="M3 12h4l3-7 4 14 3-7h4"/>'),
  voice: s('<path d="M4 5h16v10H10l-5 4v-4H4z"/><path d="M8 9h8M8 12h5"/>'),
  voiceOff: s('<path d="M4 5h16v10H10l-5 4v-4H4z"/><path d="M3 3l18 18"/>'),
};
