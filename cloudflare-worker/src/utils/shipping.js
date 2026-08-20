/**
 * Smart Shopping / SmartKiosk — Shipping Engine
 * file: cloudflare-worker/src/utils/shipping.js
 *
 * Centralized, multi-carrier, admin-driven shipping engine.
 * Supports:
 * - 58 Algerian Wilayas
 * - Home (Domicile) & Stop Desk (Bureau / Agence) delivery methods
 * - Multi-carrier management (Yalidine default, Carrier 2, Carrier 3...)
 * - Strict Weight Rule:
 *     - If product weight is NULL/undefined -> Weight logic is OFF (base wilaya rate only).
 *     - If product weight is > 0 -> Weight logic is ON (base 5kg + extra kg fee).
 * - Multi-tenant isolation & safe fallback to legacy settings.
 */

// ── 58 Algerian Wilayas Reference / Initial Tariff (Yalidine Initial Reference Grid — Fully Editable) ──
export const YALIDINE_REFERENCE_TARIFF = {
  "01": { code: "01", name_ar: "أدرار", name_en: "Adrar", home: 1400, office: 900, active: true },
  "02": { code: "02", name_ar: "الشلف", name_en: "Chlef", home: 750, office: 450, active: true },
  "03": { code: "03", name_ar: "الأغواط", name_en: "Laghouat", home: 950, office: 600, active: true },
  "04": { code: "04", name_ar: "أم البواقي", name_en: "Oum El Bouaghi", home: 800, office: 500, active: true },
  "05": { code: "05", name_ar: "باتنة", name_en: "Batna", home: 800, office: 500, active: true },
  "06": { code: "06", name_ar: "بجاية", name_en: "Béjaïa", home: 750, office: 450, active: true },
  "07": { code: "07", name_ar: "بسكرة", name_en: "Biskra", home: 900, office: 550, active: true },
  "08": { code: "08", name_ar: "بشار", name_en: "Béchar", home: 1200, office: 800, active: true },
  "09": { code: "09", name_ar: "البليدة", name_en: "Blida", home: 550, office: 350, active: true },
  "10": { code: "10", name_ar: "البويرة", name_en: "Bouira", home: 700, office: 400, active: true },
  "11": { code: "11", name_ar: "تمنراست", name_en: "Tamanrasset", home: 1600, office: 1100, active: true },
  "12": { code: "12", name_ar: "تبسة", name_en: "Tébessa", home: 850, office: 550, active: true },
  "13": { code: "13", name_ar: "تلمسان", name_en: "Tlemcen", home: 800, office: 500, active: true },
  "14": { code: "14", name_ar: "تيارت", name_en: "Tiaret", home: 800, office: 500, active: true },
  "15": { code: "15", name_ar: "تيزي وزو", name_en: "Tizi Ouzou", home: 700, office: 400, active: true },
  "16": { code: "16", name_ar: "الجزائر", name_en: "Alger", home: 500, office: 350, active: true },
  "17": { code: "17", name_ar: "الجلفة", name_en: "Djelfa", home: 850, office: 550, active: true },
  "18": { code: "18", name_ar: "جيجل", name_en: "Jijel", home: 800, office: 500, active: true },
  "19": { code: "19", name_ar: "سطيف", name_en: "Sétif", home: 750, office: 450, active: true },
  "20": { code: "20", name_ar: "سعيدة", name_en: "Saïda", home: 850, office: 550, active: true },
  "21": { code: "21", name_ar: "سكيكدة", name_en: "Skikda", home: 800, office: 500, active: true },
  "22": { code: "22", name_ar: "سيدي بلعباس", name_en: "Sidi Bel Abbès", home: 800, office: 500, active: true },
  "23": { code: "23", name_ar: "عنابة", name_en: "Annaba", home: 800, office: 500, active: true },
  "24": { code: "24", name_ar: "قالمة", name_en: "Guelma", home: 800, office: 500, active: true },
  "25": { code: "25", name_ar: "قسنطينة", name_en: "Constantine", home: 800, office: 500, active: true },
  "26": { code: "26", name_ar: "المدية", name_en: "Médéa", home: 700, office: 400, active: true },
  "27": { code: "27", name_ar: "مستغانم", name_en: "Mostaganem", home: 750, office: 450, active: true },
  "28": { code: "28", name_ar: "المسيلة", name_en: "M'Sila", home: 800, office: 500, active: true },
  "29": { code: "29", name_ar: "معسكر", name_en: "Mascara", home: 800, office: 500, active: true },
  "30": { code: "30", name_ar: "ورقلة", name_en: "Ouargla", home: 1000, office: 650, active: true },
  "31": { code: "31", name_ar: "وهران", name_en: "Oran", home: 750, office: 450, active: true },
  "32": { code: "32", name_ar: "البيض", name_en: "El Bayadh", home: 1000, office: 650, active: true },
  "33": { code: "33", name_ar: "إليزي", name_en: "Illizi", home: 1600, office: 1100, active: true },
  "34": { code: "34", name_ar: "برج بوعريريج", name_en: "Bordj Bou Arréridj", home: 750, office: 450, active: true },
  "35": { code: "35", name_ar: "بومرداس", name_en: "Boumerdès", home: 550, office: 350, active: true },
  "36": { code: "36", name_ar: "الطارف", name_en: "El Tarf", home: 850, office: 550, active: true },
  "37": { code: "37", name_ar: "تندوف", name_en: "Tindouf", home: 1600, office: 1100, active: true },
  "38": { code: "38", name_ar: "تيسمسيلت", name_en: "Tissemsilt", home: 800, office: 500, active: true },
  "39": { code: "39", name_ar: "الوادي", name_en: "El Oued", home: 950, office: 600, active: true },
  "40": { code: "40", name_ar: "خنشلة", name_en: "Khenchela", home: 850, office: 550, active: true },
  "41": { code: "41", name_ar: "سوق أهراس", name_en: "Souk Ahras", home: 850, office: 550, active: true },
  "42": { code: "42", name_ar: "تيبازة", name_en: "Tipaza", home: 550, office: 350, active: true },
  "43": { code: "43", name_ar: "ميلة", name_en: "Mila", home: 800, office: 500, active: true },
  "44": { code: "44", name_ar: "عين الدفلى", name_en: "Aïn Defla", home: 750, office: 450, active: true },
  "45": { code: "45", name_ar: "النعامة", name_en: "Naâma", home: 1000, office: 650, active: true },
  "46": { code: "46", name_ar: "عين تموشنت", name_en: "Aïn Témouchent", home: 800, office: 500, active: true },
  "47": { code: "47", name_ar: "غرداية", name_en: "Ghardaïa", home: 950, office: 600, active: true },
  "48": { code: "48", name_ar: "غليزان", name_en: "Relizane", home: 750, office: 450, active: true },
  "49": { code: "49", name_ar: "تيميمون", name_en: "Timimoun", home: 1400, office: 900, active: true },
  "50": { code: "50", name_ar: "برج باجي مختار", name_en: "Bordj Badji Mokhtar", home: 1700, office: 1200, active: true },
  "51": { code: "51", name_ar: "أولاد جلال", name_en: "Ouled Djellal", home: 950, office: 600, active: true },
  "52": { code: "52", name_ar: "بني عباس", name_en: "Béni Abbès", home: 1400, office: 900, active: true },
  "53": { code: "53", name_ar: "عين صالح", name_en: "In Salah", home: 1500, office: 1000, active: true },
  "54": { code: "54", name_ar: "عين قزام", name_en: "In Guezzam", home: 1700, office: 1200, active: true },
  "55": { code: "55", name_ar: "توقرت", name_en: "Touggourt", home: 1000, office: 650, active: true },
  "56": { code: "56", name_ar: "جانت", name_en: "Djanet", home: 1700, office: 1200, active: true },
  "57": { code: "57", name_ar: "المغير", name_en: "El M'Ghair", home: 1000, office: 650, active: true },
  "58": { code: "58", name_ar: "المنيعة", name_en: "El Meniaa", home: 1100, office: 700, active: true },
};

