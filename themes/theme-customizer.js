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

  function normalizeSections(inputSections) {
    var defaults = (Schema && Schema.defaultSectionsConfig) ? Schema.defaultSectionsConfig() : {};
    if (!inputSections || typeof inputSections !== 'object' || Object.keys(inputSections).length === 0) {
      return defaults;
    }
    var merged = {};
    // 1. Preserve all canonical schema registry sections (ensures new sections like countdown-timer appear for all themes)
    Object.keys(defaults).forEach(function(secId) {
      var def = defaults[secId];
      if (inputSections[secId]) {
        var saved = inputSections[secId];
        merged[secId] = {
          type: saved.type || def.type,
          name: saved.name || def.name,
          icon: saved.icon || def.icon,
          order: typeof saved.order === 'number' ? saved.order : def.order,
          enabled: saved.enabled !== false,
          settings: Object.assign({}, def.settings || {}, saved.settings || {})
        };
      } else {
        merged[secId] = JSON.parse(JSON.stringify(def));
      }
    });

    // 2. Include any extra custom sections from saved state
    Object.keys(inputSections).forEach(function(secId) {
      if (!merged[secId]) {
        merged[secId] = inputSections[secId];
      }
    });

    return merged;
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
    state.sections = normalizeSections(opts.sections);
    state.activeSectionId = Object.keys(state.sections)[0] || 'hero-banner';
    state.customizerOpen = true;
  };

  ThemeCustomizerClass.prototype.open = function(themeId, targetType, targetId) {
    var self = this;
    targetType = targetType || 'product';
    targetId = String(targetId || '2');
    themeId = themeId || (Engine && Engine.getActiveThemeId ? Engine.getActiveThemeId() : 'default');
    STORE_URL = (targetType === 'product') ? ('product.html?product=' + encodeURIComponent(targetId) + '&preview=1') : 'index.html?preview=1';

    if (global.apiGet) {
      global.apiGet('admin_get_theme', { id: themeId }, function(res) {
        var theme = (res && res.theme) ? res.theme : (Engine && Engine.get ? Engine.get(themeId) : null);
        var sections = (theme && theme.sections && Object.keys(theme.sections).length) ? theme.sections : (Schema ? Schema.defaultSectionsConfig() : {});
        var tokens = (theme && theme.tokens) ? theme.tokens : (Schema ? Schema.defaultTokens() : {});

        // Fetch saved section overrides for this specific target
        global.apiGet('get_theme_sections', { target_type: targetType, target_id: targetId }, function(secRes) {
          if (secRes && secRes.ok && secRes.config && secRes.config.sections && Object.keys(secRes.config.sections).length > 0) {
            sections = secRes.config.sections;
          }
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
    var saveBtn = (typeof document !== 'undefined') ? document.getElementById('sk-customizer-save-btn') : null;
    var statusEl = (typeof document !== 'undefined') ? document.getElementById('sk-customizer-status') : null;

    function setStatus(msg, type, isBusy) {
      if (saveBtn) {
        saveBtn.disabled = Boolean(isBusy);
        saveBtn.style.opacity = isBusy ? '0.6' : '1';
        saveBtn.style.cursor = isBusy ? 'not-allowed' : 'pointer';
        if (isBusy) {
          saveBtn.innerHTML = '⏳ جاري الحفظ...';
        } else {
          saveBtn.innerHTML = '💾 حفظ التعديلات';
        }
      }
      if (statusEl) {
        if (msg) {
          statusEl.style.display = 'inline-flex';
          statusEl.style.color = type === 'success' ? '#10b981' : (type === 'error' ? '#ef4444' : '#38bdf8');
          statusEl.textContent = msg;
          if (type === 'success') {
            setTimeout(function() { if (statusEl) statusEl.style.display = 'none'; }, 4000);
          }
        } else {
          statusEl.style.display = 'none';
        }
      }
      if (global.toast) {
        try { global.toast(msg, type !== 'error'); } catch (_) {}
      }
    }

    if (!global.apiPost) {
      setStatus('✅ تم حفظ التعديلات محلياً', 'success', false);
      return;
    }

    setStatus('⏳ جارٍ حفظ وتطبيق تخصيصات الثيم...', 'info', true);

    var sectionsJson = JSON.stringify(state.sections || {});
    var payload = {
      theme_id: state.themeId,
      target_type: state.targetType,
      target_id: state.targetId,
      sections_json: sectionsJson,
      sections: sectionsJson
    };

    console.log('[ThemeCustomizer] Sending save payload:', payload);

    global.apiPost('admin_save_theme_sections', payload, function(res) {
      if (res && res.error) {
        var errStr = typeof res.error === 'object' ? (res.error.message || res.error.code || JSON.stringify(res.error)) : String(res.error);
        console.error('[ThemeCustomizer] Save failed:', errStr, res);
        setStatus('❌ فشل الحفظ: ' + errStr, 'error', false);
        return;
      }
      console.log('[ThemeCustomizer] Save successful:', res);
      setStatus('✅ تم حفظ التعديلات بنجاح! يمكنك الآن معاينة صفحة الهبوط.', 'success', false);
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
    var landingUrl = (state.targetType === 'product' && state.targetId) ? ('product.html?product=' + encodeURIComponent(state.targetId)) : 'index.html';
    html += '<div style="display:flex;align-items:center;gap:10px;">';
    html += '<span id="sk-customizer-status" style="font-size:0.85rem;font-weight:600;display:none;align-items:center;gap:6px;"></span>';
    html += '<a id="sk-preview-landing-btn" href="' + landingUrl + '" target="_blank" rel="noopener" style="background:#3b82f6;color:#fff;text-decoration:none;padding:8px 14px;border-radius:8px;font-weight:600;font-size:0.85rem;display:flex;align-items:center;gap:6px;">👁️ معاينة صفحة الهبوط ↗</a>';
    html += '<button id="sk-customizer-save-btn" type="button" onclick="ThemeCustomizer.save()" style="background:#10b981;color:#fff;border:none;padding:8px 18px;border-radius:8px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px;transition:opacity 0.2s ease;">💾 حفظ التعديلات</button>';
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
        var SETTING_LABELS = {
          headline: 'العنوان الرئيسي',
          subtitle: 'العنوان الفرعي',
          cta_label: 'نص زر الطلب (CTA)',
          urgency_text: 'نص الاستعجال',
          accent_color: 'لون التمييز',
          badge_text: 'نص الشارة',
          title: 'العنوان',
          message: 'رسالة العرض',
          end_at: 'تاريخ ووقت انتهاء العرض (ISO 8601)',
          delivery_note: 'ملاحظة التوصيل',
          submit_btn_text: 'نص زر تأكيد الطلب',
          show_quantity_selector: 'إظهار خيار تحديد الكمية',
          show_pricing_tiers: '🎁 إظهار عروض الكميات والتوفير (Bundles)',
          tier1_enabled: '👁️ إظهار العرض الأول في صفحة الهبوط',
          tier1_label: '📝 عنوان عرض 1 قطعة (Tier 1)',
          tier1_subtext: '💬 الوصف الفرعي لعرض 1 قطعة',
          tier2_enabled: '👁️ إظهار العرض الثاني في صفحة الهبوط',
          tier2_label: '⭐ عنوان عرض قطعتين (Tier 2)',
          tier2_badge: '🏷️ شارة عرض قطعتين (Badge)',
          tier2_subtext: '💬 الوصف الفرعي لعرض قطعتين',
          tier2_discount_pct: '🏷️ نسبة خصم عرض قطعتين (%)',
          tier3_enabled: '👁️ إظهار العرض الثالث في صفحة الهبوط',
          tier3_label: '🎁 عنوان عرض 3 قطع (Tier 3)',
          tier3_badge: '🏷️ شارة عرض 3 قطع (Badge)',
          tier3_subtext: '💬 الوصف الفرعي لعرض 3 قطع',
          tier3_discount_pct: '🎁 نسبة خصم عرض 3 قطع (%)',
          tier3_free_shipping: '🚚 شحن مجاني لعرض 3 قطع',
          show_wilaya_selector: 'إظهار خيار الولاية',
          show_email_field: 'إظهار حقل البريد الإلكتروني',
          show_baladiya_field: 'إظهار حقل البلدية',
          show_address_field: 'إظهار حقل العنوان التفصيلي',
          show_delivery_preference: 'إظهار خيار مكان التوصيل (للمنزل/المكتب)',
          show_notes_field: 'إظهار حقل الملاحظات',
          badge1_title: 'عنوان الشارة الأولى',
          badge1_desc: 'وصف الشارة الأولى',
          badge2_title: 'عنوان الشارة الثانية',
          badge2_desc: 'وصف الشارة الثانية',
          badge3_title: 'عنوان الشارة الثالثة',
          badge3_desc: 'وصف الشارة الثالثة'
        };

        if (sid === 'fast-order-form' || sid === 'order-form') {
          sec.settings = sec.settings || {};
          if (sec.settings.show_quantity_selector === undefined) sec.settings.show_quantity_selector = true;
          if (sec.settings.show_pricing_tiers === undefined) sec.settings.show_pricing_tiers = true;
          if (sec.settings.tier1_enabled === undefined) sec.settings.tier1_enabled = true;
          if (!sec.settings.tier1_label) sec.settings.tier1_label = '1 قطعة (شراء عادي)';
          if (!sec.settings.tier1_subtext) sec.settings.tier1_subtext = 'السعر القياسي';
          if (sec.settings.tier2_enabled === undefined) sec.settings.tier2_enabled = true;
          if (!sec.settings.tier2_label) sec.settings.tier2_label = '2 قطع (الأكثر طلباً ⭐)';
          if (!sec.settings.tier2_badge) sec.settings.tier2_badge = 'الأكثر طلباً';
          if (!sec.settings.tier2_subtext) sec.settings.tier2_subtext = 'العرض الموصى به للمنازل';
          if (sec.settings.tier2_discount_pct === undefined) sec.settings.tier2_discount_pct = 10;
          if (sec.settings.tier3_enabled === undefined) sec.settings.tier3_enabled = true;
          if (!sec.settings.tier3_label) sec.settings.tier3_label = '3 قطع (توفير كلي 🎁)';
          if (!sec.settings.tier3_badge) sec.settings.tier3_badge = 'توفير كلي';
          if (!sec.settings.tier3_subtext) sec.settings.tier3_subtext = 'أفضل قيمة وأعلى توفير';
          if (sec.settings.tier3_discount_pct === undefined) sec.settings.tier3_discount_pct = 20;
          if (sec.settings.tier3_free_shipping === undefined) sec.settings.tier3_free_shipping = true;
        }

        var ORDER_KEYS = {
          'fast-order-form': [
            'title', 'submit_btn_text', 'delivery_note',
            'show_quantity_selector', 'show_pricing_tiers',
            'tier1_enabled', 'tier1_label', 'tier1_subtext',
            'tier2_enabled', 'tier2_label', 'tier2_badge', 'tier2_subtext', 'tier2_discount_pct',
            'tier3_enabled', 'tier3_label', 'tier3_badge', 'tier3_subtext', 'tier3_discount_pct', 'tier3_free_shipping',
            'show_wilaya_selector', 'show_email_field', 'show_baladiya_field',
            'show_address_field', 'show_delivery_preference', 'show_notes_field'
          ],
          'order-form': [
            'title', 'submit_btn_text', 'delivery_note',
            'show_quantity_selector', 'show_pricing_tiers',
            'tier1_enabled', 'tier1_label', 'tier1_subtext',
            'tier2_enabled', 'tier2_label', 'tier2_badge', 'tier2_subtext', 'tier2_discount_pct',
            'tier3_enabled', 'tier3_label', 'tier3_badge', 'tier3_subtext', 'tier3_discount_pct', 'tier3_free_shipping',
            'show_wilaya_selector', 'show_email_field', 'show_baladiya_field',
            'show_address_field', 'show_delivery_preference', 'show_notes_field'
          ]
        };

        var keysToRender = (ORDER_KEYS[sid])
          ? ORDER_KEYS[sid].concat(Object.keys(sec.settings).filter(function(k) { return !ORDER_KEYS[sid].includes(k); }))
          : Object.keys(sec.settings);

        html += '<div style="padding:12px;background:#1e293b;border-top:1px solid #334155;">';
        keysToRender.forEach(function(sKey) {
          if (sec.settings[sKey] === undefined) return;
          var sVal = sec.settings[sKey];
          var labelText = SETTING_LABELS[sKey] || sKey;

          if (sKey === 'tier1_enabled') {
            html += '<div style="margin:14px 0 8px;padding:6px 10px;background:#0f172a;border-right:3px solid #6366f1;border-radius:4px;font-size:0.82rem;font-weight:800;color:#a5b4fc">📦 إعدادات العرض الأول (1 قطعة / مفرد)</div>';
          } else if (sKey === 'tier2_enabled') {
            html += '<div style="margin:14px 0 8px;padding:6px 10px;background:#0f172a;border-right:3px solid #f59e0b;border-radius:4px;font-size:0.82rem;font-weight:800;color:#fde68a">⭐ إعدادات العرض الثاني (عرض مع علبة / قطعتين)</div>';
          } else if (sKey === 'tier3_enabled') {
            html += '<div style="margin:14px 0 8px;padding:6px 10px;background:#0f172a;border-right:3px solid #10b981;border-radius:4px;font-size:0.82rem;font-weight:800;color:#86efac">🎁 إعدادات العرض الثالث (عرض التوفير الأقصى)</div>';
          }

          if (sKey === 'end_at') {
            html += '<div style="margin-bottom:12px;background:#0f172a;padding:10px;border-radius:8px;border:1px solid #334155;">';
            html += '<label style="display:block;font-size:0.8rem;color:#f59e0b;font-weight:700;margin-bottom:4px;">⏱️ ' + esc(labelText) + '</label>';
            html += '<div style="display:flex;gap:6px;align-items:center;">';
            html += '<input type="text" id="sk-input-end-at" value="' + esc(sVal) + '" placeholder="2026-08-23T15:00:00Z" oninput="ThemeCustomizer.updateSectionSetting(\'' + esc(sid) + '\', \'end_at\', this.value)" style="flex:1;background:#1e293b;border:1px solid #475569;border-radius:6px;padding:7px 10px;color:#fff;font-size:0.82rem;font-family:monospace;direction:ltr;">';
            html += '<button type="button" onclick="ThemeCustomizer.set24HourOffer(\'' + esc(sid) + '\')" style="background:#f59e0b;color:#111;border:none;border-radius:6px;padding:7px 10px;font-weight:800;font-size:0.78rem;cursor:pointer;white-space:nowrap;" title="تعيين العداد لينتهي بعد 24 ساعة من الآن">⚡ +24 ساعة</button>';
            html += '</div>';
            html += '<div style="font-size:0.7rem;color:#94a3b8;margin-top:4px;">اضغط الزر لبدء عداد 24 ساعة موحد لجميع الزوار من الآن</div>';
            html += '</div>';
          } else if (sKey === 'tier2_discount_pct' || sKey === 'tier3_discount_pct') {
            var numVal = Math.max(0, Math.min(100, parseInt(sVal, 10) || 0));
            html += '<div style="margin-bottom:10px;background:#0f172a;padding:8px 10px;border-radius:6px;border:1px solid #334155;">';
            html += '<label style="display:block;font-size:0.8rem;color:#e2e8f0;margin-bottom:4px;">' + esc(labelText) + '</label>';
            html += '<input type="number" min="0" max="100" step="1" value="' + esc(numVal) + '" oninput="var v=Math.max(0,Math.min(100,parseInt(this.value,10)||0));ThemeCustomizer.updateSectionSetting(\'' + esc(sid) + '\', \'' + esc(sKey) + '\', v)" style="width:100%;background:#1e293b;border:1px solid #475569;border-radius:6px;padding:6px 10px;color:#fff;font-size:0.85rem;box-sizing:border-box;">';
            html += '</div>';
          } else if (typeof sVal === 'boolean') {
            html += '<div style="margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;background:#0f172a;padding:8px 10px;border-radius:6px;border:1px solid #334155;">';
            html += '<label style="font-size:0.8rem;color:#e2e8f0;cursor:pointer;flex:1;" for="sk-chk-' + esc(sid) + '-' + esc(sKey) + '">' + esc(labelText) + '</label>';
            html += '<input type="checkbox" id="sk-chk-' + esc(sid) + '-' + esc(sKey) + '" ' + (sVal ? 'checked' : '') + ' onchange="ThemeCustomizer.updateSectionSetting(\'' + esc(sid) + '\', \'' + esc(sKey) + '\', this.checked)" onclick="ThemeCustomizer.updateSectionSetting(\'' + esc(sid) + '\', \'' + esc(sKey) + '\', this.checked)" style="cursor:pointer;width:18px;height:18px;accent-color:#6366f1;">';
            html += '</div>';
          } else if (typeof sVal === 'string' || typeof sVal === 'number') {
            html += '<div style="margin-bottom:10px;">';
            html += '<label style="display:block;font-size:0.8rem;color:#94a3b8;margin-bottom:4px;">' + esc(labelText) + '</label>';
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

  ThemeCustomizerClass.prototype.set24HourOffer = function(sectionId) {
    sectionId = sectionId || 'countdown-timer';
    var endIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    this.updateSectionSetting(sectionId, 'end_at', endIso);
    this.refreshSectionsList();
    this.sendPreviewUpdate();
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
  ThemeCustomizerClass.set24HourOffer = function(sId) { return instance.set24HourOffer(sId); };
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
