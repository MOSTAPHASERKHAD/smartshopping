/*
 * theme-schema.js — Smart Kiosk Theme System
 * Defines the token schema, defaults, and validation helpers.
 * Compatible with: native SmartKiosk format, Shrine/Shopify, Misskey/Sharkey, plain colors, CSS vars.
 */
(function (global) {
  'use strict';

  // ── Font options available in the editor (Google Fonts) ──
  var FONT_OPTIONS = [
    { value: "'Almarai','Inter',sans-serif", label: 'Almarai (افتراضي)' },
    { value: "'Cairo',sans-serif", label: 'Cairo' },
    { value: "'Tajawal',sans-serif", label: 'Tajawal' },
    { value: "'IBM Plex Sans Arabic',sans-serif", label: 'IBM Plex Arabic' },
    { value: "'El Messiri',sans-serif", label: 'El Messiri' },
    { value: "'Amiri',serif", label: 'Amiri (سريف)' },
    { value: "'Inter',sans-serif", label: 'Inter (لاتيني)' },
    { value: "'Poppins',sans-serif", label: 'Poppins' },
    { value: "'Montserrat',sans-serif", label: 'Montserrat' },
    { value: "'Roboto',sans-serif", label: 'Roboto' },
    { value: "'JetBrains Mono',monospace", label: 'JetBrains Mono' },
    { value: "system-ui,sans-serif", label: 'System UI' }
  ];

  // ── The canonical token schema ──
  // Each color maps to a CSS variable --color-<key>
  var COLOR_TOKENS = [
    { key: 'primary',    label: 'اللون الأساسي',    desc: 'الأزرار، الروابط， الشعار', def: '#1a1a2e' },
    { key: 'secondary',  label: 'لون التمييز/العروض', desc: 'العروض، الشارات، اللمسات', def: '#e94560' },
    { key: 'background', label: 'خلفية الصفحة',     desc: 'لون خلفية body', def: '#fafafa' },
    { key: 'surface',    label: 'السطح (كروت)',     desc: 'الكروت، اللوحات، المودال', def: '#ffffff' },
    { key: 'text',       label: 'لون النص',         desc: 'النص الأساسي', def: '#111111' },
    { key: 'textMuted',  label: 'نص ثانوي',         desc: 'نصوص رمادية', def: '#6b6b6b' },
    { key: 'textSubtle', label: 'نص خافت',          desc: 'تعليقات، أرقام صغيرة', def: '#999999' },
    { key: 'border',     label: 'الحدود',           desc: 'الفواصل والحدود', def: '#e8e8e8' },
    { key: 'success',    label: 'نجاح',             desc: 'تأكيد، تم التوصيل', def: '#22c55e' },
    { key: 'warning',    label: 'تحذير',            desc: 'قيد الانتظار', def: '#f59e0b' },
    { key: 'danger',     label: 'خطر/حذف',          desc: 'حذف، ملغي', def: '#ef4444' },
    { key: 'info',       label: 'معلومات',          desc: 'روابط المعلومات', def: '#3b82f6' },
    { key: 'accent',     label: 'لمسة إضافية',      desc: 'تلميحات بصرية', def: '#818cf8' }
  ];

  var FONT_TOKENS = [
    { key: 'heading', label: 'خط العناوين', def: "'Almarai','Inter',sans-serif" },
    { key: 'body',    label: 'خط النص',     def: "'Almarai','Inter',sans-serif" },
    { key: 'mono',    label: 'خط الكود',    def: "'JetBrains Mono',monospace" }
  ];

  var SPACING_TOKENS = [
    { key: 'xs', def: '4px' }, { key: 'sm', def: '8px' }, { key: 'md', def: '16px' },
    { key: 'lg', def: '24px' }, { key: 'xl', def: '32px' }
  ];

  var RADIUS_TOKENS = [
    { key: 'sm', def: '4px' }, { key: 'md', def: '8px' }, { key: 'lg', def: '12px' },
    { key: 'xl', def: '16px' }, { key: 'full', def: '9999px' }
  ];

  var SHADOW_TOKENS = [
    { key: 'sm', def: '0 1px 2px rgba(0,0,0,.05)' },
    { key: 'md', def: '0 4px 6px rgba(0,0,0,.07)' },
    { key: 'lg', def: '0 10px 25px rgba(0,0,0,.10)' }
  ];

  var COMPONENT_TOKENS = [
    { key: 'button', label: 'الأزرار',
      props: [
        { key: 'padding', label: 'الحشو', def: '10px 20px' },
        { key: 'radius', label: 'الزوايا', def: 'var(--radius-md)' },
        { key: 'fontWeight', label: 'سُمك الخط', def: '600' }
      ]
    },
    { key: 'card', label: 'الكروت',
      props: [
        { key: 'border', label: 'الحدود', def: '1px solid var(--border)' },
        { key: 'shadow', label: 'الظل', def: 'var(--shadow-sm)' },
        { key: 'radius', label: 'الزوايا', def: 'var(--radius-lg)' }
      ]
    },
    { key: 'input', label: 'الحقول',
      props: [
        { key: 'border', label: 'الحدود', def: '1px solid var(--border)' },
        { key: 'padding', label: 'الحشو', def: '10px 12px' },
        { key: 'radius', label: 'الزوايا', def: 'var(--radius-md)' }
      ]
    },
    { key: 'modal', label: 'النوافذ',
      props: [
        { key: 'radius', label: 'الزوايا', def: 'var(--radius-lg)' },
        { key: 'shadow', label: 'الظل', def: 'var(--shadow-lg)' }
      ]
    }
  ];

  // ── Build a default token object from schema defaults ──
  function defaultTokens() {
    var t = { colors: {}, fonts: {}, spacing: {}, radius: {}, shadow: {}, components: {} };
    COLOR_TOKENS.forEach(function (c) { t.colors[c.key] = c.def; });
    FONT_TOKENS.forEach(function (f) { t.fonts[f.key] = f.def; });
    SPACING_TOKENS.forEach(function (s) { t.spacing[s.key] = s.def; });
    RADIUS_TOKENS.forEach(function (r) { t.radius[r.key] = r.def; });
    SHADOW_TOKENS.forEach(function (s) { t.shadow[s.key] = s.def; });
    COMPONENT_TOKENS.forEach(function (c) {
      t.components[c.key] = {};
      c.props.forEach(function (p) { t.components[c.key][p.key] = p.def; });
    });
    return t;
  }

  // ── Build dark-mode variant tokens (override colors only) ──
  function darkTokens() {
    return {
      primary: '#818cf8', accent: '#a5b4fc',
      background: '#0f0f1a', surface: '#1a1a2e',
      text: '#e8e6ff', textMuted: '#9d9bc0', textSubtle: '#6b6a8a',
      border: '#2d2b4e', secondary: '#e94560',
      success: '#22c55e', warning: '#f59e0b', danger: '#ef4444', info: '#3b82f6'
    };
  }

  // ── Validate / coerce a color string ──
  function isColor(v) {
    if (typeof v !== 'string') return false;
    return /^(#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})|rgb|rgba|hsl|hsla|var\()/i.test(v.trim());
  }

  function coerceColor(v, fallback) {
    if (isColor(v)) return v.trim();
    return fallback;
  }

  // ── Normalize a partial theme object to full token set (with inherits support handled by engine) ──
  function normalizeTokens(input) {
    input = input || {};
    var base = defaultTokens();
    if (input.colors) {
      COLOR_TOKENS.forEach(function (c) {
        if (input.colors[c.key] != null) base.colors[c.key] = coerceColor(input.colors[c.key], base.colors[c.key]);
      });
    }
    if (input.fonts) {
      FONT_TOKENS.forEach(function (f) {
        if (input.fonts[f.key]) base.fonts[f.key] = String(input.fonts[f.key]);
      });
    }
    if (input.spacing) Object.assign(base.spacing, input.spacing);
    if (input.radius) Object.assign(base.radius, input.radius);
    if (input.shadow) Object.assign(base.shadow, input.shadow);
    if (input.components) {
      COMPONENT_TOKENS.forEach(function (c) {
        if (input.components[c.key]) Object.assign(base.components[c.key], input.components[c.key]);
      });
    }
    return base;
  }

  global.ThemeSchema = {
    FONT_OPTIONS: FONT_OPTIONS,
    COLOR_TOKENS: COLOR_TOKENS,
    FONT_TOKENS: FONT_TOKENS,
    SPACING_TOKENS: SPACING_TOKENS,
    RADIUS_TOKENS: RADIUS_TOKENS,
    SHADOW_TOKENS: SHADOW_TOKENS,
    COMPONENT_TOKENS: COMPONENT_TOKENS,
    defaultTokens: defaultTokens,
    darkTokens: darkTokens,
    isColor: isColor,
    coerceColor: coerceColor,
    normalizeTokens: normalizeTokens
  };
})(window);