/**
 * Returns a clone of the default shipping configuration.
 */
export function getDefaultShippingConfig() {
  return {
    version: "2.0",
    active_carrier: "yalidine",
    enable_home: true,
    enable_office: true,
    carriers: [
      {
        id: "yalidine",
        name: "Yalidine Express",
        active: true,
        is_default: true,
        base_weight_kg: 5,
        extra_kg_price: 50,
        rates: JSON.parse(JSON.stringify(YALIDINE_REFERENCE_TARIFF))
      }
    ]
  };
}

/**
 * Parses and sanitizes shipping_config string or object.
 * @param {string|object} raw
 * @returns {object|null}
 */
export function parseShippingConfig(raw) {
  if (!raw) return null;
  let cfg = null;
  if (typeof raw === 'string') {
    try {
      cfg = JSON.parse(raw);
    } catch {
      return null;
    }
  } else if (typeof raw === 'object') {
    cfg = raw;
  }
  if (!cfg || !Array.isArray(cfg.carriers) || cfg.carriers.length === 0) {
    return null;
  }
  return cfg;
}

/**
 * Authoritative Server-Side Shipping Calculation.
 *
 * @param {object} params
 * @param {object|string} [params.shippingConfig] - Parsed or raw JSON shipping_config
 * @param {string} [params.carrierId] - Selected or target carrier ID
 * @param {string} params.wilayaCode - 2-digit wilaya code ('01'-'58')
 * @param {string} params.deliveryType - 'home' or 'office'
 * @param {Array<{ id: number|string, qty: number }>} [params.items] - Ordered items
 * @param {Map<number, object>|Array<object>} [params.productsMap] - DB Product objects with real weights
 * @param {object} [params.legacySettings] - Fallback legacy { shipping_home, shipping_office, shipping_remote }
 *
 * @returns {{
 *   ok: boolean,
 *   shippingCost: number,
 *   shippingNote: string,
 *   deliveryCompany: string,
 *   deliveryType: string,
 *   hasWeight: boolean,
 *   totalWeight: number,
 *   extraKg: number,
 *   extraFee: number,
 *   error?: string
 * }}
 */
