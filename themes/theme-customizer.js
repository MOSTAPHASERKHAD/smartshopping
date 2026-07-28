/*
 * theme-customizer.js — Shopify-like live theme customizer
 * Full-page editor with iframe preview of the storefront.
 * Launched from admin.html via ?customize=themeId
 */
(function (global) {
  'use strict';

  var Schema = global.ThemeSchema;
  var Engine = global.ThemeEngine;
  var STORE_URL = 'https://mostaphaserkhad.github.io/smartshopping/?preview=1';

  var state = {
    themeId: null,
    themeName: null,
    base: 'light',
    tokens: null,
    customizerOpen: false
  };

  // Elements that can be toggled on/off in preview
  // Now derived dynamically from Schema.SECTION_TOKENS during openCustomizer
  var visibility = {};

  // ── Open customizer ──
  function openCustomizer(themeId) {
    if (!Engine) return;
    var theme = Engine.get(themeId);
    if (!theme) return;
    state.themeId = themeId;
    state.themeName = theme.name;
    state.base = theme.base;
    state.tokens = JSON.parse(JSON.stringify(theme.tokens));
    if (!state.tokens.sections) state.tokens.sections = Schema.defaultTokens().sections;
    if (!state.tokens.icons) state.tokens.icons = Schema.defaultTokens().icons;
    
    // Sync visibility state from the active theme
    state.tokens.sections.forEach(function(s) {
      visibility[s.id] = s.visible;
    });
    
    state.customizerOpen = true;
    showCustomizerUI();
  }

  // ── Close customizer ──
  function closeCustomizer() {
    state.customizerOpen = false;
    hideCustomizerUI();
    // restore original theme
    if (state.themeId) Engine.apply(state.themeId, Engine.mode);
  }

  function showCustomizerUI() {
    var existing = document.getElementById('sk-customizer');
    if (existing) {
      // Re-render panel only
      var wrapper = document.createElement('div');
      wrapper.innerHTML = getHTML();
      var oldPanel = document.getElementById('sk-customizer-panel');
      var newPanel = wrapper.querySelector('#sk-customizer-panel');
      if (oldPanel && newPanel) {
        oldPanel.parentNode.replaceChild(newPanel, oldPanel);
      }
      return;
    }
    var div = document.createElement('div');
    div.id = 'sk-customizer';
    div.innerHTML = getHTML();
    document.body.appendChild(div);

    // Create iframe
    var iframe = document.createElement('iframe');
    iframe.id = 'sk-preview-frame';
    iframe.src = STORE_URL;
    document.getElementById('sk-preview-pane').appendChild(iframe);

    // bind events
    bindControls();
  }

  function hideCustomizerUI() {
    var el = document.getElementById('sk-customizer');
    if (el) el.remove();
  }

  function strAttr(s) { return String(s||'').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  function getHTML() {
    var c = state.tokens.colors;
    var colorPickers = Schema.COLOR_TOKENS.map(function (tk) {
      var val = c[tk.key] || tk.def;
      return '<div class="sk-cp-row">' +
        '<label>' + tk.label + '</label>' +
        '<div class="sk-cp-inputs">' +
          '<input type="color" value="' + toHex(val) + '" data-ck="' + tk.key + '" oninput="ThemeCustomizer.colorChange(\'' + tk.key + '\',this.value)">' +
          '<input type="text" value="' + val + '" data-ck="' + tk.key + '" class="sk-cp-text" oninput="ThemeCustomizer.colorChange(\'' + tk.key + '\',this.value)">' +
        '</div>' +
      '</div>';
    }).join('');

    var fontPickers = Schema.FONT_TOKENS.map(function (tk) {
      var val = state.tokens.fonts[tk.key] || tk.def;
      var opts = Schema.FONT_OPTIONS.map(function (o) {
        var sel = o.value === val ? ' selected' : '';
        return '<option value="' + strAttr(o.value) + '"' + sel + '>' + o.label + '</option>';
      }).join('');
      return '<div class="sk-cp-row"><label>' + tk.label + '</label>' +
        '<select data-fk="' + tk.key + '" onchange="ThemeCustomizer.fontChange(\'' + tk.key + '\',this.value)">' + opts + '</select></div>';
    }).join('');

    var radiusPickers = Schema.RADIUS_TOKENS.map(function (tk) {
      var v = parseInt(state.tokens.radius[tk.key]) || 0;
      return '<div class="sk-cp-row"><label>' + tk.key + '</label>' +
        '<input type="range" min="0" max="32" value="' + v + '" oninput="ThemeCustomizer.radiusChange(\'' + tk.key + '\',this.value)">' +
        ' <span id="sk-rlps-' + tk.key + '">' + v + '</span>px</div>';
    }).join('');

    var toggles = Schema.SECTION_TOKENS.map(function (t) {
      var chk = visibility[t.id] ? 'checked' : '';
      return '<div class="sk-cp-row"><label style="cursor:pointer">' +
        '<input type="checkbox" ' + chk + ' onchange="ThemeCustomizer.toggleElement(\'' + t.id + '\',this.checked)"> ' +
        t.label + '</label></div>';
    }).join('');

    var iconShapes = ['round', 'square', 'triangle'];
    var currentShape = state.tokens.icons.shape || 'round';
    var iconPickers = '<div class="sk-cp-row"><label>شكل الأيقونات</label><select onchange="ThemeCustomizer.iconShapeChange(this.value)">';
    iconShapes.forEach(function(s) {
      iconPickers += '<option value="'+s+'" '+(currentShape===s?'selected':'')+'>'+s+'</option>';
    });
    iconPickers += '</select></div>';

    var themeSelector = '<div class="sk-cp-row" style="margin-bottom:12px"><label style="font-weight:bold;color:var(--accent)">القالب الأساسي</label><select onchange="ThemeCustomizer.switchBaseTheme(this.value)" style="background:#f0f0f0;font-weight:bold">';
    if (Engine) {
      Engine.list().forEach(function(t) {
        var sel = t.id === state.themeId ? 'selected' : '';
        themeSelector += '<option value="' + t.id + '" ' + sel + '>' + t.name + '</option>';
      });
    }
    themeSelector += '</select></div>';

    return '<div id="sk-customizer-overlay"></div>' +
      '<div id="sk-customizer-panel" dir="rtl">' +
        '<div class="sk-cp-header">' +
          '<span class="sk-cp-title">⚙️ إدارة المتجر</span>' +
          '<button class="sk-cp-close" onclick="ThemeCustomizer.close()">✕</button>' +
        '</div>' +
        '<div class="sk-cp-scroll">' +
          '<section>' + themeSelector + '</section>' +
          '<section><h4>🎯 الألوان</h4>' + colorPickers + '</section>' +
          '<section><h4>📝 الخطوط</h4>' + fontPickers + '</section>' +
          '<section><h4>🔄 الزوايا</h4>' + radiusPickers + '</section>' +
          '<section><h4>⚙️ الأيقونات</h4>' + iconPickers + '</section>' +
          '<section><h4>👁️ إظهار/إخفاء الأقسام</h4>' + toggles + '</section>' +
        '</div>' +
        '<div class="sk-cp-footer">' +
          '<button class="btn btn-success btn-sm" onclick="ThemeCustomizer.save()">💾 حفظ</button>' +
          '<button class="btn btn-outline btn-sm" onclick="ThemeCustomizer.exportPreview()">📤 تصدير</button>' +
          '<button class="btn btn-outline btn-sm" onclick="ThemeCustomizer.close()">إغلاق</button>' +
        '</div>' +
      '</div>' +
      '<div id="sk-preview-pane"></div>';
  }

  function bindControls() {
    // Already bound via inline onchange
  }

  // ── Send update to the preview iframe ──
  function sendPreview() {
    var iframe = document.getElementById('sk-preview-frame');
    if (!iframe || !iframe.contentWindow) return;
    var msg = {
      type: 'theme-preview',
      themeId: state.themeId,
      name: state.themeName,
      mode: Engine ? Engine.mode : 'light',
      tokens: state.tokens,
      toggleElements: Schema.SECTION_TOKENS.map(function (t) {
        return { id: t.id, visible: visibility[t.id] };
      })
    };
    iframe.contentWindow.postMessage(msg, '*');
  }

  // ── Control handlers ──
  function colorChange(key, val) {
    if (Schema.isColor(val)) state.tokens.colors[key] = val;
    sendPreview();
  }
  function fontChange(key, val) {
    state.tokens.fonts[key] = val;
    sendPreview();
  }
  function radiusChange(key, val) {
    state.tokens.radius[key] = val + 'px';
    var lbl = document.getElementById('sk-rlps-' + key);
    if (lbl) lbl.textContent = val;
    sendPreview();
  }
  function toggleElement(id, visible) {
    visibility[id] = visible;
    var sec = state.tokens.sections.find(function(s) { return s.id === id; });
    if (sec) sec.visible = visible;
    sendPreview();
  }
  function iconShapeChange(val) {
    state.tokens.icons.shape = val;
    sendPreview();
  }
  function switchBaseTheme(id) {
    var theme = Engine.get(id);
    if (!theme) return;
    state.themeId = theme.id;
    state.themeName = theme.name;
    state.base = theme.base;
    state.tokens = JSON.parse(JSON.stringify(theme.tokens));
    if (!state.tokens.sections) state.tokens.sections = Schema.defaultTokens().sections;
    if (!state.tokens.icons) state.tokens.icons = Schema.defaultTokens().icons;
    state.tokens.sections.forEach(function(s) { visibility[s.id] = s.visible; });
    showCustomizerUI();
    sendPreview();
  }

  // ── Save from customizer ──
  function save() {
    Engine.register({ id: state.themeId, name: state.themeName, base: state.base, tokens: state.tokens }, { silent: true });
    Engine.apply(state.themeId, Engine.mode);
    if (!global.apiGet) { toastCustom('❌ السيرفر غير متاح'); return; }
    var payload = {
      id: state.themeId, name: state.themeName,
      author: 'Admin', version: '1.0',
      base: state.base,
      theme_json: JSON.stringify(state.tokens)
    };
    global.apiGet('admin_save_theme', payload, function (res) {
      if (res && res.error) { toastCustom('❌ ' + res.error); return; }
      toastCustom('✅ تم حفظ التخصيص');
      if (global.ThemeEditor && global.ThemeEditor.load) global.ThemeEditor.load();
    });
  }

  function exportPreview() {
    var out = {
      __format: 'smartkiosk',
      id: state.themeId + '-custom',
      name: state.themeName + ' (Custom)',
      author: 'Admin',
      version: '1.0',
      base: state.base,
      tokens: state.tokens
    };
    var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = state.themeId + '-custom.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function toastCustom(msg) {
    var el = document.createElement('div');
    el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);padding:12px 24px;border-radius:8px;font-weight:700;font-size:.85rem;z-index:9999;background:#1a1a2e;color:#fff;box-shadow:0 4px 20px rgba(0,0,0,.3);';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 3000);
  }

  function toHex(v) {
    if (/^#[0-9a-f]{6}$/i.test(v || '')) return v;
    if (/^#[0-9a-f]{3}$/i.test(v || '')) return '#' + v.substr(1).split('').map(function (c) { return c + c; }).join('');
    return '#000000';
  }

  // ── If page loaded with ?customize=themeId param, auto-open ──
  function autoOpen() {
    var m = location.search.match(/customize=([^&]+)/);
    if (m && m[1]) {
      // wait for engine & themes to load
      var check = function () {
        if (Engine && Engine.get(m[1])) { openCustomizer(m[1]); return; }
        setTimeout(check, 300);
      };
      check();
    }
  }

  global.ThemeCustomizer = {
    open: openCustomizer,
    close: closeCustomizer,
    colorChange: colorChange,
    fontChange: fontChange,
    radiusChange: radiusChange,
    iconShapeChange: iconShapeChange,
    toggleElement: toggleElement,
    switchBaseTheme: switchBaseTheme,
    save: save,
    exportPreview: exportPreview,
    autoOpen: autoOpen
  };
})(window);
