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

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

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

  ThemeCustomizerClass.prototype.open = function(themeId, targetType, targetId) {
    var self = this;
    targetType = targetType || 'product';
    targetId = targetId || '2';
    themeId = themeId || (Engine && Engine.getActiveThemeId ? Engine.getActiveThemeId() : 'default');

    if (global.apiGet) {
      global.apiGet('admin_get_theme', { id: themeId }, function(res) {
        var theme = (res && res.theme) ? res.theme : (Engine && Engine.get ? Engine.get(themeId) : null);
        var sections = (theme && theme.sections && Object.keys(theme.sections).length) ? theme.sections : (Schema ? Schema.defaultSectionsConfig() : {});
        var tokens = (theme && theme.tokens) ? theme.tokens : (Schema ? Schema.defaultTokens() : {});
        self.init({
          themeId: themeId,
          themeName: (theme && (theme.title || theme.name)) || themeId,
          targetType: targetType,
          targetId: targetId,
          tokens: tokens,
          sections: sections
        });
        self.renderUI();
      });
    } else {
      var theme = (Engine && Engine.get) ? Engine.get(themeId) : null;
      var sections = (theme && theme.sections && Object.keys(theme.sections).length) ? theme.sections : (Schema ? Schema.defaultSectionsConfig() : {});
      var tokens = (theme && theme.tokens) ? theme.tokens : (Schema ? Schema.defaultTokens() : {});
      self.init({
        themeId: themeId,
        themeName: (theme && (theme.title || theme.name)) || themeId,
        targetType: targetType,
        targetId: targetId,
        tokens: tokens,
        sections: sections
      });
      self.renderUI();
    }
  };

  ThemeCustomizerClass.prototype.autoOpen = function() {
    if (typeof window === 'undefined') return;
    try {
      var params = new URLSearchParams(window.location.search);
      var customTheme = params.get('customize_theme');
      if (customTheme) {
        this.open(customTheme);
      }
    } catch(e) {}
  };

  ThemeCustomizerClass.prototype.close = function() {
    state.customizerOpen = false;
    if (typeof document !== 'undefined') {
      var modal = document.getElementById('sk-customizer-modal');
      if (modal) modal.style.display = 'none';
    }
    if (global.ThemeEditor && global.ThemeEditor.load) {
      global.ThemeEditor.load();
    }
  };

  ThemeCustomizerClass.prototype.toggleSectionVisibility = function(sectionId, enabled) {
    if (state.sections && state.sections[sectionId]) {
      state.sections[sectionId].enabled = (enabled !== undefined) ? Boolean(enabled) : !state.sections[sectionId].enabled;
      this.sendPreviewUpdate();
      this.refreshSectionsList();
      return state.sections[sectionId].enabled;
    }
    return false;
  };

  ThemeCustomizerClass.prototype.reorderSection = function(sectionId, newOrder) {
    if (state.sections && state.sections[sectionId]) {
      state.sections[sectionId].order = Number(newOrder);
      this.sendPreviewUpdate();
      this.refreshSectionsList();
      return true;
    }
    return false;
  };

  ThemeCustomizerClass.prototype.moveSection = function(sectionId, direction) {
    if (!state.sections || !state.sections[sectionId]) return;
    var keys = Object.keys(state.sections);
    var sorted = keys.map(function(k) {
      return { id: k, order: state.sections[k].order || 0 };
    }).sort(function(a, b) { return a.order - b.order; });

    var idx = sorted.findIndex(function(s) { return s.id === sectionId; });
    if (idx < 0) return;

    var targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx >= 0 && targetIdx < sorted.length) {
      var currentOrder = sorted[idx].order;
      var targetOrder = sorted[targetIdx].order;
      state.sections[sorted[idx].id].order = targetOrder;
      state.sections[sorted[targetIdx].id].order = currentOrder;
      this.sendPreviewUpdate();
      this.refreshSectionsList();
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
      if (typeof document !== 'undefined') {
        var frame = document.getElementById('sk-preview-frame');
        if (frame) {
          if (mode === 'mobile') { frame.style.width = '375px'; }
          else if (mode === 'tablet') { frame.style.width = '768px'; }
          else { frame.style.width = '100%'; }
        }
        var btns = document.querySelectorAll('.sk-dev-btn');
        if (btns) {
          btns.forEach(function(b) {
            b.classList.toggle('active', b.dataset.mode === mode);
          });
        }
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

    if (typeof document !== 'undefined') {
      var iframe = document.getElementById('sk-preview-frame');
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage(msg, '*');
      }
    }
    if (typeof window.postMessage === 'function') {
      window.postMessage(msg, '*');
    }
  };

  ThemeCustomizerClass.prototype.save = function() {
    if (!global.apiPost) {
      if (global.toast) global.toast('✅ تم حفظ التعديلات محلياً', true);
      return;
    }
    if (global.toast) global.toast('⏳ جاري حفظ وتطبيق تخصيصات الثيم...', false);
    global.apiPost('admin_save_theme_sections', {
      theme_id: state.themeId,
      target_type: state.targetType,
      target_id: state.targetId,
      sections: state.sections
    }, function(res) {
      if (res && res.error) {
        if (global.toast) global.toast('❌ ' + res.error, true);
        return;
      }
      if (global.toast) global.toast('✅ تم حفظ وتطبيق تخصيصات الثيم بنجاح!', true);
    });
  };

  ThemeCustomizerClass.prototype.renderUI = function() {
    if (typeof document === 'undefined') return;
    var modal = document.getElementById('sk-customizer-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'sk-customizer-modal';
      modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;background:#0f172a;display:flex;flex-direction:column;font-family:system-ui,-apple-system,sans-serif;color:#f8fafc;direction:rtl;';
      document.body.appendChild(modal);
    }

    var html = '';
    // Top Bar
    html += '<div style="height:60px;background:#1e293b;border-bottom:1px solid #334155;display:flex;align-items:center;justify-content:space-between;padding:0 20px;">';
    html += '<div style="display:flex;align-items:center;gap:12px;">';
    html += '<span style="font-size:1.4rem;">🎨</span>';
    html += '<span style="font-weight:700;font-size:1.1rem;">محرر الثيم: ' + esc(state.themeName) + '</span>';
    html += '<span style="font-size:0.8rem;background:#3b82f6;color:#fff;padding:2px 8px;border-radius:12px;">مباشر</span>';
    html += '</div>';

    // Device Switcher
    html += '<div style="display:flex;align-items:center;gap:6px;background:#0f172a;padding:4px;border-radius:8px;border:1px solid #334155;">';
    html += '<button type="button" class="sk-dev-btn active" data-mode="desktop" onclick="ThemeCustomizer.setDeviceMode(\'desktop\')" style="background:#334155;color:#fff;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:0.85rem;">💻 كمبيوتر</button>';
    html += '<button type="button" class="sk-dev-btn" data-mode="tablet" onclick="ThemeCustomizer.setDeviceMode(\'tablet\')" style="background:transparent;color:#94a3b8;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:0.85rem;">📱 تابلت</button>';
    html += '<button type="button" class="sk-dev-btn" data-mode="mobile" onclick="ThemeCustomizer.setDeviceMode(\'mobile\')" style="background:transparent;color:#94a3b8;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:0.85rem;">📱 جوال</button>';
    html += '</div>';

    // Action Buttons
    html += '<div style="display:flex;align-items:center;gap:10px;">';
    html += '<button type="button" onclick="ThemeCustomizer.save()" style="background:#10b981;color:#fff;border:none;padding:8px 18px;border-radius:8px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px;">💾 حفظ التعديلات</button>';
    html += '<button type="button" onclick="ThemeCustomizer.close()" style="background:transparent;color:#94a3b8;border:1px solid #475569;padding:8px 14px;border-radius:8px;cursor:pointer;">✕ إغلاق</button>';
    html += '</div>';
    html += '</div>';

    // Workspace
    html += '<div style="flex:1;display:flex;overflow:hidden;">';
    // Sidebar
    html += '<div id="sk-customizer-sidebar" style="width:380px;background:#1e293b;border-left:1px solid #334155;overflow-y:auto;padding:16px;">';
    html += '<div style="font-weight:700;margin-bottom:12px;color:#94a3b8;font-size:0.85rem;text-transform:uppercase;">أقسام صفحة المنتج والهبوط:</div>';
    html += '<div id="sk-sections-list-container"></div>';
    html += '</div>';

    // Preview
    html += '<div style="flex:1;background:#0f172a;display:flex;align-items:center;justify-content:center;padding:16px;overflow:hidden;">';
    html += '<iframe id="sk-preview-frame" src="' + STORE_URL + '" style="width:100%;height:100%;border:none;border-radius:12px;background:#fff;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);transition:width 0.3s ease;"></iframe>';
    html += '</div>';

    html += '</div>';

    modal.innerHTML = html;
    modal.style.display = 'flex';

    this.refreshSectionsList();
    this.sendPreviewUpdate();
  };

  ThemeCustomizerClass.prototype.refreshSectionsList = function() {
    if (typeof document === 'undefined') return;
    var container = document.getElementById('sk-sections-list-container');
    if (!container || !state.sections) return;

    var secKeys = Object.keys(state.sections);
    var sorted = secKeys.map(function(k) {
      return { id: k, data: state.sections[k] };
    }).sort(function(a, b) { return (a.data.order || 0) - (b.data.order || 0); });

    var html = '';
    sorted.forEach(function(item) {
      var sid = item.id;
      var sec = item.data;
      var isVisible = (sec.enabled !== false);
      var isSelected = (state.activeSectionId === sid);
      var secName = sec.name || sid;
      var secIcon = sec.icon || '📄';

      html += '<div style="background:#0f172a;border:1px solid ' + (isSelected ? '#3b82f6' : '#334155') + ';border-radius:10px;margin-bottom:10px;overflow:hidden;">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px;cursor:pointer;" onclick="ThemeCustomizer.selectSection(\'' + esc(sid) + '\')">';
      html += '<div style="display:flex;align-items:center;gap:8px;">';
      html += '<span>' + esc(secIcon) + '</span>';
      html += '<span style="font-weight:600;font-size:0.92rem;color:' + (isVisible ? '#f8fafc' : '#64748b') + '">' + esc(secName) + '</span>';
      html += '</div>';

      html += '<div style="display:flex;align-items:center;gap:6px;" onclick="event.stopPropagation()">';
      html += '<button type="button" onclick="ThemeCustomizer.moveSection(\'' + esc(sid) + '\', \'up\')" style="background:transparent;color:#94a3b8;border:none;cursor:pointer;padding:4px;" title="تحريك لأعلى">▲</button>';
      html += '<button type="button" onclick="ThemeCustomizer.moveSection(\'' + esc(sid) + '\', \'down\')" style="background:transparent;color:#94a3b8;border:none;cursor:pointer;padding:4px;" title="تحريك لأسفل">▼</button>';
      html += '<button type="button" onclick="ThemeCustomizer.toggleSectionVisibility(\'' + esc(sid) + '\')" style="background:transparent;border:none;cursor:pointer;padding:4px;font-size:1.1rem;" title="إظهار / إخفاء">' + (isVisible ? '👁️' : '🚫') + '</button>';
      html += '</div>';
      html += '</div>';

      if (isSelected && sec.settings) {
        html += '<div style="padding:12px;background:#1e293b;border-top:1px solid #334155;">';
        Object.keys(sec.settings).forEach(function(sKey) {
          var sVal = sec.settings[sKey];
          if (typeof sVal === 'string' || typeof sVal === 'number') {
            html += '<div style="margin-bottom:10px;">';
            html += '<label style="display:block;font-size:0.8rem;color:#94a3b8;margin-bottom:4px;">' + esc(sKey) + '</label>';
            html += '<input type="text" value="' + esc(sVal) + '" oninput="ThemeCustomizer.updateSectionSetting(\'' + esc(sid) + '\', \'' + esc(sKey) + '\', this.value)" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:6px 10px;color:#fff;font-size:0.85rem;box-sizing:border-box;">';
            html += '</div>';
          }
        });
        html += '</div>';
      }
      html += '</div>';
    });

    container.innerHTML = html;
  };

  ThemeCustomizerClass.prototype.selectSection = function(sectionId) {
    state.activeSectionId = (state.activeSectionId === sectionId) ? null : sectionId;
    this.refreshSectionsList();
  };

  var instance = new ThemeCustomizerClass();

  // Forward static methods to instance
  ThemeCustomizerClass.open = function(tId, tType, targetId) { return instance.open(tId, tType, targetId); };
  ThemeCustomizerClass.autoOpen = function() { return instance.autoOpen(); };
  ThemeCustomizerClass.close = function() { return instance.close(); };
  ThemeCustomizerClass.save = function() { return instance.save(); };
  ThemeCustomizerClass.init = function(opts) { return instance.init(opts); };
  ThemeCustomizerClass.getState = function() { return instance.getState(); };
  ThemeCustomizerClass.toggleSectionVisibility = function(sId, e) { return instance.toggleSectionVisibility(sId, e); };
  ThemeCustomizerClass.reorderSection = function(sId, ord) { return instance.reorderSection(sId, ord); };
  ThemeCustomizerClass.moveSection = function(sId, dir) { return instance.moveSection(sId, dir); };
  ThemeCustomizerClass.updateSectionSetting = function(sId, k, v) { return instance.updateSectionSetting(sId, k, v); };
  ThemeCustomizerClass.setDeviceMode = function(m) { return instance.setDeviceMode(m); };
  ThemeCustomizerClass.sendPreviewUpdate = function() { return instance.sendPreviewUpdate(); };
  ThemeCustomizerClass.selectSection = function(sId) { return instance.selectSection(sId); };

  global.ThemeCustomizer = instance;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      ThemeCustomizer: instance,
      ThemeCustomizerClass: ThemeCustomizerClass
    };
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
