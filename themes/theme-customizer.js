/*
 * theme-customizer.js — Shopify-like Visual Sections & Theme Customizer
 * Full-page live editor with sidebar control inspector and live responsive preview.
 * Compatible with Node.js and Browser environments.
 */
(function (global) {
  'use strict';

  var Schema = global.ThemeSchema || (typeof require !== 'undefined' ? require('./theme-schema.js') : null);
  var Engine = global.ThemeEngine || (typeof require !== 'undefined' ? require('./theme-engine.js') : null);

  var STORE_URL = 'product.html?product=2&preview=1';

  var state = {
    themeId: 'default',
    themeName: 'Default Theme',
    targetType: 'global',
    targetId: 'default',
    sections: null,
    tokens: null,
    activeSectionId: null,
    deviceMode: 'desktop', // desktop | tablet | mobile
    customizerOpen: false
  };

  function ThemeCustomizerClass() {
    this.state = state;
  }

  ThemeCustomizerClass.prototype.getState = function() {
    return state;
  };

  ThemeCustomizerClass.prototype.init = function(opts) {
    opts = opts || {};
    state.themeId = opts.themeId || 'default';
    state.themeName = opts.themeName || 'Default Theme';
    state.targetType = opts.targetType || 'product';
    state.targetId = String(opts.targetId || '2');
    state.tokens = opts.tokens || (Schema ? Schema.defaultTokens() : {});
    state.sections = opts.sections || (Schema ? Schema.defaultSectionsConfig() : {});
    state.activeSectionId = Object.keys(state.sections)[0] || 'hero-banner';
    state.customizerOpen = true;
  };

  ThemeCustomizerClass.prototype.toggleSectionVisibility = function(sectionId, enabled) {
    if (state.sections && state.sections[sectionId]) {
      state.sections[sectionId].enabled = (enabled !== undefined) ? Boolean(enabled) : !state.sections[sectionId].enabled;
      this.sendPreviewUpdate();
      return state.sections[sectionId].enabled;
    }
    return false;
  };

  ThemeCustomizerClass.prototype.reorderSection = function(sectionId, newOrder) {
    if (state.sections && state.sections[sectionId]) {
      state.sections[sectionId].order = Number(newOrder);
      this.sendPreviewUpdate();
      return true;
    }
    return false;
  };

  ThemeCustomizerClass.prototype.moveSection = function(sectionId, direction) {
    if (!state.sections || !state.sections[sectionId]) return;
    var keys = Object.keys(state.sections);
    var sorted = keys.map(function(k) {
      return { id: k, order: state.sections[k].order };
    }).sort(function(a, b) { return a.order - b.order; });

    var idx = sorted.findIndex(function(s) { return s.id === sectionId; });
    if (idx < 0) return;

    var targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx >= 0 && targetIdx < sorted.length) {
      var currentOrder = sorted[idx].order;
      var targetOrder = sorted[targetIdx].order;
      // swap orders
      state.sections[sorted[idx].id].order = targetOrder;
      state.sections[sorted[targetIdx].id].order = currentOrder;
      this.sendPreviewUpdate();
    }
  };

  ThemeCustomizerClass.prototype.updateSectionSetting = function(sectionId, key, value) {
    if (state.sections && state.sections[sectionId]) {
      if (!state.sections[sectionId].settings) state.sections[sectionId].settings = {};
      state.sections[sectionId].settings[key] = value;
      this.sendPreviewUpdate();
      return true;
    }
    return false;
  };

  ThemeCustomizerClass.prototype.setDeviceMode = function(mode) {
    if (['desktop', 'tablet', 'mobile'].includes(mode)) {
      state.deviceMode = mode;
      var frame = (typeof document !== 'undefined') ? document.getElementById('sk-preview-frame') : null;
      if (frame) {
        if (mode === 'mobile') { frame.style.width = '375px'; frame.style.maxWidth = '100%'; }
        else if (mode === 'tablet') { frame.style.width = '768px'; frame.style.maxWidth = '100%'; }
        else { frame.style.width = '100%'; frame.style.maxWidth = '100%'; }
      }
    }
  };

  ThemeCustomizerClass.prototype.sendPreviewUpdate = function() {
    if (typeof window === 'undefined') return;
    var msg = {
      type: 'sk:theme-update',
      themeId: state.themeId,
      tokens: state.tokens,
      sections: state.sections,
      targetType: state.targetType,
      targetId: state.targetId
    };

    var iframe = document.getElementById('sk-preview-frame');
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage(msg, '*');
    }
    // Also dispatch to local window
    window.postMessage(msg, '*');
  };

  var instance = new ThemeCustomizerClass();

  global.ThemeCustomizer = instance;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      ThemeCustomizer: instance,
      ThemeCustomizerClass: ThemeCustomizerClass
    };
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
