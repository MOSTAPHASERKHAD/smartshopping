/*
 * theme-engine.js — Smart Kiosk Theme Engine
 * Applies themes to :root, manages modes (light/dark/auto), handles storage & server sync.
 * Depends on: theme-schema.js, theme-importer.js (loaded before this)
 */
(function (global) {
  'use strict';

  var Schema = global.ThemeSchema;
  var Importer = global.ThemeImporter;

  var STORAGE_KEY = 'sk_theme_v1';
  var DEFAULT_THEME_ID = 'smartkiosk-default';

  function ThemeEngine() {
    this.themes = {};           // id -> theme object
    this.activeId = null;
    this.mode = 'auto';         // light | dark | auto
    this.systemDark = false;
    this.defaultThemeId = null; // store default (from server)
    this._media = null;
    this._onChange = null;
  }

  // ── Register a theme (merges with base if `extends`) ──
  ThemeEngine.prototype.register = function (theme, opts) {
    opts = opts || {};
    if (!theme || !theme.id) return null;
    // resolve inheritance
    var resolved = this._resolveExtends(theme);
    this.themes[theme.id] = resolved;
    if (!opts.silent && this.activeId === theme.id) this.apply(theme.id, this.mode);
    return resolved;
  };

  ThemeEngine.prototype._resolveExtends = function (theme) {
    var tokens = Schema.normalizeTokens(theme.tokens || {});
    if (theme.extends && this.themes[theme.extends]) {
      var parent = this.themes[theme.extends];
      // parent tokens already normalized; deep-merge
      tokens = this._mergeTokens(parent.tokens, tokens);
    }
    var out = {
      id: theme.id,
      name: theme.name || 'Untitled',
      author: theme.author || '',
      version: theme.version || '1.0',
      base: theme.base || (theme.tokens && theme.tokens.colors && theme.tokens.colors.background &&
              this._isDark(theme.tokens.colors.background) ? 'dark' : 'light'),
      extends: theme.extends || null,
      tokens: tokens
    };
    return out;
  };

  ThemeEngine.prototype._mergeTokens = function (parent, child) {
    var merged = JSON.parse(JSON.stringify(parent));
    ['colors', 'fonts', 'spacing', 'radius', 'shadow'].forEach(function (grp) {
      if (child[grp]) Object.assign(merged[grp], child[grp]);
    });
    if (child.components) {
      Object.keys(child.components).forEach(function (k) {
        merged.components[k] = Object.assign({}, merged.components[k], child.components[k]);
      });
    }
    return merged;
  };

  ThemeEngine.prototype._isDark = function (hex) {
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return false;
    var h = m[1];
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
    // perceived luminance
    var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum < 0.5;
  };

  // ── Convert tokens → CSS custom properties string ──
  ThemeEngine.prototype._tokensToCSS = function (tokens, mode, themeBase) {
    var lines = [];
    // Clone colors so we never mutate the original theme tokens
    var c = {};
    Object.keys(tokens.colors).forEach(function (k) { c[k] = tokens.colors[k]; });
    // In dark mode, override color subset with darkTokens only for light-base themes.
    // Dark-base themes (e.g. Shrine dark, Midnight) keep their own colors.
    if (mode === 'dark' && themeBase !== 'dark') {
      var dk = Schema.darkTokens();
      Object.keys(dk).forEach(function (k) { if (c[k]) c[k] = dk[k]; });
    }
    Object.keys(c).forEach(function (k) { lines.push('  --color-' + k + ':' + c[k] + ';'); });
    Object.keys(tokens.fonts).forEach(function (k) { lines.push('  --font-' + k + ':' + tokens.fonts[k] + ';'); });
    Object.keys(tokens.spacing).forEach(function (k) { lines.push('  --space-' + k + ':' + tokens.spacing[k] + ';'); });
    Object.keys(tokens.radius).forEach(function (k) { lines.push('  --radius-' + k + ':' + tokens.radius[k] + ';'); });
    Object.keys(tokens.shadow).forEach(function (k) { lines.push('  --shadow-' + k + ':' + tokens.shadow[k] + ';'); });
    // components
    Object.keys(tokens.components).forEach(function (comp) {
      var props = tokens.components[comp];
      Object.keys(props).forEach(function (p) {
        lines.push('  --' + comp + '-' + p + ':' + props[p] + ';');
      });
    });
    // legacy aliases used by existing CSS (must all be present or old CSS breaks)
    lines.push('  --bg:' + c.background + ';');
    lines.push('  --card:' + c.surface + ';');
    lines.push('  --text:' + c.text + ';');
    lines.push('  --text2:' + c.textMuted + ';');
    lines.push('  --text3:' + c.textSubtle + ';');
    lines.push('  --border:' + c.border + ';');
    lines.push('  --border2:' + c.border + ';');
    lines.push('  --accent:' + c.primary + ';');
    lines.push('  --accent2:' + c.accent + ';');
    lines.push('  --sale:' + c.secondary + ';');
    lines.push('  --sale-hover:' + this._darken(c.secondary, 0.12) + ';');
    lines.push('  --success:' + c.success + ';');
    lines.push('  --danger:' + c.danger + ';');
    lines.push('  --font:' + tokens.fonts.body + ';');
    lines.push('  --radius:' + Schema.RADIUS_TOKENS[2].def + ';');
    lines.push('  --shadow:0 2px 8px rgba(0,0,0,.06);');
    lines.push('  --max-w:1200px;');
    // image tokens
    if (tokens.images) {
      var imgs = tokens.images;
      var logoUrl = Schema.makeLogoSvg(imgs.logoText || 'Smart Shopping', imgs.logoIcon || '🛒', c.primary, 'transparent');
      lines.push('  --logo-url:url(' + logoUrl + ');');
      lines.push('  --logo-icon:' + (imgs.logoIcon || '🛒') + ';');
      lines.push('  --logo-text:' + (imgs.logoText || 'Smart Shopping') + ';');
      lines.push('  --favicon:' + (imgs.favicon || '🛒') + ';');
      if (imgs.bannerGradient) lines.push('  --banner-gradient:' + imgs.bannerGradient + ';');
      if (imgs.bannerAccent) lines.push('  --banner-accent:' + imgs.bannerAccent + ';');
    }
    var rootCss = ':root{\n' + lines.join('\n') + '\n}';
    // Also generate body.dark-mode with same values to override the ORIGINAL hardcoded body.dark-mode block
    // (original CSS has higher-specificity body.dark-mode vars that would otherwise override our :root)
    var darkBlock = 'body.dark-mode{\n' + lines.join('\n') + '\n}';
    return rootCss + '\n' + darkBlock;
  };

  ThemeEngine.prototype._darken = function (color, amt) {
    var m = /^#([0-9a-f]{6})$/i.exec(color || '');
    if (!m) return color;
    var h = m[1];
    var r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
    r = Math.max(0, Math.round(r * (1 - amt)));
    g = Math.max(0, Math.round(g * (1 - amt)));
    b = Math.max(0, Math.round(b * (1 - amt)));
    return '#' + [r, g, b].map(function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  };

  // ── Apply a theme by id (and mode) ──
  ThemeEngine.prototype.apply = function (themeId, mode) {
    try {
      var theme = this.themes[themeId];
      if (!theme) { console.warn('ThemeEngine: theme not found', themeId); return false; }
      this.activeId = themeId;
      if (mode) this.mode = mode;
      var effectiveMode = this._effectiveMode();
      console.log('ThemeEngine.apply:', themeId, mode, '→', effectiveMode, 'base:', theme.base);

      // inject CSS
      var styleEl = document.getElementById('theme-engine-style');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'theme-engine-style';
        document.head.appendChild(styleEl);
        console.log('ThemeEngine: created style element');
      }
      var css = this._tokensToCSS(theme.tokens, effectiveMode, theme.base);
      styleEl.textContent = css;
      console.log('ThemeEngine: CSS injected, length=' + css.length + ', has--bg=' + css.includes('--bg'));

      // body classes
      document.body.classList.toggle('dark-mode', effectiveMode === 'dark');
      document.documentElement.setAttribute('data-theme', themeId);
      document.documentElement.setAttribute('data-mode', effectiveMode);
      console.log('ThemeEngine: body classes/attrs set, dark-mode=' + (effectiveMode === 'dark'));

      // update manifest theme-color
      this._updateManifest(theme, effectiveMode);

      // update theme images (logo, favicon) — wrapped to prevent breaking
      try { this._applyImages(theme); } catch (e) { console.warn('ThemeEngine: _applyImages error', e); }

      this._persist();
      if (this._onChange) this._onChange(theme, effectiveMode);
      return true;
    } catch (e) {
      console.error('ThemeEngine.apply error:', e);
      return false;
    }
  };

  ThemeEngine.prototype._effectiveMode = function () {
    if (this.mode === 'auto') return this.systemDark ? 'dark' : 'light';
    return this.mode;
  };

  ThemeEngine.prototype._updateManifest = function (theme, mode) {
    var color = theme.tokens.colors.primary;
    if (mode === 'dark') color = theme.tokens.colors.surface;
    try {
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', color);
      var manifestLink = document.querySelector('link[rel="manifest"]');
      if (manifestLink) {
        // best-effort: cannot rewrite manifest file, but ok
      }
    } catch (e) {}
  };

  // ── Apply theme images (logo, favicon) to DOM ──
  ThemeEngine.prototype._applyImages = function (theme) {
    var imgs = theme.tokens.images;
    if (!imgs) return;
    // update logo images
    var logoUrl = Schema.makeLogoSvg(imgs.logoText || 'Smart Shopping', imgs.logoIcon || '🛒', theme.tokens.colors.primary, 'transparent');
    var logoEls = document.querySelectorAll('header .logo, .footer-brand .logo');
    for (var i = 0; i < logoEls.length; i++) {
      var el = logoEls[i];
      var logoImg = el.querySelector('img');
      if (!logoImg) {
        logoImg = document.createElement('img');
        logoImg.style.width = 'auto';
        el.prepend(logoImg);
      }
      logoImg.style.height = el.closest('footer') ? '40px' : '48px';
      logoImg.src = logoUrl;
      logoImg.alt = imgs.logoText || 'Smart Shopping';
    }
    // update favicon
    if (imgs.favicon) {
      var link = document.querySelector('link[rel="icon"]');
      if (link) {
        link.href = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">' + encodeURIComponent(imgs.favicon) + '</text></svg>';
      }
    }
    // update hero banner gradient
    if (imgs.bannerGradient) {
      var hero = document.getElementById('heroSlider');
      if (hero) hero.style.background = imgs.bannerGradient;
    }
  };

  // ── Mode handling ──
  ThemeEngine.prototype.setMode = function (mode) {
    this.mode = mode;
    if (mode === 'auto' && !this._media) this._initMedia();
    this.apply(this.activeId || this.defaultThemeId, mode);
  };

  ThemeEngine.prototype._initMedia = function () {
    if (!global.matchMedia) return;
    this._media = global.matchMedia('(prefers-color-scheme: dark)');
    var self = this;
    this.systemDark = this._media.matches;
    var handler = function (e) {
      self.systemDark = e.matches;
      if (self.mode === 'auto' && self.activeId) self.apply(self.activeId, 'auto');
    };
    if (this._media.addEventListener) this._media.addEventListener('change', handler);
    else if (this._media.addListener) this._media.addListener(handler);
  };

  // ── Persistence ──
  ThemeEngine.prototype._persist = function () {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: this.activeId, mode: this.mode }));
    } catch (e) {}
  };

  ThemeEngine.prototype.loadLocal = function () {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var p = JSON.parse(raw);
      if (p.id) this.activeId = p.id;
      if (p.mode) this.mode = p.mode;
      return p;
    } catch (e) { return null; }
  };

  // ── Load default theme from server settings ──
  ThemeEngine.prototype.init = function (opts) {
    opts = opts || {};
    this._initMedia();
    this._initRegister(opts);
  };

  // Register built-in themes. If default-themes.js hasn't executed yet
  // (async script load, or a stale cached HTML), poll briefly until it is.
  ThemeEngine.prototype._initRegister = function (opts) {
    var self = this;
    function doRegister() {
      if (!global.SmartKioskThemes) return false;
      global.SmartKioskThemes.forEach(function (t) { self.register(t, { silent: true }); });
      return true;
    }
    if (doRegister()) {
      this._initApply(opts);
      return;
    }
    // themes not ready — poll (handles async / late script execution)
    if (this._initTimer) return; // already polling
    var tries = 0;
    this._initTimer = setInterval(function () {
      tries++;
      if (doRegister() || tries > 60) {
        clearInterval(self._initTimer);
        self._initTimer = null;
        self._initApply(opts);
      }
    }, 80);
  };

  ThemeEngine.prototype._initApply = function (opts) {
    opts = opts || {};
    var local = this.loadLocal();
    if (opts.defaultThemeId) this.defaultThemeId = opts.defaultThemeId;
    if (opts.themes && opts.themes.length) {
      var self2 = this;
      opts.themes.forEach(function (t) { self2.register(t, { silent: true }); });
    }
    // Decide which theme to show
    var showId = (local && this.themes[local.id]) ? local.id
               : ((this.defaultThemeId && this.themes[this.defaultThemeId]) ? this.defaultThemeId
               : ((this.activeId && this.themes[this.activeId]) ? this.activeId
               : (this.themes[DEFAULT_THEME_ID] ? DEFAULT_THEME_ID
               : (Object.keys(this.themes)[0] || null))));
    var showMode = (local && local.mode) ? local.mode : (opts.defaultMode || 'auto');
    this.apply(showId, showMode);
  };

  // ── Import a theme file (delegates to importer) ──
  ThemeEngine.prototype.importFile = function (file) {
    if (!global.ThemeImporter) throw new Error('ThemeImporter not loaded');
    return global.ThemeImporter.normalize(file);
  };

  // ── Export a theme as downloadable JSON ──
  ThemeEngine.prototype.exportTheme = function (themeId, filename) {
    var theme = this.themes[themeId];
    if (!theme) return;
    var out = {
      __format: 'smartkiosk',
      id: theme.id,
      name: theme.name,
      author: theme.author,
      version: theme.version,
      base: theme.base,
      extends: theme.extends,
      tokens: theme.tokens
    };
    var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || (theme.id + '.json');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  };

  // ── List available themes (id+name+base) for switcher ──
  ThemeEngine.prototype.list = function () {
    var self = this;
    return Object.keys(this.themes).map(function (id) {
      var t = self.themes[id];
      return {
        id: id, name: t.name, base: t.base, author: t.author,
        tokens: t.tokens  // needed by theme switcher for color swatches
      };
    });
  };

  ThemeEngine.prototype.get = function (id) { return this.themes[id]; };

  ThemeEngine.prototype.onChange = function (cb) { this._onChange = cb; };

  // singleton
  global.ThemeEngine = new ThemeEngine();
  global.ThemeEngineClass = ThemeEngine;
})(window);
