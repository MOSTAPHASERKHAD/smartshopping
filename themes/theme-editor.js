/*
 * theme-editor.js — Admin Theme Editor logic
 * Bound to admin.html. Handles: list, import, edit, preview, save, delete, set-default, export.
 * Depends on: theme-engine.js, theme-schema.js, theme-importer.js, default-themes.js
 * Uses globals from admin.html: apiGet, apiPost, toast
 */
(function (global) {
  'use strict';

  var Schema = global.ThemeSchema;
  var Engine = global.ThemeEngine;

  var editorState = {
    current: null,
    isNew: true,
    draft: null
  };

  // ── Helper: escape HTML ──
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── Load themes list into admin ──
  function loadThemesAdmin() {
    var listEl = document.getElementById('themes-list');
    if (!listEl) return;
    listEl.innerHTML = '<tr><td colspan="5" class="loading"><div class="spinner"></div></td></tr>';
    var localThemes = Engine.list() || [];
    global.apiGet('admin_list_themes', {}, function (data) {
      var serverMap = {};
      var serverThemes = (data && !data.error && data.themes) ? data.themes : [];
      serverThemes.forEach(function (t) { serverMap[t.id] = t; });
      serverThemes.forEach(function (t) {
        try { Engine.register({ id: t.id, name: t.name, author: t.author, version: t.version, base: t.base, tokens: t.tokens }, { silent: true }); }
        catch (e) {}
      });
      var allMap = {};
      var merged = [];
      serverThemes.forEach(function (t) {
        allMap[t.id] = true;
        merged.push(t);
      });
      localThemes.forEach(function (t) {
        if (!allMap[t.id]) {
          allMap[t.id] = true;
          merged.push({ id: t.id, name: t.name, author: t.author || 'Built-in', version: t.version || '1.0', base: t.base || 'light', tokens: t.tokens, is_default: true });
        }
      });
      if (!merged.length) {
        listEl.innerHTML = '<tr><td colspan="5" class="empty">لا توجد ثيمات</td></tr>';
        return;
      }
      listEl.innerHTML = merged.map(function (t) {
        var isLocal = !serverMap[t.id];
        var badge = isLocal ? '<span class="badge badge-pending">مدمج</span>' : (t.is_default ? '<span class="badge badge-confirmed">افتراضي</span>' : '');
        return '<tr>' +
          '<td><strong>' + esc(t.name) + '</strong><br><small style="color:#999">' + esc(t.author || '') + '</small></td>' +
          '<td>' + (t.base === 'dark' ? 'داكن' : 'فاتح') + '</td>' +
          '<td>' + (t.id || '') + '</td>' +
          '<td>' + badge + '</td>' +
          '<td style="white-space:nowrap">' +
            '<button class="btn btn-info btn-xs" onclick="ThemeEditor.editTheme(\'' + t.id + '\')">تحرير</button> ' +
            '<button class="btn btn-outline btn-xs" onclick="ThemeEditor.previewTheme(\'' + t.id + '\')">معاينة</button> ' +
            '<button class="btn btn-outline btn-xs" onclick="ThemeCustomizer.open(\'' + t.id + '\')" style="background:#6366f1;color:#fff;border-color:#6366f1">🎨 تخصيص</button> ' +
            (isLocal ? '' : (t.is_default ? '' : '<button class="btn btn-success btn-xs" onclick="ThemeEditor.setDefault(\'' + t.id + '\')">تعيين افتراضي</button> ')) +
            (isLocal ? '' : '<button class="btn btn-danger btn-xs" onclick="ThemeEditor.deleteTheme(\'' + t.id + '\')">حذف</button>') +
          '</td>' +
        '</tr>';
      }).join('');
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
    setVal('te_name', d.name);
    setVal('te_author', d.author);
    setVal('te_version', d.version);
    setVal('te_id', d.id);
    setVal('te_base', d.base);

    var colorHtml = Schema.COLOR_TOKENS.map(function (c) {
      var val = (d.tokens.colors[c.key] || c.def);
      return '<div class="te-color-row">' +
        '<label>' + c.label + '</label>' +
        '<div class="te-color-controls">' +
          '<input type="color" value="' + toHex(val) + '" oninput="ThemeEditor.updateColor(\'' + c.key + '\',this.value)" onchange="ThemeEditor.updateColor(\'' + c.key + '\',this.value)">' +
          '<input type="text" class="te-hex" value="' + esc(val) + '" oninput="ThemeEditor.updateColorText(\'' + c.key + '\',this.value)" id="te-hex-' + c.key + '">' +
          '<small style="color:#999">' + c.desc + '</small>' +
        '</div>' +
      '</div>';
    }).join('');
    var colorWrap = document.getElementById('te-colors');
    if (colorWrap) colorWrap.innerHTML = colorHtml;

    var fontHtml = Schema.FONT_TOKENS.map(function (f) {
      var opts = Schema.FONT_OPTIONS.map(function (o) {
        return '<option value="' + esc(o.value) + '"' + (o.value === d.tokens.fonts[f.key] ? ' selected' : '') + '>' + o.label + '</option>';
      }).join('');
      return '<div class="te-field"><label>' + f.label + '</label><select onchange="ThemeEditor.updateFont(\'' + f.key + '\',this.value)">' + opts + '</select></div>';
    }).join('');
    var fontWrap = document.getElementById('te-fonts');
    if (fontWrap) fontWrap.innerHTML = fontHtml;

    var radiusHtml = Schema.RADIUS_TOKENS.map(function (r) {
      var v = parseInt((d.tokens.radius[r.key] || r.def)) || 0;
      return '<div class="te-field"><label>زوايا ' + r.key + '</label>' +
        '<input type="range" min="0" max="32" value="' + v + '" oninput="ThemeEditor.updateRadius(\'' + r.key + '\',this.value)"> ' +
        '<span id="te-radius-' + r.key + '">' + (d.tokens.radius[r.key] || r.def) + '</span></div>';
    }).join('');
    var radiusWrap = document.getElementById('te-radius');
    if (radiusWrap) radiusWrap.innerHTML = radiusHtml;

    var compHtml = Schema.COMPONENT_TOKENS.map(function (comp) {
      var rows = comp.props.map(function (p) {
        return '<div class="te-field"><label>' + comp.label + ' — ' + p.label + '</label>' +
          '<input type="text" value="' + esc(d.tokens.components[comp.key][p.key] || p.def) + '" oninput="ThemeEditor.updateComponent(\'' + comp.key + '\',\'' + p.key + '\',this.value)"></div>';
      }).join('');
      return rows;
    }).join('');
    var compWrap = document.getElementById('te-components');
    if (compWrap) compWrap.innerHTML = compHtml;

    // images
    if (!d.tokens.images) d.tokens.images = {};
    var imgHtml = Schema.IMAGE_TOKENS.map(function (img) {
      var val = d.tokens.images[img.key] || img.def;
      return '<div class="te-field"><label>' + img.label + '</label>' +
        '<input type="text" value="' + esc(val) + '" oninput="ThemeEditor.updateImage(\'' + img.key + '\',this.value)"' +
        (img.desc ? ' title="' + esc(img.desc) + '"' : '') + '></div>';
    }).join('');
    var imgWrap = document.getElementById('te-images');
    if (imgWrap) imgWrap.innerHTML = imgHtml;

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
  function updateImage(key, val) {
    if (!editorState.draft.tokens.images) editorState.draft.tokens.images = {};
    editorState.draft.tokens.images[key] = val;
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

  function livePreview() {
    Engine.register(editorState.draft, { silent: true });
    Engine.apply(editorState.draft.id, Engine.mode);
  }

  function previewTheme(id) {
    Engine.apply(id, Engine.mode);
    global.toast('معاينة: ' + (Engine.get(id) ? Engine.get(id).name : id), true);
  }

  // ── Save ──
  function saveTheme() {
    var d = editorState.draft;
    d.name = (document.getElementById('te_name') || {}).value || d.name;
    d.author = (document.getElementById('te_author') || {}).value || d.author;
    d.version = (document.getElementById('te_version') || {}).value || d.version;
    d.id = (document.getElementById('te_id') || {}).value || d.id;
    d.base = (document.getElementById('te_base') || {}).value || d.base;
    if (!d.id) { global.toast('❌ أدخل معرّف الثيم', true); return; }
    var payload = {
      id: d.id, name: d.name, author: d.author, version: d.version,
      base: d.base,
      theme_json: JSON.stringify({
        colors: d.tokens.colors, fonts: d.tokens.fonts,
        spacing: d.tokens.spacing, radius: d.tokens.radius,
        shadow: d.tokens.shadow, components: d.tokens.components,
        images: d.tokens.images || {}
      })
    };
    global.apiGet('admin_save_theme', payload, function (res) {
      if (res && res.error) { global.toast('❌ ' + res.error, true); return; }
      global.toast('✅ تم حفظ الثيم', true);
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
        editorState.isNew = true;
        editorState.current = null;
        editorState.draft = theme;
        renderEditor();
        openEditorModal();
        global.toast('تم استيراد الثيم: ' + theme.name + ' — راجع الألوان ثم احفظه', true);
      } catch (err) {
        global.toast('❌ فشل الاستيراد: ' + err.message, true);
      }
    };
    reader.readAsText(file);
    input.value = '';
  }

  // ── Set default ──
  function setDefault(id) {
    global.apiGet('admin_set_default_theme', { id: id }, function (res) {
      if (res && res.error) { global.toast('❌ ' + res.error, true); return; }
      global.toast('✅ تم التعيين كثيم افتراضي', true);
      loadThemesAdmin();
    });
  }

  // ── Delete ──
  function deleteTheme(id) {
    if (!id) { global.toast('❌ لا يوجد معرّف الثيم', true); return; }
    if (!confirm('حذف الثيم "' + id + '"؟')) return;
    global.apiGet('admin_delete_theme', { id: id }, function (res) {
      if (res && res.error) { global.toast('❌ ' + res.error, true); return; }
      global.toast('✅ تم الحذف', true);
      loadThemesAdmin();
    });
  }

  // ── Export ──
  function exportTheme(id) {
    if (!id) id = editorState.draft ? editorState.draft.id : null;
    if (!id) return;
    if (Engine.get(id)) Engine.exportTheme(id);
    else if (editorState.draft) {
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
    updateImage: updateImage,
    livePreview: livePreview
  };
})(window);
