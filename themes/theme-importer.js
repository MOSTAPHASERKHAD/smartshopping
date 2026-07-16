/*
 * theme-importer.js — Universal Theme Importer
 * Accepts ANY theme format and normalizes it to the Smart Kiosk schema:
 *   - native SmartKiosk ({__format:'smartkiosk', tokens:{...}})
 *   - Shrine / Shopify (settings_data.json with current.theme / settings)
 *   - Misskey / Sharkey ({props:{...}})
 *   - plain color object ({primary:'#...', bg:'#...'})
 *   - CSS variables object ({'--color-primary':'#...'})
 * Returns a theme object ready for ThemeEngine.register()
 */
(function (global) {
  'use strict';

  // Color key alias map — used to match arbitrary keys to our schema
  var COLOR_ALIASES = {
    primary: ['primary', 'main', 'brand', 'color_primary', 'color_button', 'color_link', 'accent1', 'theme_primary'],
    secondary: ['secondary', 'sale', 'color_sale', 'color_secondary', 'accent2', 'highlight', 'theme_secondary'],
    background: ['background', 'bg', 'body_bg', 'color_bg', 'color_background', 'page_bg', 'canvas', 'theme_bg'],
    surface: ['surface', 'card', 'panel', 'color_surface', 'color_card', 'color_panel', 'elevated'],
    text: ['text', 'foreground', 'color_text', 'color_body_text', 'body_text', 'theme_text', 'fg'],
    textMuted: ['textmuted', 'muted', 'text_secondary', 'color_text_muted', 'subtext', 'theme_subtext'],
    textSubtle: ['textsubtle', 'subtle', 'text_tertiary', 'color_text_subtle', 'faint', 'theme_faint'],
    border: ['border', 'line', 'color_border', 'divider', 'theme_border', 'stroke'],
    success: ['success', 'color_success', 'ok', 'positive', 'green'],
    warning: ['warning', 'color_warning', 'warn', 'yellow', 'amber'],
    danger: ['danger', 'error', 'color_danger', 'color_error', 'red', 'destructive'],
    info: ['info', 'color_info', 'blue', 'link'],
    accent: ['accent', 'accent3', 'theme_accent', 'pop', 'color_accent']
  };

  // Build reverse lookup: normalizedKey -> ourToken
  var REVERSE = {};
  Object.keys(COLOR_ALIASES).forEach(function (token) {
    COLOR_ALIASES[token].forEach(function (alias) {
      REVERSE[alias] = token;
    });
  });

  function matchColorKey(rawKey) {
    if (!rawKey) return null;
    var k = String(rawKey).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (REVERSE[k]) return REVERSE[k];
    // fuzzy: does it contain a known token word?
    var tokens = ['primary', 'secondary', 'background', 'surface', 'text', 'muted', 'subtle',
                  'border', 'success', 'warning', 'danger', 'info', 'accent', 'sale', 'brand'];
    for (var i = 0; i < tokens.length; i++) {
      if (k.indexOf(tokens[i]) > -1) return tokens[i] === 'sale' ? 'secondary' : tokens[i];
    }
    return null;
  }

  function isColorVal(v) {
    return global.ThemeSchema ? global.ThemeSchema.isColor(v) : /^(#|rgb|rgba|hsl|hsla|var\()/i.test(v);
  }

  var Importer = {
    // Main entry: pass a parsed JS object (from JSON.parse)
    normalize: function (raw) {
      if (!raw || typeof raw !== 'object') throw new Error('ملف الثيم فارغ أو غير صالح');
      if (raw.__format === 'smartkiosk') return this._fromNative(raw);
      if (raw.props && typeof raw.props === 'object') return this._fromMisskey(raw);
      if (raw.settings_data || raw.current || raw.config) return this._fromShopify(raw);
      if (raw.theme || raw.theme_name || raw.name) return this._fromGeneric(raw);
      // color object detection
      if (this._isColorObject(raw)) return this._fromColorObject(raw);
      if (this._isCSSVarObject(raw)) return this._fromCSSVars(raw);
      // fallback: scan for any color-ish values
      var scanned = this._scanAny(raw);
      if (scanned && scanned.tokens.colors && Object.keys(scanned.tokens.colors).length) return scanned;
      throw new Error('تنسيق ثيم غير معروف. جرّب ملف JSON يحتوي على ألوان أو متغيرات CSS.');
    },

    _fromNative: function (raw) {
      return {
        __format: 'smartkiosk',
        id: raw.id || ('imported-' + Date.now()),
        name: raw.name || 'Imported Theme',
        author: raw.author || 'Imported',
        version: raw.version || '1.0',
        base: raw.base || 'light',
        extends: raw.extends || null,
        tokens: global.ThemeSchema.normalizeTokens(raw.tokens || {})
      };
    },

    // Misskey / Sharkey: { id, name, author, base, props:{ fg, bg, accent, ... } }
    _fromMisskey: function (raw) {
      var colors = {};
      var p = raw.props || {};
      Object.keys(p).forEach(function (k) {
        var token = matchColorKey(k);
        if (token && isColorVal(p[k])) colors[token] = p[k];
      });
      // explicit known misskey keys
      if (p.fg) colors.text = p.fg;
      if (p.bg) colors.background = p.bg;
      if (p.accent) colors.accent = p.accent;
      return {
        __format: 'smartkiosk',
        id: raw.id || ('misskey-' + Date.now()),
        name: raw.name || 'Misskey Theme',
        author: raw.author || 'Imported',
        version: raw.version || '1.0',
        base: raw.base === 'dark' ? 'dark' : 'light',
        tokens: global.ThemeSchema.normalizeTokens({ colors: colors })
      };
    },

    // Shrine / Shopify: settings_data.json → current.theme / current.blocks
    _fromShopify: function (raw) {
      var src = raw.current && raw.current.theme ? raw.current.theme
              : raw.settings_data && raw.settings_data.current && raw.settings_data.current.theme
              ? raw.settings_data.current.theme
              : raw.config || raw.settings || raw;
      var colors = {};
      // Shopify uses keys like 'color_primary', 'color_button', 'color_background', etc.
      Object.keys(src).forEach(function (k) {
        var token = matchColorKey(k);
        if (token && isColorVal(src[k])) colors[token] = src[k];
      });
      // Also scan blocks (section settings)
      if (raw.current && raw.current.blocks) {
        Object.keys(raw.current.blocks).forEach(function (bid) {
          var blk = raw.current.blocks[bid];
          if (blk && blk.settings) {
            Object.keys(blk.settings).forEach(function (sk) {
              var token = matchColorKey(sk);
              if (token && isColorVal(blk.settings[sk]) && !colors[token]) colors[token] = blk.settings[sk];
            });
          }
        });
      }
      var fonts = {};
      Object.keys(src).forEach(function (k) {
        var lk = k.toLowerCase();
        if (lk.indexOf('font') > -1 && typeof src[k] === 'string' && src[k].length < 120) {
          if (lk.indexOf('heading') > -1 || lk.indexOf('title') > -1) fonts.heading = src[k];
          else if (lk.indexOf('body') > -1 || lk.indexOf('text') > -1) fonts.body = src[k];
        }
      });
      return {
        __format: 'smartkiosk',
        id: 'shrine-' + Date.now(),
        name: raw.theme_name || raw.name || 'Imported Shrine Theme',
        author: raw.author || 'Shrine',
        version: raw.version || '1.0',
        base: colors.background && global.ThemeSchema ? 'light' : 'light',
        tokens: global.ThemeSchema.normalizeTokens({ colors: colors, fonts: fonts })
      };
    },

    // Generic object with name + some color fields
    _fromGeneric: function (raw) {
      var colors = {};
      Object.keys(raw).forEach(function (k) {
        if (k === 'name' || k === 'id' || k === 'author' || k === 'version' || k === 'base') return;
        var token = matchColorKey(k);
        if (token && isColorVal(raw[k])) colors[token] = raw[k];
        else if (raw[k] && typeof raw[k] === 'object') {
          // nested like {colors:{...}}
          if (k === 'colors' || k === 'color' || k === 'palette') {
            Object.keys(raw[k]).forEach(function (ck) {
              var ct = matchColorKey(ck);
              if (ct && isColorVal(raw[k][ck])) colors[ct] = raw[k][ck];
            });
          }
        }
      });
      return {
        __format: 'smartkiosk',
        id: raw.id || ('theme-' + Date.now()),
        name: raw.name || raw.theme_name || 'Imported Theme',
        author: raw.author || 'Imported',
        version: raw.version || '1.0',
        base: raw.base || 'light',
        tokens: global.ThemeSchema.normalizeTokens({ colors: colors })
      };
    },

    _isColorObject: function (obj) {
      var keys = Object.keys(obj);
      if (!keys.length) return false;
      var colorCount = 0;
      for (var i = 0; i < keys.length; i++) {
        if (isColorVal(obj[keys[i]])) colorCount++;
      }
      return colorCount >= 2 && colorCount >= keys.length * 0.5;
    },

    _fromColorObject: function (obj) {
      var colors = {};
      Object.keys(obj).forEach(function (k) {
        var token = matchColorKey(k);
        if (token && isColorVal(obj[k])) colors[token] = obj[k];
      });
      if (!Object.keys(colors).length) {
        // try to map by position/order
        var schemaOrder = ['primary', 'secondary', 'background', 'surface', 'text', 'textMuted', 'textSubtle', 'border'];
        var vals = Object.keys(obj).filter(function (k) { return isColorVal(obj[k]); });
        vals.slice(0, schemaOrder.length).forEach(function (k, i) { colors[schemaOrder[i]] = obj[k]; });
      }
      return {
        __format: 'smartkiosk',
        id: 'colors-' + Date.now(),
        name: 'Imported Colors',
        author: 'Imported',
        version: '1.0',
        base: 'light',
        tokens: global.ThemeSchema.normalizeTokens({ colors: colors })
      };
    },

    _isCSSVarObject: function (obj) {
      var keys = Object.keys(obj);
      return keys.some(function (k) { return k.indexOf('--') === 0; });
    },

    _fromCSSVars: function (obj) {
      var colors = {};
      Object.keys(obj).forEach(function (k) {
        if (k.indexOf('--') !== 0) return;
        var name = k.replace(/^--/, '').replace(/[-_]/g, '');
        var token = matchColorKey(name);
        if (token && isColorVal(obj[k])) colors[token] = obj[k];
      });
      return {
        __format: 'smartkiosk',
        id: 'cssvars-' + Date.now(),
        name: 'Imported CSS Vars',
        author: 'Imported',
        version: '1.0',
        base: 'light',
        tokens: global.ThemeSchema.normalizeTokens({ colors: colors })
      };
    },

    _scanAny: function (obj, depth) {
      depth = depth || 0;
      if (depth > 4 || !obj || typeof obj !== 'object') return null;
      var colors = {};
      var walk = function (node) {
        if (!node || typeof node !== 'object') return;
        Object.keys(node).forEach(function (k) {
          if (isColorVal(node[k])) {
            var token = matchColorKey(k);
            if (token && !colors[token]) colors[token] = node[k];
          } else if (node[k] && typeof node[k] === 'object') {
            walk(node[k]);
          }
        });
      };
      walk(obj);
      if (!Object.keys(colors).length) return null;
      return {
        __format: 'smartkiosk',
        id: 'scanned-' + Date.now(),
        name: 'Scanned Theme',
        author: 'Imported',
        version: '1.0',
        base: 'light',
        tokens: global.ThemeSchema.normalizeTokens({ colors: colors })
      };
    }
  };

  global.ThemeImporter = Importer;
})(window);
