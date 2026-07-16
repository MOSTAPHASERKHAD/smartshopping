/*
 * theme-editor.js — Admin Theme Editor logic
 * Bound to admin.html. Handles: list, import, edit, preview, save, delete, set-default, export.
 * Depends on: theme-engine.js, theme-schema.js, theme-importer.js, default-themes.js
 */
(function (global) {
  'use strict';

  var Schema = global.ThemeSchema;
  var Engine = global.ThemeEngine;
  var API_URL = global.API_URL; // set by admin.html

  var editorState = {
    current: null,    // theme being edited
    isNew: true,
    draft: null
  };

  // ── API helpers (delegate to admin's apiGet/apiPost if present) ──
  function apiGet(action, params, cb) {
    if (global.apiGet) { global.apiGet(action, params, cb); return; }
    fallbackJSONP(action, params, cb);
  }
  function apiPost(action, params, cb) {
    if (global.apiPost) { global.apiPost(action, params, function () { cb({ ok: true }); }); return; }
    fallbackJSONP(action, params, cb);
  }
  function fallbackJSONP(action, params, cb) {
    var url = API_URL + '?action=' + action;
    if (params) for (var k in params) url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    var cbName = 'cb_th_' + Date.now() + '_' + Math.floor(Math.random() * 9999);
    url += '&callback=' + cbName;
    var called = false;
    global[cbName] = function (d) {
      if (called) return; called = true; delete global[cbName];
      cb(d);
    };
    var s = document.createElement('script');
    s.src = url;
    s.onerror = function () { if (called) return; called = true; delete global[cbName]; cb({ error: 'Network error' }); };
    document.head.appendChild(s);
    setTimeout(function () { if (!called) { called = true; delete global[cbName]; cb({ error: 'Timeout' }); } }, 15000);
  }

  // ── Load themes list into admin ──
  function loadThemesAdmin() {
    var listEl = document.getElementById('themes-list');
    if (!listEl) return;
    listEl.innerHTML = '<tr><td colspan="5" class="loading"><div class="spinner"></div></td></tr>';
    apiGet('admin_list_themes', {}, function (data) {
      if (!data || data.error) {
        listEl.innerHTML = '<tr><td colspan="5" class="empty">لا توجد ثيمات (سيتم إنشاء الورقة تلقائياً)</td></tr>';
        return;
      }
      var themes = data.themes || [];
      if (!themes.length) {
        listEl.innerHTML = '<tr><td colspan="5" class="empty">لا توجد ثيمات محفوظة بعد</td></tr>';
        return;
      }
      // register into engine for preview
      themes.forEach(function (t) {
        try { Engine.register({ id: t.id, name: t.name, author: t.author, version: t.version, base: t.base, tokens: t.tokens }, { silent: true }); }
        catch (e) {}
      });
      listEl.innerHTML = themes.map(function (t) {
        var badge = t.is_default ? '<span class="badge badge-confirmed">افتراضي</span>' : '';
        return '<tr>' +
          '<td><strong>' + escapeHtmlAdmin(t.name) + '</strong><br><small style="color:#999">' + escapeHtmlAdmin(t.author || '') + '</small></td>' +
          '<td>' + (t.base === 'dark' ? 'داكن' : 'فاتح') + '</td>' +
          '<td>' + (t.id || '') + '</td>' +
          '<td>' + badge + '</td>' +
          '<td style="white-space:nowrap">' +
            '<button class="btn btn-info btn-xs" onclick="ThemeEditor.editTheme(\'' + t.id + '\')">تحرير</button> ' +
            '<button class="btn btn-outline btn-xs" onclick="ThemeEditor.previewTheme(\'' + t.id + '\')">معاينة</button> ' +
            (t.is_default ? '' : '<button class="btn btn-success btn-xs" onclick="ThemeEditor.setDefault(\'' + t.id + '\')">تعيين افتراضي</button> ') +
            '<button class="btn btn-danger btn-xs" onclick="ThemeEditor.deleteTheme(\'' + t.id + '\')">حذف</button>' +
          '</td>' +
        '</tr>';
      }).join('');
    });
  }

  function escapeHtmlAdmin(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── Open editor for a theme (or new) ──
  function editTheme(id) {
    var theme = id ? Engine.get(id) : null;
    editorState.isNew = !theme;
    if (theme) {
      editorState.current = JSON.parse(JSON.stringify(theme));
      editorState.draft = JSON.parse(JSON.stringify(theme));
    } else {
      editorState.current = null;
      editorState.draft = {
        id: 'custom-' + Date.now(),
        name: 'ثيم جديد',
        author: 'Admin',
        version: '1.0',
        base: 'light',
        extends: null,
        tokens: Schema.defaultTokens()
      };
    }
    renderEditor();
    openEditorModal();
  }

  function renderEditor() {
    var d = editorState.draft;
    // header fields
    setVal('te_name', d.name);
    setVal('te_author', d.author);
    setVal('te_version', d.version);
    setVal('te_id', d.id);
    setVal('te_base', d.base);

    // color pickers
    var colorHtml = Schema.COLOR_TOKENS.map(function (c) {
      var val = (d.tokens.colors[c.key] || c.def);
      return '<div class="te-color-row">' +
        '<label>' + c.label + '</label>' +
        '<div class="te-color-controls">' +
          '<input type="color" value="' + toHex(val) + '" oninput="ThemeEditor.updateColor(\'' + c.key + '\',this.value)" onchange="ThemeEditor.updateColor(\'' + c.key + '\',this.value)">' +
          '<input type="text" class="te-hex" value="' + escapeHtmlAdmin(val) + '" oninput="ThemeEditor.updateColorText(\'' + c.key + '\',this.value)" id="te-hex-' + c.key + '">' +
          '<small style="color:#999">' + c.desc + '</small>' +
        '</div>' +
      '</div>';
    }).join('');
    var colorWrap = document.getElementById('te-colors');
    if (colorWrap) colorWrap.innerHTML = colorHtml;

    // fonts
    var fontHtml = Schema.FONT_TOKENS.map(function (f) {
      var opts = Schema.FONT_OPTIONS.map(function (o) {
        return '<option value="' + escapeHtmlAdmin(o.value) + '"' + (o.value === d.tokens.fonts[f.key] ? ' selected' : '') + '>' + o.label + '</option>';
      }).join('');
      return '<div class="te-field"><label>' + f.label + '</label><select onchange="ThemeEditor.updateFont(\'' + f.key + '\',this.value)">' + opts + '</select></div>';
    }).join('');
    var fontWrap = document.getElementById('te-fonts');
    if (fontWrap) fontWrap.innerHTML = fontHtml;

    // radius sliders
    var radiusHtml = Schema.RADIUS_TOKENS.map(function (r) {
      var v = parseInt((d.tokens.radius[r.key] || r.def)) || 0;
      return '<div class="te-field"><label>زوايا ' + r.key + '</label>' +
        '<input type="range" min="0" max="32" value="' + v + '" oninput="ThemeEditor.updateRadius(\'' + r.key + '\',this.value)"> ' +
        '<span id="te-radius-' + r.key + '">' + (d.tokens.radius[r.key] || r.def) + '</span></div>';
    }).join('');
    var radiusWrap = document.getElementById('te-radius');
    if (radiusWrap) radiusWrap.innerHTML = radiusHtml;

    // components
    var compHtml = Schema.COMPONENT_TOKENS.map(function (comp) {
      var rows = comp.props.map(function (p) {
        return '<div class="te-field"><label>' + comp.label + ' — ' + p.label + '</label>' +
          '<input type="text" value="' + escapeHtmlAdmin(d.tokens.components[comp.key][p.key] || p.def) + '" oninput="ThemeEditor.updateComponent(\'' + comp.key + '\',\'' + p.key + '\',this.value)"></div>';
      }).join('');
      return rows;
    }).join('');
    var compWrap = document.getElementById('te-components');
    if (compWrap) compWrap.innerHTML = compHtml;

    // mode toggle
    setVal('te_mode', Engine.mode);
  }

  function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v; }
  function toHex(v) {
    if (/^#[0-9a-f]{6}$/i.test(v || '')) return v;
    if (/^#[0-9a-f]{3}$/i.test(v || '')) {
      return '#' + v.substr(1).split('').map(function (c) { return c + c; }).join('');
    }
    return '#000000';
  }

  // ── Live update handlers ──
  function updateColor(key, val) {
    editorState.draft.tokens.colors[key] = val;
    var hexInput = document.getElementById('te-hex-' + key);
    if (hexInput) hexInput.value = val;
    livePreview();
  }
  function updateColorText(key, val) {
    if (Schema.isColor(val)) {
      editorState.draft.tokens.colors[key] = val;
      livePreview();
    }
  }
  function updateFont(key, val) {
    editorState.draft.tokens.fonts[key] = val;
    // ensure font loaded
    ensureFont(val);
    livePreview();
  }
  function updateRadius(key, val) {
    editorState.draft.tokens.radius[key] = val + 'px';
    var lbl = document.getElementById('te-radius-' + key);
    if (lbl) lbl.textContent = val + 'px';
    livePreview();
  }
  function updateComponent(comp, prop, val) {
    editorState.draft.tokens.components[comp][prop] = val;
    livePreview();
  }

  function ensureFont(val) {
    var m = /'([^']+)'/g;
    var fam;
    while ((fam = m.exec(val)) !== null) {
      var name = fam[1];
      if (['Almarai', 'Cairo', 'Tajawal', 'IBM Plex Sans Arabic', 'El Messiri', 'Amiri', 'Inter', 'Poppins', 'Montserrat', 'Roboto'].indexOf(name) > -1) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=' + name.replace(/ /g, '+') + '&display=swap';
        document.head.appendChild(link);
      }
    }
  }

  // ── Live preview (applies to current page immediately) ──
  function livePreview() {
    Engine.register(editorState.draft, { silent: true });
    Engine.apply(editorState.draft.id, Engine.mode);
  }

  function previewTheme(id) {
    Engine.apply(id, Engine.mode);
    toastAdmin('معاينة: ' + (Engine.get(id) ? Engine.get(id).name : id));
  }

  // ── Save ──
  function saveTheme() {
    var d = editorState.draft;
    d.name = (document.getElementById('te_name') || {}).value || d.name;
    d.author = (document.getElementById('te_author') || {}).value || d.author;
    d.version = (document.getElementById('te_version') || {}).value || d.version;
    d.id = (document.getElementById('te_id') || {}).value || d.id;
    d.base = (document.getElementById('te_base') || {}).value || d.base;
    var payload = {
      id: d.id, name: d.name, author: d.author, version: d.version,
      base: d.base, theme_json: JSON.stringify({ colors: d.tokens.colors, fonts: d.tokens.fonts, spacing: d.tokens.spacing, radius: d.tokens.radius, shadow: d.tokens.shadow, components: d.tokens.components })
    };
    apiPost('admin_save_theme', payload, function (res) {
      if (res && res.error) { toastAdmin('خطأ: ' + res.error); return; }
      toastAdmin('✅ تم حفظ الثيم');
      closeEditorModal();
      loadThemesAdmin();
    });
  }

  // ── Import from file ──
  function importThemeFile(input) {
    var file = input.files && input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var parsed = JSON.parse(e.target.result);
        var theme = Engine.importFile(parsed);
        // detect source format for naming hint
        editorState.isNew = true;
        editorState.current = null;
        editorState.draft = theme;
        renderEditor();
        openEditorModal();
        toastAdmin('تم استيراد الثيم: ' + theme.name + ' — راجع الألوان ثم احفظه');
      } catch (err) {
        toastAdmin('❌ فشل الاستيراد: ' + err.message);
      }
    };
    reader.readAsText(file);
    input.value = '';
  }

  // ── Set default ──
  function setDefault(id) {
    apiPost('admin_set_default_theme', { theme_id: id }, function (res) {
      if (res && res.error) { toastAdmin('خطأ: ' + res.error); return; }
      toastAdmin('✅ تم التعيين كثيم افتراضي');
      loadThemesAdmin();
    });
  }

  // ── Delete ──
  function deleteTheme(id) {
    if (!confirm('حذف الثيم "' + id + '"؟')) return;
    apiPost('admin_delete_theme', { theme_id: id }, function (res) {
      if (res && res.error) { toastAdmin('خطأ: ' + res.error); return; }
      toastAdmin('تم الحذف');
      loadThemesAdmin();
    });
  }

  // ── Export ──
  function exportTheme(id) {
    if (!id) id = editorState.draft ? editorState.draft.id : null;
    if (!id) return;
    if (Engine.get(id)) Engine.exportTheme(id);
    else if (editorState.draft) {
      // export draft directly
      var blob = new Blob([JSON.stringify({ __format: 'smartkiosk', id: editorState.draft.id, name: editorState.draft.name, author: editorState.draft.author, version: editorState.draft.version, base: editorState.draft.base, tokens: editorState.draft.tokens }, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a'); a.href = url; a.download = editorState.draft.id + '.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }
  }

  // ── Modal helpers ──
  function openEditorModal() {
    var m = document.getElementById('themeEditorModal');
    if (m) m.classList.add('open');
  }
  function closeEditorModal() {
    var m = document.getElementById('themeEditorModal');
    if (m) m.classList.remove('open');
  }

  function toastAdmin(msg) {
    if (global.toast) { global.toast(msg); return; }
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 3000);
  }

  global.ThemeEditor = {
    load: loadThemesAdmin,
    editTheme: editTheme,
    importThemeFile: importThemeFile,
    previewTheme: previewTheme,
    setDefault: setDefault,
    deleteTheme: deleteTheme,
    exportTheme: exportTheme,
    saveTheme: saveTheme,
    closeEditor: closeEditorModal,
    updateColor: updateColor,
    updateColorText: updateColorText,
    updateFont: updateFont,
    updateRadius: updateRadius,
    updateComponent: updateComponent,
    livePreview: livePreview
  };
})(window);
