/*
 * default-themes.js — Smart Kiosk prebuilt themes
 * Sets window.SmartKioskThemes consumed by theme-engine.init()
 */
(function (global) {
  'use strict';

  // Helper to build a theme object with only the tokens we override (engine fills the rest)
  function T(id, name, author, colors, extra) {
    var t = {
      __format: 'smartkiosk',
      id: id, name: name, author: author || 'Smart Kiosk',
      version: '1.0', base: 'light', tokens: { colors: colors || {} }
    };
    if (extra) {
      if (extra.fonts) t.tokens.fonts = extra.fonts;
      if (extra.radius) t.tokens.radius = extra.radius;
      if (extra.components) t.tokens.components = extra.components;
      if (extra.spacing) t.tokens.spacing = extra.spacing;
    }
    return t;
  }

  var themes = [
    // 0. Default — matches the original Smart Shopping site palette
    T('smartkiosk-default', 'الافتراضي', 'Smart Kiosk',
      { primary: '#1a1a2e', secondary: '#e94560', background: '#fafafa', surface: '#ffffff',
        text: '#111111', textMuted: '#6b6b6b', textSubtle: '#999999', border: '#e8e8e8',
        success: '#22c55e', warning: '#f59e0b', danger: '#ef4444', info: '#3b82f6', accent: '#818cf8' }),

    // 1. Shrine Classic — inspired by Shrine theme (blue + pink)
    T('shrine-classic', 'Shrine Classic', 'Shrine',
      { primary: '#1a1a2e', secondary: '#e94560', background: '#fafafa', surface: '#ffffff',
        text: '#111111', textMuted: '#6b6b6b', textSubtle: '#999999', border: '#e8e8e8',
        success: '#22c55e', warning: '#f59e0b', danger: '#ef4444', info: '#3b82f6', accent: '#818cf8' }),

    // 2. Shrine Pro — purple + black
    T('shrine-pro', 'Shrine Pro', 'Shrine',
      { primary: '#2d1b4e', secondary: '#a855f7', background: '#f6f5f9', surface: '#ffffff',
        text: '#1a1024', textMuted: '#6d5b85', textSubtle: '#9b8bb0', border: '#e7e2ef',
        success: '#22c55e', warning: '#f59e0b', danger: '#ef4444', info: '#7c3aed', accent: '#c084fc' },
      { fonts: { heading: "'Poppins',sans-serif", body: "'Inter',sans-serif", mono: "'JetBrains Mono',monospace" } }),

    // 3. Algerian Flag — green / white / red
    T('algerian-flag', 'Algerian Flag', 'Smart Kiosk',
      { primary: '#006233', secondary: '#d21034', background: '#f7fbf8', surface: '#ffffff',
        text: '#0d2818', textMuted: '#3f6b54', textSubtle: '#7fa890', border: '#d6e8df',
        success: '#006233', warning: '#f59e0b', danger: '#d21034', info: '#006233', accent: '#14a04a' }),

    // 4. Ramadan — gold + navy
    T('ramadan', 'Ramadan', 'Smart Kiosk',
      { primary: '#0b1d3a', secondary: '#d4af37', background: '#0f1830', surface: '#16213e',
        text: '#f5eedc', textMuted: '#c7b896', textSubtle: '#94875f', border: '#2a3a5c',
        success: '#22c55e', warning: '#f59e0b', danger: '#ef4444', info: '#d4af37', accent: '#e8c766' },
      { fonts: { heading: "'Amiri',serif", body: "'Almarai','Inter',sans-serif", mono: "'JetBrains Mono',monospace" } }),

    // 5. Emerald — modern green
    T('emerald', 'Emerald', 'Smart Kiosk',
      { primary: '#047857', secondary: '#10b981', background: '#f0fdf9', surface: '#ffffff',
        text: '#052e22', textMuted: '#3f7a68', textSubtle: '#6fae9c', border: '#d1fae5',
        success: '#047857', warning: '#f59e0b', danger: '#ef4444', info: '#0ea5e9', accent: '#34d399' }),

    // 6. Sunset — orange + pink
    T('sunset', 'Sunset', 'Smart Kiosk',
      { primary: '#ea580c', secondary: '#ec4899', background: '#fff7ed', surface: '#ffffff',
        text: '#431407', textMuted: '#9a5a3c', textSubtle: '#c2886a', border: '#fed7aa',
        success: '#22c55e', warning: '#f59e0b', danger: '#ef4444', info: '#f97316', accent: '#fb923c' }),

    // 7. Midnight — deep night blue
    T('midnight', 'Midnight', 'Smart Kiosk',
      { primary: '#0f172a', secondary: '#38bdf8', background: '#0b1120', surface: '#1e293b',
        text: '#e2e8f0', textMuted: '#94a3b8', textSubtle: '#64748b', border: '#334155',
        success: '#22c55e', warning: '#f59e0b', danger: '#ef4444', info: '#38bdf8', accent: '#7dd3fc' }),

    // 8. Mono — pure black & white
    T('mono-light', 'Mono Light', 'Smart Kiosk',
      { primary: '#000000', secondary: '#000000', background: '#ffffff', surface: '#ffffff',
        text: '#000000', textMuted: '#555555', textSubtle: '#888888', border: '#e0e0e0',
        success: '#000000', warning: '#666666', danger: '#000000', info: '#000000', accent: '#444444' },
      { radius: { sm: '0px', md: '0px', lg: '0px', xl: '0px', full: '0px' } }),

    // 9. Mono Dark — pure dark
    T('mono-dark', 'Mono Dark', 'Smart Kiosk',
      { primary: '#ffffff', secondary: '#ffffff', background: '#000000', surface: '#0a0a0a',
        text: '#ffffff', textMuted: '#aaaaaa', textSubtle: '#777777', border: '#222222',
        success: '#ffffff', warning: '#cccccc', danger: '#ffffff', info: '#ffffff', accent: '#dddddd' },
      { radius: { sm: '0px', md: '0px', lg: '0px', xl: '0px', full: '0px' } }),

    // 10. Ocean — teal/cyan
    T('ocean', 'Ocean', 'Smart Kiosk',
      { primary: '#0e7490', secondary: '#06b6d4', background: '#ecfeff', surface: '#ffffff',
        text: '#083344', textMuted: '#3b7a8c', textSubtle: '#6b9fae', border: '#cffafe',
        success: '#059669', warning: '#f59e0b', danger: '#ef4444', info: '#0891b2', accent: '#22d3ee' })
  ];

  global.SmartKioskThemes = themes;
})(window);
