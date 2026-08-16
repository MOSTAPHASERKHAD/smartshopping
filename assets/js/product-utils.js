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
      var utm = {};
      ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].forEach(function(k){
        var v = p.get(k);
        if (v) utm[k] = v;
      });
      if (Object.keys(utm).length > 0) {
        localStorage.setItem('sk_utm', JSON.stringify(utm));
      }

      // Meta Click ID (fbclid -> fbc)
      var fbclid = p.get('fbclid');
      if (fbclid) {
        var creationTime = Date.now();
        var fbc = 'fb.1.' + creationTime + '.' + fbclid;
        localStorage.setItem('sk_fbc', fbc);
        try {
          document.cookie = '_fbc=' + encodeURIComponent(fbc) + ';path=/;max-age=7776000;SameSite=Lax';
        } catch(_) {}
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
      return JSON.parse(localStorage.getItem('sk_utm') || '{}');
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
    var val = Number(num) || 0;
    var cur = currency || 'د.ج';
    return val.toLocaleString('fr-DZ') + ' ' + cur;
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
    formatPrice: formatPrice
  };

  for (var key in exports) {
    root[key] = exports[key];
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
