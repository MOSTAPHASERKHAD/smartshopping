/*
 * theme-schema.js — Smart Kiosk Theme & Sections Schema
 * Defines token schema, Shopify-like dynamic sections architecture, presets, and validation helpers.
 */
(function (global) {
  'use strict';

  // ── Font options available in the editor (Google Fonts) ──
  var FONT_OPTIONS = [
    { value: "'Almarai','Inter',sans-serif", label: 'Almarai (افتراضي)' },
    { value: "'Cairo',sans-serif", label: 'Cairo' },
    { value: "'Tajawal',sans-serif", label: 'Tajawal' },
    { value: "'IBM Plex Sans Arabic',sans-serif", label: 'IBM Plex Arabic' },
    { value: "'El Messiri',sans-serif", label: 'El Messiri' },
    { value: "'Amiri',serif", label: 'Amiri (سريف)' },
    { value: "'Inter',sans-serif", label: 'Inter (لاتيني)' },
    { value: "'Poppins',sans-serif", label: 'Poppins' },
    { value: "'Montserrat',sans-serif", label: 'Montserrat' },
    { value: "'Roboto',sans-serif", label: 'Roboto' },
    { value: "'JetBrains Mono',monospace", label: 'JetBrains Mono' },
    { value: "system-ui,sans-serif", label: 'System UI' }
  ];

  // ── The canonical token schema ──
  var COLOR_TOKENS = [
    { key: 'primary',    label: 'اللون الأساسي',    desc: 'الأزرار، الروابط، الشعار', def: '#1a1a2e' },
    { key: 'secondary',  label: 'لون التمييز/العروض', desc: 'العروض، الشارات، اللمسات', def: '#e94560' },
    { key: 'background', label: 'خلفية الصفحة',     desc: 'لون خلفية body', def: '#fafafa' },
    { key: 'surface',    label: 'السطح (كروت)',     desc: 'الكروت، اللوحات، المودال', def: '#ffffff' },
    { key: 'text',       label: 'لون النص',         desc: 'النص الأساسي', def: '#111111' },
    { key: 'textMuted',  label: 'نص ثانوي',         desc: 'نصوص رمادية', def: '#6b6b6b' },
    { key: 'textSubtle', label: 'نص خافت',          desc: 'تعليقات، أرقام صغيرة', def: '#999999' },
    { key: 'border',     label: 'الحدود',           desc: 'الفواصل والحدود', def: '#e8e8e8' },
    { key: 'success',    label: 'نجاح',             desc: 'تأكيد، تم التوصيل', def: '#22c55e' },
    { key: 'warning',    label: 'تحذير',            desc: 'قيد الانتظار', def: '#f59e0b' },
    { key: 'danger',     label: 'خطر/حذف',          desc: 'حذف، ملغي', def: '#ef4444' },
    { key: 'info',       label: 'معلومات',          desc: 'روابط المعلومات', def: '#3b82f6' },
    { key: 'accent',     label: 'لمسة إضافية',      desc: 'تلميحات بصرية', def: '#818cf8' }
  ];

  var FONT_TOKENS = [
    { key: 'heading', label: 'خط العناوين', def: "'Almarai','Inter',sans-serif" },
    { key: 'body',    label: 'خط النص',     def: "'Almarai','Inter',sans-serif" },
    { key: 'mono',    label: 'خط الكود',    def: "'JetBrains Mono',monospace" }
  ];

  var SPACING_TOKENS = [
    { key: 'xs', def: '4px' }, { key: 'sm', def: '8px' }, { key: 'md', def: '16px' },
    { key: 'lg', def: '24px' }, { key: 'xl', def: '32px' }
  ];

  var RADIUS_TOKENS = [
    { key: 'sm', def: '4px' }, { key: 'md', def: '8px' }, { key: 'lg', def: '12px' },
    { key: 'xl', def: '16px' }, { key: 'full', def: '9999px' }
  ];

  var SHADOW_TOKENS = [
    { key: 'sm', def: '0 1px 2px rgba(0,0,0,.05)' },
    { key: 'md', def: '0 4px 6px rgba(0,0,0,.07)' },
    { key: 'lg', def: '0 10px 25px rgba(0,0,0,.10)' }
  ];

  var COMPONENT_TOKENS = [
    { key: 'button', label: 'الأزرار',
      props: [
        { key: 'padding', label: 'الحشو', def: '10px 20px' },
        { key: 'radius', label: 'الزوايا', def: 'var(--radius-md)' },
        { key: 'fontWeight', label: 'سُمك الخط', def: '600' }
      ]
    },
    { key: 'card', label: 'الكروت',
      props: [
        { key: 'border', label: 'الحدود', def: '1px solid var(--border)' },
        { key: 'shadow', label: 'الظل', def: 'var(--shadow-sm)' },
        { key: 'radius', label: 'الزوايا', def: 'var(--radius-lg)' }
      ]
    },
    { key: 'input', label: 'الحقول',
      props: [
        { key: 'border', label: 'الحدود', def: '1px solid var(--border)' },
        { key: 'padding', label: 'الحشو', def: '10px 12px' },
        { key: 'radius', label: 'الزوايا', def: 'var(--radius-md)' }
      ]
    },
    { key: 'modal', label: 'النوافذ',
      props: [
        { key: 'radius', label: 'الزوايا', def: 'var(--radius-lg)' },
        { key: 'shadow', label: 'الظل', def: 'var(--shadow-lg)' }
      ]
    }
  ];

  var IMAGE_TOKENS = [
    { key: 'logoText',    label: 'نص الشعار',      def: 'Smart Shopping' },
    { key: 'logoIcon',    label: 'أيقونة الشعار',   desc: 'إيموجي أو حرف', def: '🛒' },
    { key: 'favicon',     label: 'أيقونة التبويب',  desc: 'إيموجي', def: '🛒' },
    { key: 'bannerGradient', label: 'تدرج البانر',  desc: 'CSS gradient للخلفية', def: '' },
    { key: 'bannerAccent',   label: 'لون البانر',   desc: 'لون مميز للبانر', def: '' }
  ];

  var ICON_TOKENS = [
    { key: 'shape', label: 'شكل الأيقونات', desc: 'round, square, triangle', def: 'round' },
    { key: 'deliveryIcon', label: 'أيقونة التوصيل', desc: 'مسار أو SVG لأيقونة الدفع عند الاستلام', def: '' }
  ];

  // ── Canonical Dynamic Section Library (Shopify-Like Architecture) ──
  var SECTION_REGISTRY = {
    'hero-banner': {
      type: 'hero',
      name: 'البانر والعنوان الرئيسي',
      icon: '🎯',
      defaultOrder: 1,
      defaultVisible: true,
      defaultSettings: {
        headline: '{{ product.name }}',
        subtitle: 'اطلب الآن والدفع عند الاستلام — توصيل متوفر لـ 58 ولاية',
        cta_label: '🛒 اطلب الآن',
        urgency_text: 'الكمية محدودة — اطلب قبل نفاد المخزون',
        accent_color: '#e94560',
        badge_text: 'تخفيض حصري'
      }
    },
    'countdown-timer': {
      type: 'countdown',
      name: 'عداد العرض التنازلي (24 ساعة)',
      icon: '⏳',
      defaultOrder: 2,
      defaultVisible: true,
      defaultSettings: {
        title: '🔥 عرض خاص لفترة محدودة',
        message: 'ينتهي العرض وتخفيض السعر خلال:',
        end_at: '',
        accent_color: '#e94560'
      }
    },
    'fast-order-form': {
      type: 'order-form',
      name: 'استمارة الطلب السريع (الدفع عند الاستلام)',
      icon: '📝',
      defaultOrder: 3,
      defaultVisible: true,
      defaultSettings: {
        title: 'استمارة الطلب السريع (الدفع عند الاستلام)',
        badge_text: '⚡ تأكيد فوري وسريع',
        delivery_note: 'التوصيل متوفر لجميع الولايات مع خياري التوصيل للمنزل أو المكتب',
        submit_btn_text: '🛒 تأكيد الطلب الآن (الدفع عند الاستلام)',
        show_quantity_selector: true,
        show_pricing_tiers: true,
        tier1_enabled: true,
        tier1_qty: 1,
        tier1_label: '1 قطعة (شراء عادي)',
        tier1_price: null,
        tier1_subtext: 'السعر القياسي',
        tier1_free_shipping_mode: 'none',
        tier2_enabled: true,
        tier2_qty: 2,
        tier2_label: '2 قطع (الأكثر طلباً ⭐)',
        tier2_badge: 'الأكثر طلباً',
        tier2_price: null,
        tier2_subtext: 'العرض الموصى به للمنازل',
        tier2_discount_pct: 10,
        tier2_free_shipping_mode: 'none',
        tier3_enabled: true,
        tier3_qty: 3,
        tier3_label: '3 قطع (توفير كلي 🎁)',
        tier3_badge: 'توفير كلي',
        tier3_price: null,
        tier3_subtext: 'أفضل قيمة وأعلى توفير',
        tier3_discount_pct: 20,
        tier3_free_shipping: true,
        tier3_free_shipping_mode: 'both',
        show_wilaya_selector: true,
        show_email_field: false,
        show_baladiya_field: false,
        show_address_field: false,
        show_delivery_preference: false,
        show_notes_field: false
      }
    },
    'trust-signals': {
      type: 'trust',
      name: 'شارات الأمان والضمان',
      icon: '🛡️',
      defaultOrder: 3,
      defaultVisible: true,
      defaultSettings: {
        badge1_title: 'دفع عند الاستلام',
        badge1_desc: 'عاين طلبك قبل تسليم المبلغ',
        badge2_title: 'شحن سريع لـ 58 ولاية',
        badge2_desc: 'توصيل لباب منزلك أو أقرب مكتب',
        badge3_title: 'ضمان الجودة والأصالة',
        badge3_desc: 'منتجات أصلية ومطابقة 100%'
      }
    },
    'product-gallery': {
      type: 'gallery',
      name: 'معرض الصور التفاعلي',
      icon: '🖼️',
      defaultOrder: 4,
      defaultVisible: true,
      defaultSettings: {
        show_thumbnails: true,
        zoom_enabled: true,
        lightbox_enabled: true,
        auto_slide: false
      }
    },
    'features-grid': {
      type: 'features',
      name: 'شبكة الميزات والإنفوجرافيك',
      icon: '⭐',
      defaultOrder: 5,
      defaultVisible: true,
      defaultSettings: {
        title: 'لماذا تختار هذا المنتج؟',
        features_list: [
          { title: 'جودة استثنائية', desc: 'مصنوع من أفضل الخامات المعتمدة لتدوم طويلاً', icon: '✨' },
          { title: 'سهولة الاستخدام', desc: 'تصميم عملي ومريح يناسب جميع الاستخدامات', icon: '👌' },
          { title: 'أفضل قيمة مقابل السعر', desc: 'سعر منافس وعروض حصرية لعملائنا الكرام', icon: '💎' }
        ]
      }
    },
    'rich-text-details': {
      type: 'details',
      name: 'تفاصيل ومواصفات المنتج',
      icon: '📄',
      defaultOrder: 6,
      defaultVisible: true,
      defaultSettings: {
        title: 'تفاصيل ومواصفات المنتج',
        content: '{{ product.description }}'
      }
    },
    'testimonials-reviews': {
      type: 'reviews',
      name: 'آراء وتقييمات المشترين',
      icon: '💬',
      defaultOrder: 7,
      defaultVisible: true,
      defaultSettings: {
        title: 'آراء وتقييمات المشترين',
        badge_text: 'آراء وتقييمات موثقة من المشترين',
        show_star_ratings: true,
        show_review_images: true
      }
    },
    'faq-accordion': {
      type: 'faq',
      name: 'الأسئلة الشائعة حول الطلب',
      icon: '❓',
      defaultOrder: 8,
      defaultVisible: true,
      defaultSettings: {
        title: 'الأسئلة الشائعة حول الطلب والتوصيل',
        faq_list: [
          { q: 'كيف تتم عملية الشراء والدفع؟', a: 'الأمر بسيط جداً: تملأ استمارة الطلب أعلاه باسمك ورقم هاتفك، ثم يتصل بك فريقنا لتأكيد العنوان وشحن المنتج، والدفع يكون نقداً عند استلام الطرد.' },
          { q: 'كم تستغرق مدة التوصيل؟', a: 'يتم توصيل الطلب خلال 24 إلى 72 ساعة عمل حسب ولايتك وبلديتك.' },
          { q: 'هل يمكنني اختيار التوصيل إلى المكتب أو المنزل؟', a: 'نعم، نوفر خياري التوصيل للمنزل مباشرة أو الاستلام من أقرب مكتب شحن في ولايتك.' },
          { q: 'هل أستطيع معاينة المنتج قبل الدفع؟', a: 'نعم بالتأكيد، يمكنك معاينة الطرد والتأكد من سلامته ومطابقته للطلب قبل تسليم المبلغ للموزع.' }
        ]
      }
    },
    'custom-code': {
      type: 'custom-code',
      name: 'قسم كود مخصص (HTML / Liquid)',
      icon: '💻',
      defaultOrder: 9,
      defaultVisible: false,
      defaultSettings: {
        raw_html: '<div style="text-align:center;padding:24px;background:var(--ds-surface-muted,#f1f5f9);border-radius:12px;"><h3>🎯 قسم إعلاني مخصص</h3><p>يمكنك كتابة أو لصق أي كود HTML أو بانر ترويجي هنا</p></div>',
        custom_css: '',
        container_width: 'contained',
        device_visibility: 'all'
      }
    }
  };

  // ── Build default sections map ──
  function defaultSectionsConfig() {
    var config = {};
    Object.keys(SECTION_REGISTRY).forEach(function(secKey) {
      var def = SECTION_REGISTRY[secKey];
      config[secKey] = {
        type: def.type,
        name: def.name,
        icon: def.icon,
        enabled: def.defaultVisible,
        order: def.defaultOrder,
        settings: JSON.parse(JSON.stringify(def.defaultSettings))
      };
    });
    return config;
  }

  // ── Build a default token object from schema defaults ──
  function defaultTokens() {
    var t = { colors: {}, fonts: {}, spacing: {}, radius: {}, shadow: {}, components: {}, images: {}, icons: {}, sections: defaultSectionsConfig() };
    COLOR_TOKENS.forEach(function (c) { t.colors[c.key] = c.def; });
    FONT_TOKENS.forEach(function (f) { t.fonts[f.key] = f.def; });
    SPACING_TOKENS.forEach(function (s) { t.spacing[s.key] = s.def; });
    RADIUS_TOKENS.forEach(function (r) { t.radius[r.key] = r.def; });
    SHADOW_TOKENS.forEach(function (s) { t.shadow[s.key] = s.def; });
    COMPONENT_TOKENS.forEach(function (c) {
      t.components[c.key] = {};
      c.props.forEach(function (p) { t.components[c.key][p.key] = p.def; });
    });
    IMAGE_TOKENS.forEach(function (img) { t.images[img.key] = img.def; });
    ICON_TOKENS.forEach(function (ic) { t.icons[ic.key] = ic.def; });
    return t;
  }

  // ── Build dark-mode variant tokens ──
  function darkTokens() {
    return {
      primary: '#818cf8', accent: '#a5b4fc',
      background: '#0f0f1a', surface: '#1a1a2e',
      text: '#e8e6ff', textMuted: '#9d9bc0', textSubtle: '#6b6a8a',
      border: '#2d2b4e', secondary: '#e94560',
      success: '#22c55e', warning: '#f59e0b', danger: '#ef4444', info: '#3b82f6'
    };
  }

  function isColor(v) {
    if (typeof v !== 'string') return false;
    return /^(#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})|rgb|rgba|hsl|hsla|var\()/i.test(v.trim());
  }

  function coerceColor(v, fallback) {
    if (isColor(v)) return v.trim();
    return fallback;
  }

  // ── Normalize a partial theme object to full token set ──
  function normalizeTokens(input) {
    input = input || {};
    var base = defaultTokens();
    if (input.colors) {
      COLOR_TOKENS.forEach(function (c) {
        if (input.colors[c.key] != null) base.colors[c.key] = coerceColor(input.colors[c.key], base.colors[c.key]);
      });
    }
    if (input.fonts) {
      FONT_TOKENS.forEach(function (f) {
        if (input.fonts[f.key]) base.fonts[f.key] = String(input.fonts[f.key]);
      });
    }
    if (input.spacing) Object.assign(base.spacing, input.spacing);
    if (input.radius) Object.assign(base.radius, input.radius);
    if (input.shadow) Object.assign(base.shadow, input.shadow);
    if (input.components) {
      COMPONENT_TOKENS.forEach(function (c) {
        if (input.components[c.key]) Object.assign(base.components[c.key], input.components[c.key]);
      });
    }
    if (input.images) {
      IMAGE_TOKENS.forEach(function (img) {
        if (input.images[img.key] != null) base.images[img.key] = String(input.images[img.key]);
      });
    }
    if (input.icons) {
      ICON_TOKENS.forEach(function (ic) {
        if (input.icons[ic.key] != null) base.icons[ic.key] = String(input.icons[ic.key]);
      });
    }
    if (input.sections && typeof input.sections === 'object') {
      var defSec = defaultSectionsConfig();
      Object.keys(input.sections).forEach(function(secKey) {
        var userSec = input.sections[secKey];
        if (defSec[secKey]) {
          defSec[secKey].enabled = typeof userSec.enabled === 'boolean' ? userSec.enabled : defSec[secKey].enabled;
          defSec[secKey].order = typeof userSec.order === 'number' ? userSec.order : defSec[secKey].order;
          if (userSec.settings && typeof userSec.settings === 'object') {
            Object.assign(defSec[secKey].settings, userSec.settings);
          }
        } else {
          defSec[secKey] = userSec;
        }
      });
      base.sections = defSec;
    }
    return base;
  }

  var ThemeSchema = {
    FONT_OPTIONS: FONT_OPTIONS,
    COLOR_TOKENS: COLOR_TOKENS,
    FONT_TOKENS: FONT_TOKENS,
    SPACING_TOKENS: SPACING_TOKENS,
    RADIUS_TOKENS: RADIUS_TOKENS,
    SHADOW_TOKENS: SHADOW_TOKENS,
    COMPONENT_TOKENS: COMPONENT_TOKENS,
    IMAGE_TOKENS: IMAGE_TOKENS,
    ICON_TOKENS: ICON_TOKENS,
    SECTION_REGISTRY: SECTION_REGISTRY,
    defaultSectionsConfig: defaultSectionsConfig,
    defaultTokens: defaultTokens,
    darkTokens: darkTokens,
    isColor: isColor,
    coerceColor: coerceColor,
    normalizeTokens: normalizeTokens
  };

  global.ThemeSchema = ThemeSchema;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ThemeSchema;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
