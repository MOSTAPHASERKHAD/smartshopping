/*
 * theme-engine.js — Smart Kiosk Dynamic Theme & Sections Engine
 * Applies tokens, manages modes, dynamically parses and renders Shopify-like sections with data injection.
 * Compatible with Node.js and Browser environments.
 */
(function (global) {
  'use strict';

  var Schema = global.ThemeSchema || (typeof require !== 'undefined' ? require('./theme-schema.js') : null);

  var STORAGE_KEY = 'sk_theme_v1';
  var DEFAULT_THEME_ID = 'smartkiosk-default';

  function escHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatPrice(num) {
    var val = Number(num || 0);
    return val.toLocaleString() + ' دج';
  }

  function ThemeEngine() {
    this.themes = {};           // id -> theme object
    this.activeId = null;
    this.mode = 'auto';         // light | dark | auto
    this.systemDark = false;
    this.defaultThemeId = null; // store default (from server)
    this._media = null;
    this._onChange = null;
  }

  // ── Register a theme ──
  ThemeEngine.prototype.register = function (theme, opts) {
    opts = opts || {};
    if (!theme || !theme.id) return null;
    var resolved = this._resolveExtends(theme);
    this.themes[theme.id] = resolved;
    if (!opts.silent && this.activeId === theme.id) this.apply(theme.id, this.mode);
    return resolved;
  };

  ThemeEngine.prototype._resolveExtends = function (theme) {
    var tokens = Schema ? Schema.normalizeTokens(theme.tokens || theme.config_json || {}) : (theme.tokens || {});
    if (theme.extends && this.themes[theme.extends]) {
      var parent = this.themes[theme.extends];
      tokens = this._mergeTokens(parent.tokens, tokens);
    }
    var out = {
      id: theme.id,
      name: theme.name || 'Untitled',
      title: theme.title || theme.name || 'Untitled',
      author: theme.author || '',
      version: theme.version || '1.0',
      base: theme.base || 'light',
      extends: theme.extends || null,
      tokens: tokens,
      sections: (theme.sections && typeof theme.sections === 'object') ? theme.sections : (tokens.sections || {})
    };
    return out;
  };

  ThemeEngine.prototype._mergeTokens = function (parent, child) {
    var merged = JSON.parse(JSON.stringify(parent));
    ['colors', 'fonts', 'spacing', 'radius', 'shadow'].forEach(function (grp) {
      if (child[grp]) Object.assign(merged[grp], child[grp]);
    });
    if (child.components) {
      Object.keys(child.components).forEach(function (k) {
        merged.components[k] = Object.assign({}, merged.components[k], child.components[k]);
      });
    }
    if (child.sections) {
      merged.sections = Object.assign({}, merged.sections, child.sections);
    }
    return merged;
  };

  // ── Convert tokens → CSS custom properties string ──
  ThemeEngine.prototype._tokensToCSS = function (tokens, mode, themeBase) {
    var lines = [];
    var c = {};
    if (tokens.colors) {
      Object.keys(tokens.colors).forEach(function (k) { c[k] = tokens.colors[k]; });
    }
    if (mode === 'dark' && themeBase !== 'dark' && Schema && Schema.darkTokens) {
      var dk = Schema.darkTokens();
      Object.keys(dk).forEach(function (k) { if (c[k]) c[k] = dk[k]; });
    }
    Object.keys(c).forEach(function (k) { lines.push('  --color-' + k + ':' + c[k] + ';'); });
    if (tokens.fonts) Object.keys(tokens.fonts).forEach(function (k) { lines.push('  --font-' + k + ':' + tokens.fonts[k] + ';'); });
    if (tokens.spacing) Object.keys(tokens.spacing).forEach(function (k) { lines.push('  --space-' + k + ':' + tokens.spacing[k] + ';'); });
    if (tokens.radius) Object.keys(tokens.radius).forEach(function (k) { lines.push('  --radius-' + k + ':' + tokens.radius[k] + ';'); });
    if (tokens.shadow) Object.keys(tokens.shadow).forEach(function (k) { lines.push('  --shadow-' + k + ':' + tokens.shadow[k] + ';'); });

    // Bridge with standalone landing page design tokens (--ds-*)
    if (c.background) lines.push('  --ds-bg:' + c.background + ';');
    if (c.surface) lines.push('  --ds-surface:' + c.surface + ';');
    if (c.text) lines.push('  --ds-text-primary:' + c.text + ';');
    if (c.textMuted) lines.push('  --ds-text-secondary:' + c.textMuted + ';');
    if (c.textSubtle) lines.push('  --ds-text-muted:' + c.textSubtle + ';');
    if (c.primary) lines.push('  --ds-primary:' + c.primary + ';');
    if (c.secondary || c.accent) lines.push('  --ds-accent:' + (c.secondary || c.accent) + ';');
    if (c.border) lines.push('  --ds-border:' + c.border + ';');
    if (tokens.fonts && (tokens.fonts.body || tokens.fonts.heading)) {
      lines.push('  --ds-font:' + (tokens.fonts.body || tokens.fonts.heading) + ';');
    }

    return ':root {\n' + lines.join('\n') + '\n}';
  };

  // ── Apply theme to DOM (Browser Only) ──
  ThemeEngine.prototype.apply = function (themeId, mode) {
    if (typeof document === 'undefined') return;
    var t = this.themes[themeId];
    if (!t) return;
    this.activeId = themeId;
    this.mode = mode || this.mode;

    var css = this._tokensToCSS(t.tokens, this.mode, t.base);
    var el = document.getElementById('sk-theme-vars');
    if (!el) {
      el = document.createElement('style');
      el.id = 'sk-theme-vars';
      document.head.appendChild(el);
    }
    el.textContent = css;
  };

  // ══════════════════════════════════════════════════════════════════
  // ── DYNAMIC SECTIONS PARSER & RENDERER (Shopify Architecture) ──
  // ══════════════════════════════════════════════════════════════════

  /**
   * Template Variable Injector (e.g. {{ product.name }} or {{ store.name }})
   */
  ThemeEngine.prototype.injectVariables = function (templateStr, ctx) {
    if (!templateStr || typeof templateStr !== 'string') return '';
    ctx = ctx || {};
    var p = ctx.product || {};
    var s = ctx.store || {};

    return templateStr.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, function (match, key) {
      var parts = key.split('.');
      if (parts[0] === 'product') {
        var pKey = parts[1];
        if (pKey === 'price') return formatPrice(p.price);
        if (pKey === 'price_old' || pKey === 'old_price') return p.price_old ? formatPrice(p.price_old) : '';
        return p[pKey] != null ? String(p[pKey]) : '';
      }
      if (parts[0] === 'store') {
        var sKey = parts[1];
        return s[sKey] != null ? String(s[sKey]) : '';
      }
      return match;
    });
  };

  /**
   * Render a Single Section by Type
   */
  ThemeEngine.prototype.renderSection = function (sectionType, sectionId, settings, ctx) {
    settings = settings || {};
    ctx = ctx || {};
    var p = ctx.product || {};
    var s = ctx.store || {};

    switch (sectionType) {
      case 'hero':
      case 'hero-banner':
        return this._renderHero(settings, ctx, sectionId);

      case 'order-form':
      case 'fast-order-form':
        return this._renderOrderForm(settings, ctx, sectionId);

      case 'trust':
      case 'trust-signals':
        return this._renderTrustSignals(settings, ctx, sectionId);

      case 'gallery':
      case 'product-gallery':
        return this._renderGallery(settings, ctx, sectionId);

      case 'features':
      case 'features-grid':
        return this._renderFeatures(settings, ctx, sectionId);

      case 'details':
      case 'rich-text-details':
        return this._renderDetails(settings, ctx, sectionId);

      case 'reviews':
      case 'testimonials-reviews':
        return this._renderReviews(settings, ctx, sectionId);

      case 'faq':
      case 'faq-accordion':
        return this._renderFaq(settings, ctx, sectionId);

      case 'custom-code':
      case 'custom-liquid':
        return this._renderCustomCode(settings, ctx, sectionId);

      default:
        return '<div class="pl-section pl-section-custom" id="' + escHtml(sectionId) + '"></div>';
    }
  };

  /**
   * Render All Ordered Sections into unified HTML
   */
  ThemeEngine.prototype.renderSections = function (sectionsConfig, ctx) {
    var self = this;
    sectionsConfig = sectionsConfig || (Schema ? Schema.defaultSectionsConfig() : {});
    ctx = ctx || {};

    // Convert to sorted array
    var secArray = Object.keys(sectionsConfig).map(function (secKey) {
      var item = sectionsConfig[secKey];
      return {
        id: secKey,
        type: item.type || secKey,
        enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
        order: typeof item.order === 'number' ? item.order : 99,
        settings: item.settings || {}
      };
    });

    secArray.sort(function (a, b) { return a.order - b.order; });

    var htmlParts = [];
    secArray.forEach(function (sec) {
      if (sec.enabled) {
        var secHtml = self.renderSection(sec.type, sec.id, sec.settings, ctx);
        if (secHtml) htmlParts.push(secHtml);
      }
    });

    return htmlParts.join('\n');
  };

  // ── Section Renderers Implementation ──

  ThemeEngine.prototype._renderHero = function (settings, ctx, id) {
    var p = ctx.product || {};
    var headline = this.injectVariables(settings.headline || '{{ product.name }}', ctx);
    var subtitle = this.injectVariables(settings.subtitle || '', ctx);
    var cta = this.injectVariables(settings.cta_label || '🛒 اطلب الآن', ctx);
    var urgency = this.injectVariables(settings.urgency_text || '', ctx);
    var priceStr = formatPrice(p.price);
    var oldPriceStr = p.price_old ? formatPrice(p.price_old) : '';

    var html = '<div class="pl-hero-grid pl-section" id="' + escHtml(id) + '">';
    html += '<div class="pl-info-col">';
    html += '<div class="pl-badge-row">';
    if (p.price_old && p.price_old > p.price) {
      var pct = Math.round((1 - p.price / p.price_old) * 100);
      html += '<span class="pl-discount-badge">تخفيض ' + pct + '%</span>';
    }
    html += '<span class="pl-stock-badge">✓ متوفر في المخزن</span>';
    if (urgency) {
      html += '<span class="pl-urgency-badge">🔥 ' + escHtml(urgency) + '</span>';
    }
    html += '</div>';

    html += '<h1 class="pl-product-title">' + escHtml(headline) + '</h1>';
    if (subtitle) {
      html += '<p class="pl-product-subtitle">' + escHtml(subtitle) + '</p>';
    }

    html += '<div class="pl-price-card">';
    html += '<div class="pl-price-main"><span class="pl-price-val">' + escHtml(priceStr) + '</span></div>';
    if (oldPriceStr) {
      html += '<div class="pl-price-old"><del>' + escHtml(oldPriceStr) + '</del></div>';
    }
    html += '</div>';

    html += '<button type="button" class="pl-cta-btn" onclick="scrollToOrderForm()"><span>' + escHtml(cta) + '</span> <span>👇</span></button>';
    html += '</div>';
    html += '</div>';
    return html;
  };

  ThemeEngine.prototype._renderOrderForm = function (settings, ctx, id) {
    var title = settings.title || 'استمارة الطلب السريع (الدفع عند الاستلام)';
    var badge = settings.badge_text || '⚡ تأكيد فوري وسريع';
    var submitText = settings.submit_btn_text || '🛒 تأكيد الطلب الآن (الدفع عند الاستلام)';

    var html = '<div class="pl-order-section pl-section" id="' + escHtml(id) + '">';
    html += '<div class="pl-order-card">';
    html += '<div class="pl-order-header">';
    html += '<div class="pl-order-badge">' + escHtml(badge) + '</div>';
    html += '<h2 class="pl-order-title">' + escHtml(title) + '</h2>';
    html += '<p class="pl-order-subtitle">املأ الاستمارة وسنتصل بك لتأكيد الشحن والتسليم</p>';
    html += '</div>';

    html += '<form class="pl-form" id="plOrderForm" onsubmit="handleOrderSubmit(event)">';
    html += '<div class="pl-field-group"><label class="pl-label">الاسم الكامل *</label><input type="text" id="plName" class="pl-input" placeholder="مثال: محمد بن علي" required></div>';
    html += '<div class="pl-field-group"><label class="pl-label">رقم الهاتف *</label><input type="tel" id="plPhone" class="pl-input" placeholder="05 / 06 / 07 XX XX XX XX" required></div>';
    html += '<div class="pl-field-group"><label class="pl-label">الولاية *</label><select id="plWilaya" class="pl-select" required onchange="onWilayaChange()"><option value="">-- اختر ولايتك (58 ولاية) --</option></select></div>';
    html += '<div class="pl-field-group"><label class="pl-label">البلدية / العنوان بالتفصيل *</label><input type="text" id="plAddress" class="pl-input" placeholder="البلدية والشارع بالتفصيل" required></div>';
    html += '<div class="pl-field-group"><label class="pl-label">مكان الاستلام</label><div class="pl-radio-group"><label><input type="radio" name="plDelivery" value="Home" checked onchange="updateTotalCalc()"> التوصيل للمنزل</label><label><input type="radio" name="plDelivery" value="Office" onchange="updateTotalCalc()"> الاستلام من مكتب التوصيل</label></div></div>';
    
    html += '<div class="pl-summary-box">';
    html += '<div class="pl-sum-row"><span>سعر المنتج:</span><span id="plSubtotalVal">--</span></div>';
    html += '<div class="pl-sum-row"><span>تكلفة التوصيل:</span><span id="plShippingVal">اختر الولاية</span></div>';
    html += '<div class="pl-sum-row total"><span>المجموع الإجمالي:</span><span id="plTotalVal">--</span></div>';
    html += '</div>';

    html += '<button type="submit" class="pl-submit-btn" id="plSubmitBtn"><span>' + escHtml(submitText) + '</span></button>';
    html += '</form>';
    html += '</div>';
    html += '</div>';
    return html;
  };

  ThemeEngine.prototype._renderTrustSignals = function (settings, ctx, id) {
    var html = '<div class="pl-trust-strip pl-section" id="' + escHtml(id) + '">';
    html += '<div class="pl-trust-item"><span class="icon">💵</span><div><h4>' + escHtml(settings.badge1_title || 'دفع عند الاستلام') + '</h4><p>' + escHtml(settings.badge1_desc || 'عاين طردك قبل الدفع') + '</p></div></div>';
    html += '<div class="pl-trust-item"><span class="icon">🚚</span><div><h4>' + escHtml(settings.badge2_title || 'شحن سريع') + '</h4><p>' + escHtml(settings.badge2_desc || 'توصيل لـ 58 ولاية') + '</p></div></div>';
    html += '<div class="pl-trust-item"><span class="icon">🛡️</span><div><h4>' + escHtml(settings.badge3_title || 'ضمان الجودة') + '</h4><p>' + escHtml(settings.badge3_desc || 'مطابق للمواصفات 100%') + '</p></div></div>';
    html += '</div>';
    return html;
  };

  ThemeEngine.prototype._renderGallery = function (settings, ctx, id) {
    var p = ctx.product || {};
    var images = p.images && p.images.length > 0 ? p.images : [p.image_url || 'logo.png'];
    var html = '<div class="pl-gallery-col pl-section" id="' + escHtml(id) + '">';
    html += '<div class="pl-main-image-box" onclick="openLightbox(0)">';
    html += '<img src="' + escHtml(images[0]) + '" alt="' + escHtml(p.name || '') + '" id="plMainImg">';
    html += '<button type="button" class="pl-zoom-trigger-btn"><span>🔍 انقر للتكبير</span></button>';
    html += '</div>';
    if (images.length > 1 && settings.show_thumbnails !== false) {
      html += '<div class="pl-thumbs-list">';
      images.forEach(function (img, idx) {
        html += '<div class="pl-thumb-item' + (idx === 0 ? ' active' : '') + '" onclick="selectGalleryIndex(' + idx + ')">';
        html += '<img src="' + escHtml(img) + '" alt="' + escHtml(p.name || '') + ' ' + (idx + 1) + '">';
        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div>';
    return html;
  };

  ThemeEngine.prototype._renderFeatures = function (settings, ctx, id) {
    var title = settings.title || 'لماذا تختار هذا المنتج؟';
    var list = settings.features_list || [];
    var html = '<div class="pl-card-section pl-section" id="' + escHtml(id) + '">';
    html += '<h2 class="pl-section-title"><span>⭐</span><span>' + escHtml(title) + '</span></h2>';
    html += '<div class="pl-features-grid">';
    list.forEach(function (f) {
      html += '<div class="pl-feature-card"><div class="icon">' + escHtml(f.icon || '✨') + '</div><h3>' + escHtml(f.title || '') + '</h3><p>' + escHtml(f.desc || '') + '</p></div>';
    });
    html += '</div>';
    html += '</div>';
    return html;
  };

  ThemeEngine.prototype._renderDetails = function (settings, ctx, id) {
    var title = settings.title || 'تفاصيل ومواصفات المنتج';
    var content = this.injectVariables(settings.content || '{{ product.description }}', ctx);
    var html = '<div class="pl-card-section pl-section" id="' + escHtml(id) + '">';
    html += '<h2 class="pl-section-title"><span>📄</span><span>' + escHtml(title) + '</span></h2>';
    html += '<div class="pl-desc-content"><p>' + escHtml(content).replace(/\n/g, '<br>') + '</p></div>';
    html += '</div>';
    return html;
  };

  ThemeEngine.prototype._renderReviews = function (settings, ctx, id) {
    var title = settings.title || 'آراء عملائنا الكرام';
    var badge = settings.badge_text || 'تقييم 4.9/5 من أكثر من 500 مشترٍ';
    var html = '<div class="pl-card-section pl-section" id="' + escHtml(id) + '">';
    html += '<h2 class="pl-section-title"><span>💬</span><span>' + escHtml(title) + '</span></h2>';
    html += '<div class="pl-reviews-header"><span class="badge">⭐ ' + escHtml(badge) + '</span></div>';
    html += '<div class="pl-reviews-list" id="plReviewsList"><div class="pl-review-item"><div class="stars">⭐⭐⭐⭐⭐</div><p class="text">منتج ممتاز ومطابق للوصف تماماً والتوصيل سريع جداً بارك الله فيكم.</p><div class="author">أحمد — الجزائر العاصمة (مشتري مؤكد ✓)</div></div></div>';
    html += '</div>';
    return html;
  };

  ThemeEngine.prototype._renderFaq = function (settings, ctx, id) {
    var title = settings.title || 'الأسئلة الشائعة حول الطلب والتوصيل';
    var list = settings.faq_list || [];
    var html = '<div class="pl-card-section pl-section" id="' + escHtml(id) + '">';
    html += '<h2 class="pl-section-title"><span>❓</span><span>' + escHtml(title) + '</span></h2>';
    html += '<div class="pl-faq-list">';
    list.forEach(function (item) {
      html += '<div class="pl-faq-item" onclick="this.classList.toggle(\'open\')"><div class="pl-faq-q"><span>' + escHtml(item.q || '') + '</span><span class="arrow">▼</span></div><div class="pl-faq-a">' + escHtml(item.a || '') + '</div></div>';
    });
    html += '</div>';
    html += '</div>';
    return html;
  };

  ThemeEngine.prototype._renderCustomCode = function (settings, ctx, id) {
    var rawHtml = this.injectVariables(settings.raw_html || settings.html || '', ctx);
    var customCss = settings.custom_css ? '<style>' + settings.custom_css + '</style>' : '';
    var containerClass = settings.container_width === 'full' ? 'sk-custom-code-full' : 'pl-container';
    var devClass = settings.device_visibility === 'mobile_only' ? 'sk-mobile-only' : (settings.device_visibility === 'desktop_only' ? 'sk-desktop-only' : '');
    return '<div class="pl-section sk-custom-code ' + devClass + '" id="' + escHtml(id) + '">' +
      customCss +
      '<div class="' + containerClass + '">' + rawHtml + '</div>' +
    '</div>';
  };

  // ── Universal Instance & Export ──
  var instance = new ThemeEngine();

  global.ThemeEngine = ThemeEngine;
  global.themeEngine = instance;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      ThemeEngine: ThemeEngine,
      themeEngine: instance
    };
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
