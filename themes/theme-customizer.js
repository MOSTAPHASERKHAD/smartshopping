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
  var TOGGLEABLE = [
    { id: 'announce', label: 'الشريط العلوي', selector: '#announceSection, .announcement' },
    { id: 'hero', label: 'البانرات', selector: '#heroSlider' },
    { id: 'headerCatBar', label: 'شريط التصنيفات', selector: '#headerCatBar' },
    { id: 'products', label: 'المنتجات', selector: '#products' },
    { id: 'footer', label: 'التذييل', selector: 'footer' },
    { id: 'mobileNav', label: 'القوائم السفلية', selector: '.mobile-nav' }
  ];

  var visibility = {};
  TOGGLEABLE.forEach(function (t) { visibility[t.id] = true; });

  // ── Open customizer ──
  function openCustomizer(themeId) {
    if (!Engine) return;
    var theme = Engine.get(themeId);
    if (!theme) return;
    state.themeId = themeId;
    state.themeName = theme.name;
    state.base = theme.base;
    state.tokens = JSON.parse(JSON.stringify(theme.tokens));
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

  // ── Build the customizer UI and inject it ──
  function showCustomizerUI() {
    var existing = document.getElementById('sk-customizer');
    if (existing) return;
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

    var toggles = TOGGLEABLE.map(function (t) {
      var chk = visibility[t.id] ? 'checked' : '';
      return '<div class="sk-cp-row"><label style="cursor:pointer">' +
        '<input type="checkbox" ' + chk + ' onchange="ThemeCustomizer.toggleElement(\'' + t.id + '\',this.checked)"> ' +
        t.label + '</label></div>';
    }).join('');

    return '<div id="sk-customizer-overlay"></div>' +
      '<div id="sk-customizer-panel" dir="rtl">' +
        '<div class="sk-cp-header">' +
          '<span class="sk-cp-title">🎨 تخصيص: ' + state.themeName + '</span>' +
          '<button class="sk-cp-close" onclick="ThemeCustomizer.close()">✕</button>' +
        '</div>' +
        '<div class="sk-cp-scroll">' +
          '<section><h4>🎯 الألوان</h4>' + colorPickers + '</section>' +
          '<section><h4>📝 الخطوط</h4>' + fontPickers + '</section>' +
          '<section><h4>🔄 الزوايا</h4>' + radiusPickers + '</section>' +
          '<section><h4>👁️ إظهار/إخفاء</h4>' + toggles + '</section>' +
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
      toggleElements: TOGGLEABLE.map(function (t) {
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
    sendPreview();
  }

  // ── Save from customizer ──
  function save() {
    // apply locally first
    Engine.register({ id: state.themeId, name: state.themeName, base: state.base, tokens: state.tokens }, { silent: true });
    Engine.apply(state.themeId, Engine.mode);
    // save to sheet via editor
    if (global.ThemeEditor) {
      var payload = {
        id: state.themeId, name: state.themeName,
        author: 'Admin', version: '1.0',
        base: state.base,
        theme_json: JSON.stringify(state.tokens)
      };
      apiCall('admin_save_theme', payload, function () {
        toastCustom('✅ تم حفظ التخصيص');
      });
    }
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

  function apiCall(action, params, cb) {
    if (global.apiGet) { global.apiGet(action, params, cb); return; }
    cb({ ok: true }); // fallback
  }

  function toastCustom(msg) {
    if (global.toast) { global.toast(msg); return; }
    var el = document.createElement('div');
    el.className = 'toast';
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
    toggleElement: toggleElement,
    save: save,
    exportPreview: exportPreview,
    autoOpen: autoOpen
  };
})(window);
