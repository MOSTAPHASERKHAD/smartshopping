/*
 * theme-importer.js — Universal Shopify & Custom Theme Importer / Exporter
 * Accepts Shopify (settings_data.json), native SmartKiosk, Misskey, CSS vars, and JSON theme bundles.
 * Compatible with Node.js and Browser environments.
 */
(function (global) {
  'use strict';

  var Schema = global.ThemeSchema || (typeof require !== 'undefined' ? require('./theme-schema.js') : null);

  var COLOR_ALIASES = {
    primary: ['primary', 'main', 'brand', 'color_primary', 'color_button', 'color_link', 'accent1', 'theme_primary', 'btn_primary'],
    secondary: ['secondary', 'sale', 'color_sale', 'color_secondary', 'accent2', 'highlight', 'theme_secondary', 'badge_bg'],
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
    var tokens = ['primary', 'secondary', 'background', 'surface', 'text', 'muted', 'subtle',
                  'border', 'success', 'warning', 'danger', 'info', 'accent', 'sale', 'brand'];
    for (var i = 0; i < tokens.length; i++) {
      if (k.indexOf(tokens[i]) > -1) return tokens[i] === 'sale' ? 'secondary' : tokens[i];
    }
    return null;
  }

  function isColorVal(v) {
    return Schema ? Schema.isColor(v) : /^(#|rgb|rgba|hsl|hsla|var\()/i.test(String(v || '').trim());
  }

  var Importer = {
    normalize: function (raw) {
      if (!raw || typeof raw !== 'object') throw new Error('ملف الثيم فارغ أو غير صالح');
      if (raw.__format === 'smartkiosk' || raw.tokens) return this._fromNative(raw);
      if (raw.props && typeof raw.props === 'object') return this._fromMisskey(raw);
      if (raw.settings_data || raw.current || raw.config || raw.sections) return this._fromShopify(raw);
      if (raw.theme || raw.theme_name || raw.name) return this._fromGeneric(raw);
      if (this._isColorObject(raw)) return this._fromColorObject(raw);
      if (this._isCSSVarObject(raw)) return this._fromCSSVars(raw);

      var scanned = this._scanAny(raw);
      if (scanned && scanned.tokens.colors && Object.keys(scanned.tokens.colors).length) return scanned;
      throw new Error('تنسيق ثيم غير معروف. يرجى استخدام ملف JSON يحتوي على إعدادات الثيم أو الألوان.');
    },

    _fromNative: function (raw) {
      return {
        __format: 'smartkiosk',
        id: raw.id || ('theme-' + Date.now()),
        name: raw.name || 'Imported Theme',
        title: raw.title || raw.name || 'Imported Theme',
        author: raw.author || 'Imported',
        version: raw.version || '1.0',
        base: raw.base || 'light',
        extends: raw.extends || null,
        tokens: Schema ? Schema.normalizeTokens(raw.tokens || {}) : (raw.tokens || {}),
        sections: raw.sections || (Schema ? Schema.defaultSectionsConfig() : {}),
        presets: raw.presets || []
      };
    },

    _fromShopify: function (raw) {
      var src = raw.current && raw.current.theme ? raw.current.theme
              : raw.settings_data && raw.settings_data.current && raw.settings_data.current.theme
              ? raw.settings_data.current.theme
              : raw.config || raw.settings || raw;

      var colors = {};
      Object.keys(src).forEach(function (k) {
        var token = matchColorKey(k);
        if (token && isColorVal(src[k])) colors[token] = src[k];
      });

      var fonts = {};
      Object.keys(src).forEach(function (k) {
        var lk = k.toLowerCase();
        if (lk.indexOf('font') > -1 && typeof src[k] === 'string' && src[k].length < 120) {
          if (lk.indexOf('heading') > -1 || lk.indexOf('title') > -1) fonts.heading = src[k];
          else if (lk.indexOf('body') > -1 || lk.indexOf('text') > -1) fonts.body = src[k];
        }
      });

      // Extract sections if provided in Shopify sections schema
      var sections = Schema ? Schema.defaultSectionsConfig() : {};
      var rawSections = raw.sections || (raw.current && raw.current.sections) || (raw.settings_data && raw.settings_data.current && raw.settings_data.current.sections);

      if (rawSections && typeof rawSections === 'object') {
        Object.keys(rawSections).forEach(function (secKey, idx) {
          var s = rawSections[secKey];
          var matchedKey = secKey.replace(/_/g, '-');
          if (sections[matchedKey]) {
            if (s.settings && typeof s.settings === 'object') {
              Object.assign(sections[matchedKey].settings, s.settings);
            }
            if (typeof s.disabled === 'boolean') {
              sections[matchedKey].enabled = !s.disabled;
            }
          }
        });
      }

      return {
        __format: 'smartkiosk',
        id: 'shopify-' + Date.now(),
        name: raw.theme_name || raw.name || 'Shopify Imported Theme',
        title: raw.theme_name || raw.name || 'Shopify Theme',
        author: raw.author || 'Shopify / Merchant',
        version: raw.version || '1.0',
        base: 'light',
        tokens: Schema ? Schema.normalizeTokens({ colors: colors, fonts: fonts, sections: sections }) : { colors: colors },
        sections: sections,
        presets: raw.presets || []
      };
    },

    _fromMisskey: function (raw) {
      var colors = {};
      var p = raw.props || {};
      Object.keys(p).forEach(function (k) {
        var token = matchColorKey(k);
        if (token && isColorVal(p[k])) colors[token] = p[k];
      });
      if (p.fg) colors.text = p.fg;
      if (p.bg) colors.background = p.bg;
      if (p.accent) colors.accent = p.accent;

      return {
        __format: 'smartkiosk',
        id: raw.id || ('misskey-' + Date.now()),
        name: raw.name || 'Misskey Theme',
        title: raw.name || 'Misskey Theme',
        author: raw.author || 'Imported',
        version: raw.version || '1.0',
        base: raw.base === 'dark' ? 'dark' : 'light',
        tokens: Schema ? Schema.normalizeTokens({ colors: colors }) : { colors: colors },
        sections: Schema ? Schema.defaultSectionsConfig() : {}
      };
    },

    _fromGeneric: function (raw) {
      var colors = {};
      Object.keys(raw).forEach(function (k) {
        if (['name', 'id', 'author', 'version', 'base'].includes(k)) return;
        var token = matchColorKey(k);
        if (token && isColorVal(raw[k])) colors[token] = raw[k];
      });
      return {
        __format: 'smartkiosk',
        id: raw.id || ('theme-' + Date.now()),
        name: raw.name || raw.theme_name || 'Imported Theme',
        title: raw.title || raw.name || 'Imported Theme',
        author: raw.author || 'Imported',
        version: raw.version || '1.0',
        base: raw.base || 'light',
        tokens: Schema ? Schema.normalizeTokens({ colors: colors }) : { colors: colors },
        sections: Schema ? Schema.defaultSectionsConfig() : {}
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
      return {
        __format: 'smartkiosk',
        id: 'colors-' + Date.now(),
        name: 'Imported Colors',
        title: 'Imported Colors Theme',
        author: 'Imported',
        version: '1.0',
        base: 'light',
        tokens: Schema ? Schema.normalizeTokens({ colors: colors }) : { colors: colors },
        sections: Schema ? Schema.defaultSectionsConfig() : {}
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
        title: 'Imported CSS Theme',
        author: 'Imported',
        version: '1.0',
        base: 'light',
        tokens: Schema ? Schema.normalizeTokens({ colors: colors }) : { colors: colors },
        sections: Schema ? Schema.defaultSectionsConfig() : {}
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
        title: 'Scanned Theme',
        author: 'Imported',
        version: '1.0',
        base: 'light',
        tokens: Schema ? Schema.normalizeTokens({ colors: colors }) : { colors: colors },
        sections: Schema ? Schema.defaultSectionsConfig() : {}
      };
    },

    exportTheme: function (theme) {
      if (!theme) return null;
      return JSON.stringify({
        __format: 'smartkiosk',
        version: theme.version || '1.0.0',
        name: theme.name || 'Exported Theme',
        title: theme.title || theme.name || 'Exported Theme',
        author: theme.author || 'SmartKiosk User',
        base: theme.base || 'light',
        tokens: theme.tokens || {},
        sections: theme.sections || {},
        presets: theme.presets || [],
        exported_at: new Date().toISOString()
      }, null, 2);
    }
  };

  global.ThemeImporter = Importer;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Importer;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