export function calculateShippingCost({
  shippingConfig,
  carrierId,
  wilayaCode,
  deliveryType = 'home',
  items = [],
  productsMap,
  legacySettings = {}
}) {
  const normType = String(deliveryType || 'home').toLowerCase() === 'office' ? 'office' : 'home';
  const cleanWilaya = String(wilayaCode || '').padStart(2, '0');

  // 1. Calculate Total Weight from authoritative DB products
  let hasWeight = false;
  let totalWeight = 0;

  if (Array.isArray(items) && items.length > 0) {
    for (const item of items) {
      const pId = Number(item.id);
      const qty = Math.max(1, Number(item.qty) || 1);
      let pObj = null;
      if (productsMap instanceof Map) {
        pObj = productsMap.get(pId);
      } else if (Array.isArray(productsMap)) {
        pObj = productsMap.find(p => Number(p.id) === pId);
      }
      if (pObj && pObj.weight !== null && pObj.weight !== undefined && !isNaN(Number(pObj.weight))) {
        const w = Number(pObj.weight);
        if (w > 0) {
          hasWeight = true;
          totalWeight += (w * qty);
        }
      }
    }
  }

  // 2. Try Shipping Config (Multi-carrier dynamic rates)
  let config = parseShippingConfig(shippingConfig);
  if (!config && (!legacySettings || (!Number(legacySettings.shipping_home) && !Number(legacySettings.shipping_office)))) {
    config = getDefaultShippingConfig();
  }

  if (config) {
    // Check if delivery type is enabled globally in config
    if (normType === 'home' && config.enable_home === false) {
      return { ok: false, error: 'التوصيل للمنزل غير متوفر حالياً', shippingCost: 0, shippingNote: '' };
    }
    if (normType === 'office' && config.enable_office === false) {
      return { ok: false, error: 'الاستلام من المكتب غير متوفر حالياً', shippingCost: 0, shippingNote: '' };
    }

    // Find requested or active/default carrier
    const targetId = carrierId || config.active_carrier;
    let carrier = config.carriers.find(c => c.id === targetId && c.active !== false);
    if (!carrier) {
      carrier = config.carriers.find(c => c.is_default && c.active !== false) || config.carriers.find(c => c.active !== false);
    }

    if (carrier && carrier.rates) {
      const wilayaRate = carrier.rates[cleanWilaya] || carrier.rates[String(parseInt(cleanWilaya, 10))];
      if (wilayaRate && wilayaRate.active !== false) {
        const baseRate = Number(normType === 'office' ? wilayaRate.office : wilayaRate.home) || 0;
        let extraKg = 0;
        let extraFee = 0;

        // Strict Weight Rule:
        // If weight exists -> calculate extra weight fee if > base_weight_kg (default 5kg)
        // If weight is NULL -> DO NOT calculate weight, use base rate only
        if (hasWeight) {
          const baseWeightLimit = Number(carrier.base_weight_kg) > 0 ? Number(carrier.base_weight_kg) : 5;
          if (totalWeight > baseWeightLimit) {
            extraKg = Math.ceil(totalWeight - baseWeightLimit);
            const extraRate = Number(carrier.extra_kg_price) >= 0 ? Number(carrier.extra_kg_price) : 50;
            extraFee = extraKg * extraRate;
          }
        }

        const finalCost = Math.max(0, baseRate + extraFee);
        return {
          ok: true,
          shippingCost: finalCost,
          shippingNote: '',
          deliveryCompany: carrier.id || 'yalidine',
          deliveryType: normType,
          hasWeight,
          totalWeight: hasWeight ? Math.round(totalWeight * 100) / 100 : 0,
          extraKg,
          extraFee
        };
      }
    }
  }

  // 3. Fallback: Legacy Flat-rate calculation if shipping_config is missing or rate not found
  const REMOTE_WILAYAS = new Set(['01','08','11','30','33','37','47','50','51','52','53','54','55','56','57','58']);
  const baseLegacy = parseInt(legacySettings['shipping_' + normType], 10) || 0;
  let legacyCost = 0;

  if (baseLegacy > 0) {
    legacyCost = baseLegacy;
    const remote = parseInt(legacySettings.shipping_remote, 10) || 0;
    if (remote > 0 && REMOTE_WILAYAS.has(cleanWilaya)) {
      legacyCost += remote;
    }
  }

  const legacyNote = legacyCost > 0 ? '' : 'سعر التوصيل يُحدد بعد التأكيد هاتفياً';

  return {
    ok: true,
    shippingCost: legacyCost,
    shippingNote: legacyNote,
    deliveryCompany: 'yalidine',
    deliveryType: normType,
    hasWeight: false,
    totalWeight: 0,
    extraKg: 0,
    extraFee: 0
  };
}
