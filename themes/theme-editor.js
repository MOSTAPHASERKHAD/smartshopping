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

  // ── Helper: normalize error message ──
  function getThemeErrorMessage(error) {
    if (!error) return 'حدث خطأ غير معروف';
    if (typeof error === 'string') return error;
    if (typeof error === 'object') {
      return error.message || error.code || JSON.stringify(error);
    }
    return String(error);
  }

  // ── Load themes list into admin ──
  function loadThemesAdmin(onError) {
    var listEl = document.getElementById('themes-list');
    if (!listEl) return;
    listEl.innerHTML = '<tr><td colspan="5" class="loading"><div class="spinner"></div></td></tr>';

    var builtins = (typeof global !== 'undefined' && global.SmartKioskThemes) ||
                   (typeof window !== 'undefined' && window.SmartKioskThemes) || [];

    global.apiGet('admin_list_themes', {}, function (data) {
      if (data && data.error) {
        var errStr = getThemeErrorMessage(data.error);
        console.error('Failed to load themes list:', errStr);
        if (typeof onError === 'function') {
          onError(data.error);
        }
        if (builtins.length) {
          listEl.innerHTML = builtins.map(function (t) {
            return '<tr>' +
              '<td><strong>' + esc(t.name) + '</strong><br><small style="color:#999">' + esc(t.author || '') + '</small></td>' +
              '<td>' + (t.base === 'dark' ? 'داكن' : 'فاتح') + '</td>' +
              '<td>' + (t.id || '') + '</td>' +
              '<td><span class="badge badge-pending">مدمج</span></td>' +
              '<td style="white-space:nowrap">' +
                '<button class="btn btn-info btn-xs" onclick="ThemeEditor.editTheme(\'' + t.id + '\')">تحرير</button> ' +
                '<button class="btn btn-outline btn-xs" onclick="ThemeEditor.previewTheme(\'' + t.id + '\')">معاينة</button> ' +
                '<button class="btn btn-outline btn-xs" onclick="ThemeCustomizer.open(\'' + t.id + '\')" style="background:#6366f1;color:#fff;border-color:#6366f1">🎨 تخصيص</button>' +
              '</td>' +
            '</tr>';
          }).join('');
        } else {
          listEl.innerHTML = '<tr><td colspan="5" class="empty">❌ تعذر تحميل الثيمات: ' + esc(errStr) + '</td></tr>';
        }
        return;
      }
      var serverMap = {};
      var serverThemes = (data && data.themes) ? data.themes : [];
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
      builtins.forEach(function (t) {
        if (!allMap[t.id]) {
          allMap[t.id] = true;
          merged.push({ id: t.id, name: t.name, author: t.author || 'Built-in', version: t.version || '1.0', base: t.base || 'light', tokens: t.tokens, is_default: false, is_builtin: true });
        }
      });
      if (!merged.length) {
        listEl.innerHTML = '<tr><td colspan="5" class="empty">لا توجد ثيمات</td></tr>';
        return;
      }
      listEl.innerHTML = merged.map(function (t) {
        var isLocal = !serverMap[t.id];
        var isDefault = Boolean(t.is_default || t.is_active);
        var badge = isLocal ? '<span class="badge badge-pending">مدمج</span>' : (isDefault ? '<span class="badge badge-confirmed">افتراضي</span>' : '');
        return '<tr>' +
          '<td><strong>' + esc(t.name) + '</strong><br><small style="color:#999">' + esc(t.author || '') + '</small></td>' +
          '<td>' + (t.base === 'dark' ? 'داكن' : 'فاتح') + '</td>' +
          '<td>' + (t.id || '') + '</td>' +
          '<td>' + badge + '</td>' +
          '<td style="white-space:nowrap">' +
            '<button class="btn btn-info btn-xs" onclick="ThemeEditor.editTheme(\'' + t.id + '\')">تحرير</button> ' +
            '<button class="btn btn-outline btn-xs" onclick="ThemeEditor.previewTheme(\'' + t.id + '\')">معاينة</button> ' +
            '<button class="btn btn-outline btn-xs" onclick="ThemeCustomizer.open(\'' + t.id + '\')" style="background:#6366f1;color:#fff;border-color:#6366f1">🎨 تخصيص</button> ' +
            (isDefault ? '' : '<button class="btn btn-success btn-xs" onclick="ThemeEditor.setDefault(\'' + t.id + '\')">تعيين افتراضي</button> ') +
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
    if (!d) return;
    if (!d.tokens || typeof d.tokens !== 'object') d.tokens = Schema ? Schema.defaultTokens() : {};
    if (!d.tokens.colors) d.tokens.colors = {};
    if (!d.tokens.fonts) d.tokens.fonts = {};
    if (!d.tokens.radius) d.tokens.radius = {};
    if (!d.tokens.components) d.tokens.components = {};
    if (!d.tokens.images) d.tokens.images = {};

    setVal('te_name', d.name || '');
    setVal('te_author', d.author || '');
    setVal('te_version', d.version || '1.0');
    setVal('te_id', d.id || '');
    setVal('te_base', d.base || 'light');

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
        return '<option value="' + esc(o.value) + '"' + (o.value === (d.tokens.fonts && d.tokens.fonts[f.key]) ? ' selected' : '') + '>' + o.label + '</option>';
      }).join('');
      return '<div class="te-field"><label>' + f.label + '</label><select onchange="ThemeEditor.updateFont(\'' + f.key + '\',this.value)">' + opts + '</select></div>';
    }).join('');
    var fontWrap = document.getElementById('te-fonts');
    if (fontWrap) fontWrap.innerHTML = fontHtml;

    var radiusHtml = Schema.RADIUS_TOKENS.map(function (r) {
      var v = parseInt((d.tokens.radius && d.tokens.radius[r.key]) || r.def) || 0;
      return '<div class="te-field"><label>زوايا ' + r.key + '</label>' +
        '<input type="range" min="0" max="32" value="' + v + '" oninput="ThemeEditor.updateRadius(\'' + r.key + '\',this.value)"> ' +
        '<span id="te-radius-' + r.key + '">' + ((d.tokens.radius && d.tokens.radius[r.key]) || r.def) + '</span></div>';
    }).join('');
    var radiusWrap = document.getElementById('te-radius');
    if (radiusWrap) radiusWrap.innerHTML = radiusHtml;

    var compHtml = Schema.COMPONENT_TOKENS.map(function (comp) {
      if (!d.tokens.components[comp.key]) d.tokens.components[comp.key] = {};
      var rows = comp.props.map(function (p) {
        var compObj = d.tokens.components[comp.key] || {};
        var val = compObj[p.key] != null ? compObj[p.key] : p.def;
        return '<div class="te-field"><label>' + comp.label + ' — ' + p.label + '</label>' +
          '<input type="text" value="' + esc(val) + '" oninput="ThemeEditor.updateComponent(\'' + comp.key + '\',\'' + p.key + '\',this.value)"></div>';
      }).join('');
      return rows;
    }).join('');
    var compWrap = document.getElementById('te-components');
    if (compWrap) compWrap.innerHTML = compHtml;

    // images
    var imgHtml = Schema.IMAGE_TOKENS.map(function (img) {
      var val = (d.tokens.images && d.tokens.images[img.key]) || img.def;
      return '<div class="te-field"><label>' + img.label + '</label>' +
        '<input type="text" value="' + esc(val) + '" oninput="ThemeEditor.updateImage(\'' + img.key + '\',this.value)"' +
        (img.desc ? ' title="' + esc(img.desc) + '"' : '') + '></div>';
    }).join('');
    var imgWrap = document.getElementById('te-images');
    if (imgWrap) imgWrap.innerHTML = imgHtml;

    setVal('te_mode', Engine ? Engine.mode : 'auto');
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
    if (!editorState.draft) return;
    if (!editorState.draft.tokens) editorState.draft.tokens = {};
    if (!editorState.draft.tokens.colors) editorState.draft.tokens.colors = {};
    editorState.draft.tokens.colors[key] = val;
    var hexInput = document.getElementById('te-hex-' + key);
    if (hexInput) hexInput.value = val;
    livePreview();
  }
  function updateColorText(key, val) {
    if (Schema.isColor(val)) {
      if (!editorState.draft) return;
      if (!editorState.draft.tokens) editorState.draft.tokens = {};
      if (!editorState.draft.tokens.colors) editorState.draft.tokens.colors = {};
      editorState.draft.tokens.colors[key] = val;
      livePreview();
    }
  }
  function updateFont(key, val) {
    if (!editorState.draft) return;
    if (!editorState.draft.tokens) editorState.draft.tokens = {};
    if (!editorState.draft.tokens.fonts) editorState.draft.tokens.fonts = {};
    editorState.draft.tokens.fonts[key] = val;
    ensureFont(val);
    livePreview();
  }
  function updateRadius(key, val) {
    if (!editorState.draft) return;
    if (!editorState.draft.tokens) editorState.draft.tokens = {};
    if (!editorState.draft.tokens.radius) editorState.draft.tokens.radius = {};
    editorState.draft.tokens.radius[key] = val + 'px';
    var lbl = document.getElementById('te-radius-' + key);
    if (lbl) lbl.textContent = val + 'px';
    livePreview();
  }
  function updateComponent(comp, prop, val) {
    if (!editorState.draft) return;
    if (!editorState.draft.tokens) editorState.draft.tokens = {};
    if (!editorState.draft.tokens.components) editorState.draft.tokens.components = {};
    if (!editorState.draft.tokens.components[comp]) editorState.draft.tokens.components[comp] = {};
    editorState.draft.tokens.components[comp][prop] = val;
    livePreview();
  }
  function updateImage(key, val) {
    if (!editorState.draft) return;
    if (!editorState.draft.tokens) editorState.draft.tokens = {};
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
    Engine.apply(editorState.draft.id, Engine.mode, true);
  }

  function previewTheme(id) {
    if (!id) return;
    try {
      Engine.apply(id, Engine.mode, true);
    } catch (e) {}
    var targetUrl = 'product.html?preview_theme=' + encodeURIComponent(id);
    if (typeof window !== 'undefined' && window.open) {
      window.open(targetUrl, '_blank');
    }
    if (global.toast) global.toast('معاينة: ' + (Engine.get(id) ? Engine.get(id).name : id), true);
  }

  // ── Save ──
  function saveTheme() {
    var d = editorState.draft;
    if (!d) return;
    var nameInput = document.getElementById('te_name');
    var authorInput = document.getElementById('te_author');
    var versionInput = document.getElementById('te_version');
    var idInput = document.getElementById('te_id');
    var baseInput = document.getElementById('te_base');

    if (nameInput) d.name = nameInput.value || d.name;
    if (authorInput) d.author = authorInput.value || d.author;
    if (versionInput) d.version = versionInput.value || d.version;
    if (idInput) d.id = idInput.value || d.id;
    if (baseInput) d.base = baseInput.value || d.base;

    if (!d.id) { if (global.toast) global.toast('❌ أدخل معرّف الثيم', true); return; }
    if (!d.name) { if (global.toast) global.toast('❌ أدخل اسم الثيم', true); return; }

    var payload = {
      id: d.id,
      name: d.name,
      title: d.title || d.name,
      author: d.author || 'Admin',
      version: d.version || '1.0.0',
      base: d.base || 'light',
      tokens_json: JSON.stringify(d.tokens || {}),
      sections_json: JSON.stringify(d.sections || (global.ThemeSchema ? global.ThemeSchema.defaultSectionsConfig() : {})),
      presets_json: JSON.stringify(d.presets || [])
    };

    if (global.toast) global.toast('⏳ جاري حفظ الثيم...', false);

    global.apiGet('admin_save_theme', payload, function (res) {
      if (res && res.error) {
        var errStr = getThemeErrorMessage(res.error);
        if (global.toast) global.toast('❌ ' + errStr, true);
        return;
      }
      if (global.toast) global.toast('✅ تم حفظ الثيم بنجاح!', true);
      closeEditorModal();
      loadThemesAdmin(function (refreshError) {
        console.error('Theme list refresh failed:', refreshError);
        if (global.toast) {
          global.toast('⚠️ تم حفظ الثيم، لكن تعذر تحديث قائمة الثيمات. أعد المحاولة لاحقًا.', true);
        }
      });
      var fileInput = document.querySelector('#sec-themes input[type="file"]') || document.querySelector('input[onchange*="importThemeFile"]');
      if (fileInput) {
        fileInput.value = '';
      }
    });
  }

  // ── Import from file (JSON or Shopify ZIP archive) ──
  function importThemeFile(input) {
    var file = input && input.files && input.files[0];
    if (!file) return;

    function processParsed(parsed, themeName) {
      if (parsed && typeof parsed === 'object' && themeName && !parsed.name && !parsed.theme_name) {
        parsed.theme_name = themeName;
      }
      var theme = global.ThemeImporter ? global.ThemeImporter.normalize(parsed) : (Engine && Engine.importFile ? Engine.importFile(parsed) : parsed);
      editorState.isNew = true;
      editorState.current = null;
      editorState.draft = theme;
      renderEditor();
      openEditorModal();
      global.toast('✅ تم استيراد الثيم بنجاح: ' + (theme.title || theme.name) + ' — راجع الإعدادات ثم احفظه', true);
      if (input) {
        input.value = '';
      }
    }

    var isZip = (file.name && /\.zip$/i.test(file.name.trim())) ||
                (file.type && (file.type.indexOf('zip') > -1 || file.type.indexOf('compressed') > -1));

    function doUnzip() {
      if (global.toast) global.toast('⏳ جاري فك ضغط واستيراد حزمة الثيم...', false);
      function runExtract() {
        if (!window.JSZip) {
          if (global.toast) global.toast('❌ تعذر تحميل مكتبة فك الضغط JSZip. يرجى إعادة المحاولة', true);
          return;
        }
        window.JSZip.loadAsync(file).then(function(zip) {
          var targetFile = zip.file('config/settings_data.json') || zip.file('settings_data.json');
          if (!targetFile) {
            var matches = zip.file(/settings_data\.json$/i);
            if (matches && matches.length > 0) targetFile = matches[0];
          }
          if (!targetFile) {
            var cfgMatches = zip.file(/config\/.*\.json$/i);
            if (cfgMatches && cfgMatches.length > 0) targetFile = cfgMatches[0];
          }
          if (!targetFile) {
            var allJson = zip.file(/\.json$/i);
            if (allJson && allJson.length > 0) targetFile = allJson[0];
          }

          if (targetFile) {
            targetFile.async('string').then(function(content) {
              try {
                var json = JSON.parse(content);
                var baseName = file.name.replace(/\.zip$/i, '');
                processParsed(json, baseName);
              } catch(e) {
                if (global.toast) global.toast('❌ خطأ في قراءة ملف إعدادات الثيم: ' + e.message, true);
              }
            });
          } else {
            if (global.toast) global.toast('❌ لم يتم العثور على ملف إعدادات الثيم (settings_data.json) داخل الأرشيف', true);
          }
        }).catch(function(err) {
          if (global.toast) global.toast('❌ فشل فك ضغط ملف الثيم: ' + err.message, true);
        });
      }

      if (!window.JSZip) {
        var s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        s.onload = runExtract;
        s.onerror = function() { if (global.toast) global.toast('❌ تعذر تحميل مكتبة JSZip من الشبكة', true); };
        document.head.appendChild(s);
      } else {
        runExtract();
      }
    }

    if (isZip) {
      doUnzip();
    } else {
      var reader = new FileReader();
      reader.onload = function (e) {
        var text = e.target.result || '';
        // If file starts with PK magic bytes (ZIP header), auto-route to doUnzip
        if (text.substr(0, 2) === 'PK') {
          doUnzip();
          return;
        }
        try {
          var parsed = JSON.parse(text);
          processParsed(parsed, file.name.replace(/\.json$/i, ''));
        } catch (err) {
          // If JSON parse failed because of PK header, try unzipping
          if (text.indexOf('PK') === 0 || err.message.indexOf('token \'P\'') > -1 || err.message.indexOf('token P') > -1) {
            doUnzip();
          } else {
            if (global.toast) global.toast('❌ فشل الاستيراد: ' + err.message, true);
          }
        }
      };
      reader.readAsText(file);
    }
  }

  // ── Set default ──
  function setDefault(id) {
    if (!id) return;
    try { localStorage.setItem('sk_default_theme_v1', id); } catch(e) {}
    try { localStorage.removeItem('sk_theme_v1'); } catch(e) {} // remove user active to force default
    
    if (!global.apiGet) {
       if (global.toast) global.toast('✅ تم التعيين كثيم افتراضي محلياً', true);
       loadThemesAdmin();
       return;
    }
    global.apiGet('admin_set_default_theme', { id: id }, function (res) {
      if (res && res.error) {
        var msg = getThemeErrorMessage(res.error);
        if (global.toast) global.toast('❌ ' + msg, true);
        return;
      }
      if (global.toast) global.toast('✅ تم التعيين كثيم افتراضي', true);
      loadThemesAdmin();
    });
  }

  // ── Delete ──
  function deleteTheme(id) {
    if (!id) { if (global.toast) global.toast('❌ لا يوجد معرّف الثيم', true); return; }
    if (!confirm('حذف الثيم "' + id + '"؟')) return;
    global.apiGet('admin_delete_theme', { id: id }, function (res) {
      if (res && res.error) {
        var msg = getThemeErrorMessage(res.error);
        if (global.toast) global.toast('❌ ' + msg, true);
        return;
      }
      if (Engine && typeof Engine.unregister === 'function') {
        Engine.unregister(id);
      }
      if (global.toast) global.toast('✅ تم الحذف', true);
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
