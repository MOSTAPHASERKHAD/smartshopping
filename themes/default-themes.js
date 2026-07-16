/*
 * default-themes.js — Smart Kiosk prebuilt themes
 * Sets window.SmartKioskThemes consumed by theme-engine.init()
 * Each theme has: distinct colors + unique fonts + custom logo/favicon/banner
 */
(function (global) {
  'use strict';

  function T(id, name, author, colors, extra) {
    var t = {
      __format: 'smartkiosk',
      id: id, name: name, author: author || 'Smart Kiosk',
      version: '1.0', base: colors.background && _isDark(colors.background) ? 'dark' : 'light',
      tokens: { colors: colors || {} }
    };
    if (extra) {
      if (extra.fonts) t.tokens.fonts = extra.fonts;
      if (extra.radius) t.tokens.radius = extra.radius;
      if (extra.images) t.tokens.images = extra.images;
    }
    return t;
  }
  function _isDark(hex) {
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return false;
    var h = m[1]; if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
  }

  var themes = [
    // 0. Default — Smart Kiosk original
    T('smartkiosk-default', 'Smart Kiosk', 'Smart Kiosk',
      { primary: '#1a1a2e', secondary: '#e94560', background: '#f8f7fc', surface: '#ffffff',
        text: '#1a1a2e', textMuted: '#6b6b88', textSubtle: '#9d9dbb', border: '#e5e4f0',
        success: '#22c55e', warning: '#f59e0b', danger: '#ef4444', info: '#6366f1', accent: '#818cf8' },
      { fonts: { heading: "'Cairo',sans-serif", body: "'Almarai','Inter',sans-serif" },
        images: { logoText: 'Smart Shopping', logoIcon: '🛒', favicon: '🛒',
          bannerGradient: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)' } }),

    // 1. Rose — pink / rose gold
    T('rose', 'Rose', 'Smart Kiosk',
      { primary: '#831843', secondary: '#f43f5e', background: '#fff1f2', surface: '#ffffff',
        text: '#4c0519', textMuted: '#881337', textSubtle: '#be6c7f', border: '#fecdd3',
        success: '#22c55e', warning: '#f59e0b', danger: '#be123c', info: '#e11d48', accent: '#fb7185' },
      { fonts: { heading: "'Playfair Display',serif", body: "'Inter',sans-serif" },
        images: { logoText: 'Rose Store', logoIcon: '🌸', favicon: '🌸',
          bannerGradient: 'linear-gradient(135deg, #831843 0%, #be185d 50%, #f43f5e 100%)' } }),

    // 2. Royal — purple + gold
    T('royal', 'Royal', 'Smart Kiosk',
      { primary: '#3b0764', secondary: '#f59e0b', background: '#faf5ff', surface: '#ffffff',
        text: '#2e1065', textMuted: '#6b21a8', textSubtle: '#a38bcb', border: '#e9d5ff',
        success: '#10b981', warning: '#f59e0b', danger: '#dc2626', info: '#8b5cf6', accent: '#a855f7' },
      { fonts: { heading: "'Playfair Display',serif", body: "'Inter',sans-serif" },
        images: { logoText: 'Royal Shop', logoIcon: '👑', favicon: '👑',
          bannerGradient: 'linear-gradient(135deg, #3b0764 0%, #6b21a8 50%, #9333ea 100%)' } }),

    // 3. Algerian — green / white / red
    T('algerian', 'جزائري', 'Smart Kiosk',
      { primary: '#006233', secondary: '#d21034', background: '#f0f7f3', surface: '#ffffff',
        text: '#0d2818', textMuted: '#3f6b54', textSubtle: '#7fa890', border: '#d6e8df',
        success: '#006233', warning: '#f59e0b', danger: '#d21034', info: '#006233', accent: '#14a04a' },
      { fonts: { heading: "'Tajawal',sans-serif", body: "'Almarai',sans-serif" },
        images: { logoText: 'متجر جزائري', logoIcon: '🇩🇿', favicon: '🇩🇿',
          bannerGradient: 'linear-gradient(135deg, #006233 0%, #006233 33%, #ffffff 33%, #ffffff 66%, #d21034 66%, #d21034 100%)' } }),

    // 4. Ramadan — dark navy + gold
    T('ramadan', 'رمضان', 'Smart Kiosk',
      { primary: '#c8a84e', secondary: '#f5d742', background: '#0a0e1a', surface: '#131b33',
        text: '#f5eedc', textMuted: '#c7b896', textSubtle: '#94875f', border: '#2a3a5c',
        success: '#22c55e', warning: '#f59e0b', danger: '#ef4444', info: '#c8a84e', accent: '#e8c766' },
      { fonts: { heading: "'Amiri',serif", body: "'Almarai',sans-serif" },
        images: { logoText: 'رمضان كريم', logoIcon: '🌙', favicon: '🌙',
          bannerGradient: 'linear-gradient(135deg, #0a0e1a 0%, #131b33 50%, #1a2744 100%)' } }),

    // 5. Emerald — deep green
    T('emerald', 'Emerald', 'Smart Kiosk',
      { primary: '#064e3b', secondary: '#34d399', background: '#ecfdf5', surface: '#ffffff',
        text: '#022c22', textMuted: '#3f7a68', textSubtle: '#6fae9c', border: '#d1fae5',
        success: '#059669', warning: '#d97706', danger: '#dc2626', info: '#0ea5e9', accent: '#10b981' },
      { fonts: { heading: "'Playfair Display',serif", body: "'Inter',sans-serif" },
        images: { logoText: 'Emerald Store', logoIcon: '💎', favicon: '💎',
          bannerGradient: 'linear-gradient(135deg, #064e3b 0%, #065f46 50%, #047857 100%)' } }),

    // 6. Sunset — warm orange
    T('sunset', 'Sunset', 'Smart Kiosk',
      { primary: '#ff6b35', secondary: '#ff4d6d', background: '#fff8f0', surface: '#ffffff',
        text: '#2d1b00', textMuted: '#9a5a3c', textSubtle: '#c2886a', border: '#fed7aa',
        success: '#22c55e', warning: '#f97316', danger: '#dc2626', info: '#ea580c', accent: '#fb923c' },
      { fonts: { heading: "'Poppins',sans-serif", body: "'Inter',sans-serif" },
        images: { logoText: 'Sunset Shop', logoIcon: '🌅', favicon: '🌅',
          bannerGradient: 'linear-gradient(135deg, #ff6b35 0%, #ff4d6d 50%, #ff3366 100%)' } }),

    // 7. Midnight — dark blue
    T('midnight', 'Midnight', 'Smart Kiosk',
      { primary: '#1e3a8a', secondary: '#38bdf8', background: '#0b1120', surface: '#1e293b',
        text: '#e2e8f0', textMuted: '#94a3b8', textSubtle: '#64748b', border: '#334155',
        success: '#22c55e', warning: '#f59e0b', danger: '#ef4444', info: '#38bdf8', accent: '#7dd3fc' },
      { fonts: { heading: "'Poppins',sans-serif", body: "'Inter',sans-serif" },
        images: { logoText: 'Midnight', logoIcon: '🌙', favicon: '🌙',
          bannerGradient: 'linear-gradient(135deg, #0b1120 0%, #1e3a8a 50%, #2563eb 100%)' } }),

    // 8. Ocean — teal sea
    T('ocean', 'Ocean', 'Smart Kiosk',
      { primary: '#115e59', secondary: '#14b8a6', background: '#ecfeff', surface: '#ffffff',
        text: '#042f2e', textMuted: '#3b7a8c', textSubtle: '#6b9fae', border: '#cffafe',
        success: '#059669', warning: '#f59e0b', danger: '#ef4444', info: '#0891b2', accent: '#2dd4bf' },
      { fonts: { heading: "'Lora',serif", body: "'Inter',sans-serif" },
        images: { logoText: 'Ocean Store', logoIcon: '🌊', favicon: '🌊',
          bannerGradient: 'linear-gradient(135deg, #115e59 0%, #0d9488 50%, #14b8a6 100%)' } }),

    // 9. Mono — pure B&W
    T('mono', 'Mono', 'Smart Kiosk',
      { primary: '#000000', secondary: '#333333', background: '#ffffff', surface: '#ffffff',
        text: '#000000', textMuted: '#555555', textSubtle: '#999999', border: '#e0e0e0',
        success: '#000000', warning: '#888888', danger: '#000000', info: '#000000', accent: '#444444' },
      { fonts: { heading: "'Inter',sans-serif", body: "'Inter',sans-serif" },
        radius: { sm: '0px', md: '0px', lg: '0px', xl: '0px', full: '0px' },
        images: { logoText: 'MONO', logoIcon: '◼', favicon: '◼',
          bannerGradient: 'linear-gradient(135deg, #000000 0%, #333333 50%, #555555 100%)' } }),

    // 10. Cyber — neon / dark
    T('cyber', 'Cyber', 'Smart Kiosk',
      { primary: '#00ff88', secondary: '#ff00ff', background: '#0a0a0f', surface: '#141428',
        text: '#e0e0ff', textMuted: '#8888bb', textSubtle: '#555577', border: '#2a2a4a',
        success: '#00ff88', warning: '#ffff00', danger: '#ff0044', info: '#00ccff', accent: '#bb00ff' },
      { fonts: { heading: "'Poppins',sans-serif", body: "'JetBrains Mono',monospace" },
        images: { logoText: 'CYBER', logoIcon: '⚡', favicon: '⚡',
          bannerGradient: 'linear-gradient(135deg, #0a0a0f 0%, #1a0a2e 33%, #2a0a4e 66%, #0a0a0f 100%)' } }),

    // 11. Lavender — soft purple
    T('lavender', 'Lavender', 'Smart Kiosk',
      { primary: '#4c1d95', secondary: '#c084fc', background: '#f5f3ff', surface: '#ffffff',
        text: '#2e1065', textMuted: '#6d28d9', textSubtle: '#a78bfa', border: '#ede9fe',
        success: '#10b981', warning: '#f59e0b', danger: '#e11d48', info: '#7c3aed', accent: '#a78bfa' },
      { fonts: { heading: "'Playfair Display',serif", body: "'Inter',sans-serif" },
        images: { logoText: 'Lavender', logoIcon: '💜', favicon: '💜',
          bannerGradient: 'linear-gradient(135deg, #4c1d95 0%, #7c3aed 50%, #a78bfa 100%)' } })
  ];

  global.SmartKioskThemes = themes;
})(window);
