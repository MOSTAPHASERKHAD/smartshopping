/**
 * Smart Shopping / SmartKiosk
 * Shared Product Utilities & Helpers
 * assets/js/product-utils.js
 */

(function(root) {
  'use strict';

  // ── 58 Algerian Wilayas ──
  var WILAYAS = [
    {code:"01",ar:"أدرار",en:"Adrar"},{code:"02",ar:"الشلف",en:"Chlef"},
    {code:"03",ar:"الأغواط",en:"Laghouat"},{code:"04",ar:"أم البواقي",en:"Oum El Bouaghi"},
    {code:"05",ar:"باتنة",en:"Batna"},{code:"06",ar:"بجاية",en:"Bejaia"},
    {code:"07",ar:"بسكرة",en:"Biskra"},{code:"08",ar:"بشار",en:"Bechar"},
    {code:"09",ar:"البليدة",en:"Blida"},{code:"10",ar:"البويرة",en:"Bouira"},
    {code:"11",ar:"تمنراست",en:"Tamanrasset"},{code:"12",ar:"تبسة",en:"Tebessa"},
    {code:"13",ar:"تلمسان",en:"Tlemcen"},{code:"14",ar:"تيارت",en:"Tiaret"},
    {code:"15",ar:"تيزي وزو",en:"Tizi Ouzou"},{code:"16",ar:"الجزائر",en:"Alger"},
    {code:"17",ar:"الجلفة",en:"Djelfa"},{code:"18",ar:"جيجل",en:"Jijel"},
    {code:"19",ar:"سطيف",en:"Sétif"},{code:"20",ar:"سعيدة",en:"Saïda"},
    {code:"21",ar:"سكيكدة",en:"Skikda"},{code:"22",ar:"سيدي بلعباس",en:"Sidi Bel Abbès"},
    {code:"23",ar:"عنابة",en:"Annaba"},{code:"24",ar:"قالمة",en:"Guelma"},
    {code:"25",ar:"قسنطينة",en:"Constantine"},{code:"26",ar:"المدية",en:"Médéa"},
    {code:"27",ar:"مستغانم",en:"Mostaganem"},{code:"28",ar:"المسيلة",en:"M'sila"},
    {code:"29",ar:"معسكر",en:"Mascara"},{code:"30",ar:"ورقلة",en:"Ouargla"},
    {code:"31",ar:"وهران",en:"Oran"},{code:"32",ar:"البيض",en:"El Bayadh"},
    {code:"33",ar:"إليزي",en:"Illizi"},{code:"34",ar:"برج بوعريريج",en:"Bordj Bou Arréridj"},
    {code:"35",ar:"بومرداس",en:"Boumerdès"},{code:"36",ar:"الطارف",en:"El Tarf"},
    {code:"37",ar:"تندوف",en:"Tindouf"},{code:"38",ar:"تيسمسيلت",en:"Tissemsilt"},
    {code:"39",ar:"الوادي",en:"El Oued"},{code:"40",ar:"خنشلة",en:"Khenchela"},
    {code:"41",ar:"سوق أهراس",en:"Souk Ahras"},{code:"42",ar:"تيبازة",en:"Tipaza"},
    {code:"43",ar:"ميلة",en:"Mila"},{code:"44",ar:"عين الدفلى",en:"Aïn Defla"},
    {code:"45",ar:"النعامة",en:"Naâma"},{code:"46",ar:"عين تموشنت",en:"Aïn Témouchent"},
    {code:"47",ar:"غرداية",en:"Ghardaïa"},{code:"48",ar:"غليزان",en:"Relizane"},
    {code:"49",ar:"تيميمون",en:"Timimoun"},{code:"50",ar:"برج باجي مختار",en:"Bordj Badji Mokhtar"},
    {code:"51",ar:"أولاد جلال",en:"Ouled Djellal"},{code:"52",ar:"بني عباس",en:"Béni Abbès"},
    {code:"53",ar:"عين صالح",en:"In Salah"},{code:"54",ar:"عين قزام",en:"In Guezzam"},
    {code:"55",ar:"توقرت",en:"Touggourt"},{code:"56",ar:"جانت",en:"Djanet"},
    {code:"57",ar:"المغير",en:"El M'Ghair"},{code:"58",ar:"المنيعة",en:"El Meniaa"}
  ];

  /**
   * Normalizes raw product object from Cloudflare Worker API/D1 into a unified UI model.
   * Safe against missing fields, malformed JSON, arrays vs strings, etc.
   * @param {object} p - Raw product object
   * @returns {object|null} Normalized product
   */
  function normalizeProduct(p) {
    if (!p || typeof p !== 'object') return null;

    var gallery = [];
    try {
      if (Array.isArray(p.gallery_json)) {
        gallery = p.gallery_json.filter(function(u){ return u && typeof u === 'string'; });
      } else if (typeof p.gallery_json === 'string' && p.gallery_json.trim()) {
        var parsed = JSON.parse(p.gallery_json);
        if (Array.isArray(parsed)) {
          gallery = parsed.filter(function(u){ return u && typeof u === 'string'; });
        }
      }
    } catch(e) {
      gallery = [];
    }

    // Compile all images into an ordered array
    var allImages = [];
    if (p.image_url && typeof p.image_url === 'string' && p.image_url.trim()) {
      allImages.push(p.image_url.trim());
    } else if (p.image1 && typeof p.image1 === 'string' && p.image1.trim()) {
      allImages.push(p.image1.trim());
    }

    gallery.forEach(function(imgUrl){
      if (imgUrl && typeof imgUrl === 'string') {
        var clean = imgUrl.trim();
        if (clean && allImages.indexOf(clean) === -1) {
          allImages.push(clean);
        }
      }
    });

    ['image2','image3','image4','image5','image6'].forEach(function(k){
      if (p[k] && typeof p[k] === 'string') {
        var clean = p[k].trim();
        if (clean && allImages.indexOf(clean) === -1) {
          allImages.push(clean);
        }
      }
    });

    var title = (p.title_ar || p.name || p.title_en || '') + '';
    var cat   = (p.category_ar || p.category || p.category_en || '') + '';
    var desc  = (p.desc_ar || p.description_long || p.description || p.desc_en || '') + '';

    var priceNum = typeof p.price === 'number' ? p.price : (parseFloat(p.price) || 0);
    var oldPriceNum = (p.price_old != null && p.price_old !== '') ? (typeof p.price_old === 'number' ? p.price_old : parseFloat(p.price_old)) :
                      (p.old_price != null && p.old_price !== '') ? (typeof p.old_price === 'number' ? p.old_price : parseFloat(p.old_price)) : null;

    return Object.assign({}, p, {
      id:          p.id,
      name:        p.name || title,
      title_ar:    p.title_ar != null ? p.title_ar : title,
      title_en:    p.title_en != null ? p.title_en : (p.name != null ? p.name : title),
      category:    cat,
      category_ar: p.category_ar != null ? p.category_ar : cat,
      category_en: p.category_en != null ? p.category_en : (p.category != null ? p.category : cat),
      image1:      allImages[0] || p.image_url || p.image1 || '',
      image2:      allImages[1] || '',
      image3:      allImages[2] || '',
      image4:      allImages[3] || '',
      image5:      allImages[4] || '',
      image6:      allImages[5] || '',
      images:      allImages,
      price:       priceNum,
      old_price:   (oldPriceNum && oldPriceNum > priceNum) ? oldPriceNum : null,
      price_old:   (oldPriceNum && oldPriceNum > priceNum) ? oldPriceNum : null,
      desc_ar:     p.desc_ar != null ? p.desc_ar : desc,
      desc_en:     p.desc_en != null ? p.desc_en : desc,
      description: p.description || desc,
      description_long: p.description_long || desc,
      variant_options: (function() {
        if (Array.isArray(p.variant_options)) return p.variant_options;
        if (typeof p.variant_options === 'string' && p.variant_options.trim()) {
          try { return JSON.parse(p.variant_options); } catch(_) {}
        }
        return [];
      })(),
      pricing_tiers: (function() {
        if (Array.isArray(p.pricing_tiers)) return p.pricing_tiers;
        if (typeof p.pricing_tiers === 'string' && p.pricing_tiers.trim()) {
          try { return JSON.parse(p.pricing_tiers); } catch(_) {}
        }
        if (p.landing_config && p.landing_config.pricing_tiers) {
          return p.landing_config.pricing_tiers;
        }
        return [];
      })(),
      stock:       p.stock != null ? parseInt(p.stock, 10) : -1,
      sku:         p.sku || ''
    });
  }

  /**
   * Safe cookie retrieval
   */
  function getCookie(name) {
    try {
      if (typeof document === 'undefined') return '';
      var match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
      return match ? decodeURIComponent(match[1]) : '';
    } catch(e) {
      return '';
    }
  }

  /**
   * Capture standard UTM query parameters and Meta fbclid from URL into localStorage and cookies
   */
  function captureUTM() {
    try {
      if (typeof window === 'undefined' || !window.location) return;
      var p = new URLSearchParams(window.location.search);
      var utm = getUTM();
      ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].forEach(function(k){
        var v = p.get(k);
        if (v) utm[k] = v;
      });

      // Session ID generation / retention
      var sid = '';
      try {
        sid = sessionStorage.getItem('sk_sid') || localStorage.getItem('sk_sid') || '';
        if (!sid) {
          sid = 'sid_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
          sessionStorage.setItem('sk_sid', sid);
          localStorage.setItem('sk_sid', sid);
        }
        utm.session_id = sid;
      } catch(_) {}

      // Meta Click ID (fbclid -> fbc)
      var fbclid = p.get('fbclid');
      if (fbclid) {
        utm.fbclid = fbclid;
        var creationTime = Date.now();
        var fbc = 'fb.1.' + creationTime + '.' + fbclid;
        localStorage.setItem('sk_fbc', fbc);
        try {
          document.cookie = '_fbc=' + encodeURIComponent(fbc) + ';path=/;max-age=7776000;SameSite=Lax';
        } catch(_) {}
      }

      if (Object.keys(utm).length > 0) {
        localStorage.setItem('sk_utm', JSON.stringify(utm));
      }
    } catch(e) {}
  }

  /**
   * Retrieve captured UTM object from localStorage
   * @returns {object} UTM map
   */
  function getUTM() {
    try {
      if (typeof localStorage === 'undefined') return {};
      var utm = JSON.parse(localStorage.getItem('sk_utm') || '{}');
      if (!utm.session_id) {
        try {
          utm.session_id = (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('sk_sid') : '') ||
                           (typeof localStorage !== 'undefined' ? localStorage.getItem('sk_sid') : '') || '';
        } catch(_) {}
      }
      return utm;
    } catch(e) {
      return {};
    }
  }

  /**
   * Retrieve captured Meta Click ID (fbc) and Browser ID (fbp)
   * @returns {{ fbc: string, fbp: string }}
   */
  function getMetaTracking() {
    var fbc = '';
    var fbp = '';
    try {
      // 1. Read fbc from cookie or localStorage fallback
      fbc = getCookie('_fbc') || (typeof localStorage !== 'undefined' ? (localStorage.getItem('sk_fbc') || '') : '') || '';

      // 2. Read fbp from cookie (set by Pixel) or localStorage
      fbp = getCookie('_fbp') || (typeof localStorage !== 'undefined' ? (localStorage.getItem('sk_fbp') || '') : '') || '';
    } catch(e) {}
    return { fbc: fbc, fbp: fbp };
  }

  /**
   * Non-blocking first-party analytics event logger
   * @param {string} apiUrl 
   * @param {string} eventName 
   * @param {string|number} productId 
   * @param {object} extraData 
   */
  function trackAnalyticsEvent(apiUrl, eventName, productId, extraData) {
    try {
      if (typeof window === 'undefined') return;
      var utm = getUTM();
      var meta = getMetaTracking();
      var payload = {
        action: 'track_analytics_event',
        event_name: String(eventName || 'PageView'),
        product_id: productId ? String(productId) : '',
        session_id: utm.session_id || '',
        utm_source: utm.utm_source || '',
        utm_medium: utm.utm_medium || '',
        utm_campaign: utm.utm_campaign || '',
        utm_term: utm.utm_term || '',
        utm_content: utm.utm_content || '',
        fbclid: utm.fbclid || '',
        fbc: meta.fbc || '',
        fbp: meta.fbp || ''
      };
      if (extraData && typeof extraData === 'object') {
        for (var k in extraData) {
          if (payload[k] === undefined) payload[k] = extraData[k];
        }
      }

      var q = [];
      for (var k in payload) {
        if (payload[k] !== undefined && payload[k] !== '') {
          q.push(encodeURIComponent(k) + '=' + encodeURIComponent(payload[k]));
        }
      }
      var qs = q.join('&');
      var baseApi = apiUrl || (window.API_URL || '');
      if (!baseApi) baseApi = 'https://smart-shopping-api.mostaphaserkhad.workers.dev';
      var endpoint = baseApi + (baseApi.indexOf('?') > -1 ? '&' : '?') + qs;
      var bodyStr = JSON.stringify(payload);

      var sent = false;
      if (typeof fetch === 'function') {
        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: bodyStr,
          keepalive: true,
          mode: 'cors'
        }).catch(function() {
          var img = new Image();
          img.src = endpoint;
        });
        sent = true;
      } else if (navigator && typeof navigator.sendBeacon === 'function') {
        try {
          var blob = new Blob([bodyStr], { type: 'application/json' });
          sent = navigator.sendBeacon(endpoint, blob);
        } catch(_) {}
      }

      if (!sent) {
        var img = new Image();
        img.src = endpoint;
      }
    } catch(e) {}
  }

  /**
   * Safely escape text for insertion into HTML attributes/content
   * @param {string} str 
   * @returns {string}
   */
  function escHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Format Algerian Dinar price
   * @param {number} num 
   * @param {string} currency 
   * @returns {string}
   */
  function formatPrice(num, currency) {
    var c = currency || 'DZD';
    var n = Number(num) || 0;
    return n.toLocaleString('fr-DZ') + ' ' + c;
  }

  var YALIDINE_DEFAULT_RATES = {
    "01":{home:1400,office:900},"02":{home:750,office:450},"03":{home:950,office:600},"04":{home:800,office:500},
    "05":{home:800,office:500},"06":{home:750,office:450},"07":{home:900,office:550},"08":{home:1200,office:800},
    "09":{home:550,office:350},"10":{home:700,office:400},"11":{home:1600,office:1100},"12":{home:850,office:550},
    "13":{home:800,office:500},"14":{home:800,office:500},"15":{home:700,office:400},"16":{home:500,office:350},
    "17":{home:850,office:550},"18":{home:800,office:500},"19":{home:750,office:450},"20":{home:850,office:550},
    "21":{home:800,office:500},"22":{home:800,office:500},"23":{home:800,office:500},"24":{home:800,office:500},
    "25":{home:800,office:500},"26":{home:700,office:400},"27":{home:750,office:450},"28":{home:800,office:500},
    "29":{home:800,office:500},"30":{home:1000,office:650},"31":{home:750,office:450},"32":{home:1000,office:650},
    "33":{home:1600,office:1100},"34":{home:750,office:450},"35":{home:550,office:350},"36":{home:850,office:550},
    "37":{home:1600,office:1100},"38":{home:800,office:500},"39":{home:950,office:600},"40":{home:850,office:550},
    "41":{home:850,office:550},"42":{home:550,office:350},"43":{home:800,office:500},"44":{home:750,office:450},
    "45":{home:1000,office:650},"46":{home:800,office:500},"47":{home:950,office:600},"48":{home:750,office:450},
    "49":{home:1400,office:900},"50":{home:1700,office:1200},"51":{home:950,office:600},"52":{home:1400,office:900},
    "53":{home:1500,office:1000},"54":{home:1700,office:1200},"55":{home:1000,office:650},"56":{home:1700,office:1200},
    "57":{home:1000,office:650},"58":{home:1100,office:700}
  };

  /**
   * Universal client-side shipping calculation helper
   * @param {object|string} shippingConfig - storeSettings.shipping_config (JSON or object)
   * @param {string} wilayaCode - 2-digit code '01'-'58'
   * @param {string} deliveryType - 'Home' / 'Office'
   * @param {Array<{ weight?: number, qty?: number }>} items - List of items with optional weights
   * @param {object} legacySettings - storeSettings with shipping_home, shipping_office, shipping_remote
   * @returns {{ cost: number, note: string, ok: boolean, carrier: string, hasWeight: boolean, totalWeight: number }}
   */
  function calculateClientShippingCost(shippingConfig, wilayaCode, deliveryType, items, legacySettings) {
    var normType = String(deliveryType || 'home').toLowerCase() === 'office' ? 'office' : 'home';
    var cleanWilaya = String(wilayaCode || '').padStart(2, '0');
    if (!cleanWilaya || cleanWilaya === '00') return { cost: 0, note: '', ok: true, carrier: '', hasWeight: false, totalWeight: 0 };

    var cfg = null;
    if (typeof shippingConfig === 'string' && shippingConfig.trim()) {
      try { cfg = JSON.parse(shippingConfig); } catch(e) {}
    } else if (shippingConfig && typeof shippingConfig === 'object') {
      cfg = shippingConfig;
    }

    if (!cfg && (!legacySettings || (!Number(legacySettings.shipping_home) && !Number(legacySettings.shipping_office)))) {
      cfg = {
        version: "2.0",
        active_carrier: "yalidine",
        enable_home: true,
        enable_office: true,
        carriers: [{
          id: "yalidine",
          name: "Yalidine Express",
          active: true,
          is_default: true,
          base_weight_kg: 5,
          extra_kg_price: 50,
          rates: YALIDINE_DEFAULT_RATES
        }]
      };
    }

    var hasWeight = false;
    var totalWeight = 0;
    if (Array.isArray(items)) {
      items.forEach(function(it) {
        if (it && it.weight != null && it.weight !== '' && !isNaN(Number(it.weight))) {
          var w = Number(it.weight);
          if (w > 0) {
            hasWeight = true;
            totalWeight += w * (Math.max(1, Number(it.qty) || 1));
          }
        }
      });
    }

    if (cfg && Array.isArray(cfg.carriers) && cfg.carriers.length > 0) {
      if (normType === 'home' && cfg.enable_home === false) {
        return { cost: 0, note: 'التوصيل للمنزل غير متاح', ok: false, carrier: '', hasWeight: false, totalWeight: 0 };
      }
      if (normType === 'office' && cfg.enable_office === false) {
        return { cost: 0, note: 'الاستلام من المكتب غير متاح', ok: false, carrier: '', hasWeight: false, totalWeight: 0 };
      }

      var targetId = cfg.active_carrier;
      var carrier = cfg.carriers.find(function(c){ return c.id === targetId && c.active !== false; });
      if (!carrier) {
        carrier = cfg.carriers.find(function(c){ return c.is_default && c.active !== false; }) || cfg.carriers.find(function(c){ return c.active !== false; });
      }

      if (carrier && carrier.rates) {
        var wilRate = carrier.rates[cleanWilaya] || carrier.rates[String(parseInt(cleanWilaya, 10))];
        if (wilRate && wilRate.active !== false) {
          var base = Number(normType === 'office' ? wilRate.office : wilRate.home) || 0;
          var extraFee = 0;
          if (hasWeight) {
            var limit = Number(carrier.base_weight_kg) > 0 ? Number(carrier.base_weight_kg) : 5;
            if (totalWeight > limit) {
              var extraKg = Math.ceil(totalWeight - limit);
              var extraRate = Number(carrier.extra_kg_price) >= 0 ? Number(carrier.extra_kg_price) : 50;
              extraFee = extraKg * extraRate;
            }
          }
          return {
            cost: Math.max(0, base + extraFee),
            note: '',
            ok: true,
            carrier: carrier.name || carrier.id,
            hasWeight: hasWeight,
            totalWeight: Math.round(totalWeight * 100) / 100
          };
        }
      }
    }

    // Fallback to legacy settings
    var legacy = legacySettings || {};
    var REMOTE_WILAYAS = ['01','08','11','30','33','37','47','50','51','52','53','54','55','56','57','58'];
    var baseLeg = parseInt(legacy['shipping_' + normType], 10) || 0;
    var legCost = 0;
    if (baseLeg > 0) {
      legCost = baseLeg;
      var remote = parseInt(legacy.shipping_remote, 10) || 0;
      if (remote > 0 && REMOTE_WILAYAS.indexOf(cleanWilaya) > -1) {
        legCost += remote;
      }
    }
    return {
      cost: legCost,
      note: legCost > 0 ? '' : 'سعر التوصيل يُحدد بعد التأكيد',
      ok: true,
      carrier: 'Yalidine',
      hasWeight: false,
      totalWeight: 0
    };
  }

  /**
   * Render HTML for Product Variant Swatches
   */
  function renderVariantSwatches(options, activeSelection) {
    if (!options || !Array.isArray(options) || options.length === 0) return '';
    activeSelection = activeSelection || {};

    var html = '<div class="pl-variants-container">';
    options.forEach(function(opt, optIdx) {
      var optId = opt.id || ('opt_' + optIdx);
      var optName = opt.name || 'الخيار';
      var optType = opt.type || (opt.values && opt.values.some(function(v){ return v && typeof v === 'object' && v.color; }) ? 'color' : 'pill');
      var values = Array.isArray(opt.values) ? opt.values : [];
      var firstVal = values[0] ? (typeof values[0] === 'object' ? values[0].name : values[0]) : '';
      var selectedVal = activeSelection[optId] || firstVal;

      html += '<div class="pl-variant-group" data-option-id="' + escHtml(optId) + '">';
      html += '<div class="pl-variant-header">';
      html += '<span>' + escHtml(optName) + ':</span>';
      html += '<span class="pl-variant-selected-val" id="plSelectedVal_' + escHtml(optId) + '">' + escHtml(selectedVal) + '</span>';
      html += '</div>';

      html += '<div class="pl-swatches-list">';
      values.forEach(function(valObj) {
        var vName = typeof valObj === 'object' ? (valObj.name || '') : String(valObj);
        var vColor = typeof valObj === 'object' ? (valObj.color || valObj.color_hex || '') : '';
        var vImage = typeof valObj === 'object' ? (valObj.image || valObj.image_url || '') : '';
        var vPrice = typeof valObj === 'object' ? valObj.price : null;
        var isSelected = (vName === selectedVal);

        if (optType === 'color' && vColor) {
          html += '<button type="button" class="pl-swatch-color' + (isSelected ? ' active' : '') + '" ';
          html += 'style="background-color:' + escHtml(vColor) + (vImage ? ';background-image:url(\'' + escHtml(vImage) + '\')' : '') + '" ';
          html += 'data-option-id="' + escHtml(optId) + '" data-value-name="' + escHtml(vName) + '" ';
          if (vImage) html += 'data-image="' + escHtml(vImage) + '" ';
          if (vPrice != null) html += 'data-price="' + Number(vPrice) + '" ';
          html += 'onclick="onVariantSwatchClick(\'' + escHtml(optId) + '\', \'' + escHtml(vName) + '\', this)" ';
          html += 'title="' + escHtml(vName) + '" aria-label="' + escHtml(vName) + '"></button>';
        } else {
          html += '<button type="button" class="pl-swatch-pill' + (isSelected ? ' active' : '') + '" ';
          html += 'data-option-id="' + escHtml(optId) + '" data-value-name="' + escHtml(vName) + '" ';
          if (vImage) html += 'data-image="' + escHtml(vImage) + '" ';
          if (vPrice != null) html += 'data-price="' + Number(vPrice) + '" ';
          html += 'onclick="onVariantSwatchClick(\'' + escHtml(optId) + '\', \'' + escHtml(vName) + '\', this)">';
          if (vImage) {
            html += '<img src="' + escHtml(vImage) + '" alt="' + escHtml(vName) + '" class="pl-swatch-pill-img">';
          }
          html += '<span>' + escHtml(vName) + '</span>';
          html += '</button>';
        }
      });
      html += '</div></div>';
    });
    html += '</div>';
    return html;
  }

  /**
   * Builds dynamic pricing tiers based on explicit custom tiers or active theme settings
   */
  function isSettingEnabled(val, defaultVal) {
    if (val === undefined || val === null || val === '') return (defaultVal !== undefined ? defaultVal : true);
    if (val === false || val === 'false' || val === 0 || val === '0' || val === 'off' || val === 'no' || val === 'disabled') return false;
    return true;
  }

  /**
   * Universal resolution for granular Free Shipping Mode
   * Values: 'none' | 'home' | 'office' | 'both'
   */
  function resolveFreeShippingMode(modeVal, legacyBool) {
    if (modeVal !== undefined && modeVal !== null && modeVal !== '') {
      var m = String(modeVal).toLowerCase().trim();
      if (m === 'home' || m === 'office' || m === 'both' || m === 'none') {
        return m;
      }
    }
    if (legacyBool === true || legacyBool === 'true' || legacyBool === 1 || legacyBool === '1') {
      return 'both';
    }
    return 'none';
  }

  /**
   * Builds dynamic pricing tiers based on explicit custom tiers or active theme settings
   * Hierarchy:
   * 1. Product explicit offer price (landing_config.pricing_tiers[].price)
   * 2. Theme fixed offer price (tier1_price, tier2_price, tier3_price)
   * 3. Legacy percentage fallback (tier2_discount_pct, tier3_discount_pct)
   * 4. Safe default (base_price * qty)
   *
   * Note: discount_pct and savings are DERIVED display metadata, NOT the pricing formula.
   */
  function buildDynamicPricingTiers(basePrice, customTiers, themeSettings) {
    basePrice = Number(basePrice || 0);
    var ts = themeSettings || {};
    var show1 = isSettingEnabled(ts.tier1_enabled, true) && isSettingEnabled(ts.show_tier1, true);
    var show2 = isSettingEnabled(ts.tier2_enabled, true) && isSettingEnabled(ts.show_tier2, true);
    var show3 = isSettingEnabled(ts.tier3_enabled, true) && isSettingEnabled(ts.show_tier3, true);

    // 1. PRODUCT EXPLICIT OVERRIDES (pricing_tiers from landing_config)
    if (customTiers && Array.isArray(customTiers) && customTiers.length > 0) {
      var filtered = customTiers.filter(function(t) {
        return t && t.enabled !== false && t.enabled !== 'false' && t.enabled !== 0 && t.enabled !== '0';
      });
      if (filtered.length > 0) {
        return filtered.map(function(t, idx) {
          var tQty = (t.qty != null && !isNaN(Number(t.qty)) && Number(t.qty) >= 1)
            ? Math.floor(Number(t.qty))
            : (idx + 1);
          var tPrice = (t.price != null && !isNaN(Number(t.price)))
            ? Number(t.price)
            : (basePrice * tQty);
          var stdPrice = basePrice * tQty;
          var saveAmount = Math.max(0, stdPrice - tPrice);
          var derivedPct = (stdPrice > 0 && saveAmount > 0) ? Math.round((saveAmount / stdPrice) * 100) : 0;
          var tMode = resolveFreeShippingMode(t.free_shipping_mode, t.free_shipping);
          var isFreeShip = (tMode !== 'none');

          var autoBadge = t.badge || '';
          if (!autoBadge) {
            if (tMode === 'home' && derivedPct > 0) {
              autoBadge = 'شحن مجاني للمنزل + وفر ' + derivedPct + '%';
            } else if (tMode === 'home') {
              autoBadge = 'شحن مجاني للمنزل 🏠';
            } else if (tMode === 'office' && derivedPct > 0) {
              autoBadge = 'شحن مجاني للمكتب + وفر ' + derivedPct + '%';
            } else if (tMode === 'office') {
              autoBadge = 'شحن مجاني للمكتب 🏢';
            } else if (tMode === 'both' && derivedPct > 0) {
              autoBadge = 'شحن مجاني + وفر ' + derivedPct + '%';
            } else if (tMode === 'both') {
              autoBadge = 'شحن مجاني 🚚';
            } else if (derivedPct > 0) {
              autoBadge = 'وفر ' + derivedPct + '%';
            }
          }
          return {
            offer_id: t.offer_id || ('tier-' + tQty + (idx > 0 ? '-' + idx : '')),
            qty: tQty,
            label: t.label || t.name || (tQty + ' قطع'),
            price: tPrice,
            badge: autoBadge,
            subtext: t.subtext || (saveAmount > 0 ? ('توفير ' + saveAmount + ' دج') : 'السعر القياسي'),
            free_shipping_mode: tMode,
            free_shipping: isFreeShip,
            save_amount: saveAmount,
            saving: saveAmount,
            discount_pct: derivedPct
          };
        });
      }
      if (customTiers.length > 0) return [customTiers[0]];
    }

    // 2. THEME SETTINGS (EXPLICIT TIER QUANTITY + FIXED PRICE FIRST + LEGACY FALLBACK)
    var mode1 = resolveFreeShippingMode(ts.tier1_free_shipping_mode, ts.tier1_free_shipping);
    var mode2 = resolveFreeShippingMode(ts.tier2_free_shipping_mode, ts.tier2_free_shipping);
    var legacyFs3 = (ts.tier3_free_shipping !== undefined) ? isSettingEnabled(ts.tier3_free_shipping, true) : false;
    var mode3 = resolveFreeShippingMode(ts.tier3_free_shipping_mode, legacyFs3);

    var q1 = (ts.tier1_qty != null && !isNaN(Number(ts.tier1_qty)) && Number(ts.tier1_qty) >= 1)
      ? Math.floor(Number(ts.tier1_qty)) : 1;
    var q2 = (ts.tier2_qty != null && !isNaN(Number(ts.tier2_qty)) && Number(ts.tier2_qty) >= 1)
      ? Math.floor(Number(ts.tier2_qty)) : 2;
    var q3 = (ts.tier3_qty != null && !isNaN(Number(ts.tier3_qty)) && Number(ts.tier3_qty) >= 1)
      ? Math.floor(Number(ts.tier3_qty)) : 3;

    // Tier 1 Price: Explicit fixed price or basePrice * q1
    var p1 = (ts.tier1_price != null && !isNaN(Number(ts.tier1_price)) && Number(ts.tier1_price) > 0)
      ? Number(ts.tier1_price)
      : (basePrice * q1);

    // Tier 2 Price: Explicit fixed price -> OR legacy percentage fallback
    var p2;
    var d2_derived = 0;
    var std2 = basePrice * q2;
    if (ts.tier2_price != null && !isNaN(Number(ts.tier2_price)) && Number(ts.tier2_price) > 0) {
      p2 = Number(ts.tier2_price);
      if (std2 > p2) d2_derived = Math.round(((std2 - p2) / std2) * 100);
    } else {
      // Legacy Percentage Fallback
      var d2 = (ts.tier2_discount_pct != null && !isNaN(Number(ts.tier2_discount_pct)))
        ? Math.max(0, Math.min(100, Number(ts.tier2_discount_pct))) : 10;
      p2 = Math.round(std2 * (1 - d2 / 100));
      d2_derived = d2;
    }

    // Tier 3 Price: Explicit fixed price -> OR legacy percentage fallback
    var p3;
    var d3_derived = 0;
    var std3 = basePrice * q3;
    if (ts.tier3_price != null && !isNaN(Number(ts.tier3_price)) && Number(ts.tier3_price) > 0) {
      p3 = Number(ts.tier3_price);
      if (std3 > p3) d3_derived = Math.round(((std3 - p3) / std3) * 100);
    } else {
      // Legacy Percentage Fallback
      var d3 = (ts.tier3_discount_pct != null && !isNaN(Number(ts.tier3_discount_pct)))
        ? Math.max(0, Math.min(100, Number(ts.tier3_discount_pct))) : 20;
      p3 = Math.round(std3 * (1 - d3 / 100));
      d3_derived = d3;
    }

    function formatTierBadge(mode, derivedPct) {
      if (mode === 'home') return (derivedPct > 0 ? ('شحن مجاني للمنزل + خصم ' + derivedPct + '%') : 'شحن مجاني للمنزل 🏠');
      if (mode === 'office') return (derivedPct > 0 ? ('شحن مجاني للمكتب + خصم ' + derivedPct + '%') : 'شحن مجاني للمكتب 🏢');
      if (mode === 'both') return (derivedPct > 0 ? ('شحن مجاني + خصم ' + derivedPct + '%') : 'شحن مجاني 🚚');
      return (derivedPct > 0 ? ('وفر ' + derivedPct + '%') : '');
    }

    var defaultBadge2 = formatTierBadge(mode2, d2_derived);
    var defaultBadge3 = formatTierBadge(mode3, d3_derived);

    var label1 = ts.tier1_label || (q1 + ' قطعة (شراء عادي)');
    var subtext1 = ts.tier1_subtext || 'السعر القياسي';

    var label2 = ts.tier2_label || (q2 + ' قطع (الأكثر طلباً ⭐)');
    var badge2 = (ts.tier2_badge !== undefined && ts.tier2_badge !== null && ts.tier2_badge !== '') ? ts.tier2_badge : defaultBadge2;
    var subtext2 = ts.tier2_subtext || 'العرض الموصى به للمنازل';

    var label3 = ts.tier3_label || (q3 + ' قطع (توفير كلي 🎁)');
    var badge3 = (ts.tier3_badge !== undefined && ts.tier3_badge !== null && ts.tier3_badge !== '') ? ts.tier3_badge : defaultBadge3;
    var subtext3 = ts.tier3_subtext || 'أفضل قيمة وأعلى توفير';

    var list = [];
    if (show1) {
      var save1 = Math.max(0, (basePrice * q1) - p1);
      list.push({ offer_id: 'tier-1', qty: q1, label: label1, price: p1, subtext: subtext1, free_shipping_mode: mode1, free_shipping: (mode1 !== 'none'), discount_pct: 0, saving: save1 });
    }
    if (show2) {
      var save2 = Math.max(0, (basePrice * q2) - p2);
      list.push({ offer_id: 'tier-2', qty: q2, label: label2, price: p2, badge: badge2, subtext: subtext2, free_shipping_mode: mode2, free_shipping: (mode2 !== 'none'), discount_pct: d2_derived, saving: save2 });
    }
    if (show3) {
      var save3 = Math.max(0, (basePrice * q3) - p3);
      list.push({ offer_id: 'tier-3', qty: q3, label: label3, price: p3, free_shipping_mode: mode3, free_shipping: (mode3 !== 'none'), badge: badge3, subtext: subtext3, discount_pct: d3_derived, saving: save3 });
    }

    if (list.length === 0) {
      list.push({ offer_id: 'tier-1', qty: q1, label: label1, price: p1, subtext: subtext1, free_shipping_mode: mode1, free_shipping: (mode1 !== 'none'), discount_pct: 0, saving: 0 });
    }

    return list;
  }

  /**
   * Render HTML for Quantity Breaks & Bundle Offers
   */
  function renderQuantityBreaks(tiers, basePrice, activeQty, themeSettings, activeOfferId) {
    basePrice = Number(basePrice || 0);
    activeQty = Number(activeQty || 1);

    tiers = buildDynamicPricingTiers(basePrice, tiers, themeSettings);

    var html = '<div class="pl-bundles-container">';
    html += '<div class="pl-bundle-header"><span>🎁 اختر الكمية والعرض المناسب:</span></div>';
    html += '<div class="pl-tier-cards-grid">';

    tiers.forEach(function(tier, idx) {
      var tQty = Number(tier.qty || (idx + 1));
      var tOfferId = tier.offer_id || ('tier-' + tQty + (idx > 0 ? '-' + idx : ''));
      var isSelected = activeOfferId ? (tOfferId === activeOfferId) : (tQty === activeQty);
      var tPrice = tier.price != null ? Number(tier.price) : (basePrice * tQty);
      var tLabel = tier.label || tier.name || (tQty + ' قطع');
      var tSubtext = tier.subtext || '';
      var tBadge = tier.badge || '';
      var tMode = tier.free_shipping_mode || (tier.free_shipping ? 'both' : 'none');
      var tFreeShip = (tMode !== 'none');

      var safeOfferId = escHtml(tOfferId).replace(/'/g, "\\'");
      var safeLabel = escHtml(tLabel).replace(/'/g, "\\'");

      html += '<div class="pl-tier-card' + (isSelected ? ' active' : '') + '" onclick="onSelectQuantityTier(' + tQty + ', ' + tPrice + ', ' + tFreeShip + ', \'' + safeOfferId + '\', \'' + safeLabel + '\', \'' + tMode + '\')" data-qty="' + tQty + '" data-offer-id="' + escHtml(tOfferId) + '">';
      if (tBadge) {
        html += '<div class="pl-tier-badge-pill">' + escHtml(tBadge) + '</div>';
      }
      html += '<div class="pl-tier-radio-group">';
      html += '<input type="radio" name="plBundleTier" class="pl-tier-radio" value="' + tQty + '" ' + (isSelected ? 'checked' : '') + '>';
      html += '<div>';
      html += '<div class="pl-tier-label">' + escHtml(tLabel) + '</div>';
      if (tSubtext) html += '<div class="pl-tier-subtext">' + escHtml(tSubtext) + '</div>';
      if (tMode === 'home') {
        html += '<div class="pl-tier-free-shipping"><span>🏠</span> <span>توصيل مجاني للمنزل</span></div>';
      } else if (tMode === 'office') {
        html += '<div class="pl-tier-free-shipping"><span>🏢</span> <span>توصيل مجاني للمكتب</span></div>';
      } else if (tMode === 'both') {
        html += '<div class="pl-tier-free-shipping"><span>🚚</span> <span>توصيل مجاني للباب والمكتب</span></div>';
      }
      html += '</div></div>';

      html += '<div class="pl-tier-pricing">';
      html += '<div class="pl-tier-price">' + formatPrice(tPrice) + '</div>';
      html += '</div>';

      html += '</div>';
    });

    html += '</div></div>';
    return html;
  }

  /**
   * Authoritatively calculate tier pricing and savings
   */
  function calculateTierSubtotal(basePrice, qty, tiers, themeSettings, offerId, deliveryType) {
    basePrice = Number(basePrice || 0);
    qty = Math.max(1, parseInt(qty || 1, 10));

    var effectiveTiers = (tiers && Array.isArray(tiers) && tiers.length > 0)
      ? buildDynamicPricingTiers(basePrice, tiers, themeSettings)
      : buildDynamicPricingTiers(basePrice, null, themeSettings);

    if (effectiveTiers && Array.isArray(effectiveTiers) && effectiveTiers.length > 0) {
      var matchedTier = null;
      if (offerId) {
        matchedTier = effectiveTiers.find(function(t, idx) {
          var tId = t.offer_id || ('tier-' + (t.qty || (idx + 1)) + (idx > 0 ? '-' + idx : ''));
          return String(tId) === String(offerId);
        });
      }
      if (!matchedTier) {
        matchedTier = effectiveTiers.find(function(t) { return Number(t.qty) === qty; });
      }

      if (matchedTier) {
        var tierPrice = (matchedTier.price != null && !isNaN(Number(matchedTier.price)))
          ? Number(matchedTier.price)
          : (basePrice * qty);
        var standardPrice = basePrice * qty;
        var saveAmount = Math.max(0, standardPrice - tierPrice);
        var mode = matchedTier.free_shipping_mode || (matchedTier.free_shipping ? 'both' : 'none');
        var normType = String(deliveryType || '').toLowerCase();
        var isFreeForDelivery = false;
        if (mode === 'both') isFreeForDelivery = true;
        else if (mode === 'home' && normType === 'home') isFreeForDelivery = true;
        else if (mode === 'office' && normType === 'office') isFreeForDelivery = true;

        return {
          subtotal: tierPrice,
          standardTotal: standardPrice,
          saveAmount: saveAmount,
          freeShipping: Boolean(matchedTier.free_shipping),
          freeShippingMode: mode,
          isFreeForDelivery: isFreeForDelivery,
          tier: matchedTier
        };
      }
    }

    return {
      subtotal: basePrice * qty,
      standardTotal: basePrice * qty,
      saveAmount: 0,
      freeShipping: false,
      freeShippingMode: 'none',
      isFreeForDelivery: false,
      tier: null
    };
  }

  // Universal Export (Browser Global / Node Module)
  var exports = {
    WILAYAS: WILAYAS,
    normalizeProduct: normalizeProduct,
    captureUTM: captureUTM,
    getUTM: getUTM,
    getCookie: getCookie,
    getMetaTracking: getMetaTracking,
    escHtml: escHtml,
    formatPrice: formatPrice,
    calculateClientShippingCost: calculateClientShippingCost,
    trackAnalyticsEvent: trackAnalyticsEvent,
    renderVariantSwatches: renderVariantSwatches,
    isSettingEnabled: isSettingEnabled,
    resolveFreeShippingMode: resolveFreeShippingMode,
    buildDynamicPricingTiers: buildDynamicPricingTiers,
    renderQuantityBreaks: renderQuantityBreaks,
    calculateTierSubtotal: calculateTierSubtotal
  };

  for (var key in exports) {
    root[key] = exports[key];
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
