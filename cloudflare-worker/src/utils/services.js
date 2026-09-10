/**
 * SmartKiosk / Smart Shopping — Central Declarative Service Registry
 * file: cloudflare-worker/src/utils/services.js
 *
 * Declarative specification of external services supported by the Managed Services architecture.
 *
 * Architectural Invariants:
 * - Pure definition only: zero database access, zero fetch(), zero resolver logic, zero side effects.
 * - Zero secrets or credential values: contains only settings key names.
 * - Single-hop governance: services operate strictly in 'own', 'managed', or 'disabled' modes.
 */

/**
 * Valid operating modes for managed services.
 */
export const SERVICE_MODES = Object.freeze({
  OWN: 'own',
  MANAGED: 'managed',
  DISABLED: 'disabled',
});

/**
 * Central declarative registry of all platform services.
 */
export const SERVICE_REGISTRY = Object.freeze({
  anderson: Object.freeze({
    key: 'anderson',
    name: 'Anderson Delivery (EcoTrack)',
    requiredSettings: Object.freeze(['anderson_token', 'anderson_base_url', 'anderson_active']),
    secretSettings: Object.freeze(['anderson_token']),
    supportsManaged: true,
    browserExposed: false,
  }),
  meta_capi: Object.freeze({
    key: 'meta_capi',
    name: 'Meta Conversions API (CAPI)',
    requiredSettings: Object.freeze(['fb_capi_token', 'capi_enabled', 'fb_pixel_id']),
    secretSettings: Object.freeze(['fb_capi_token']),
    supportsManaged: true,
    browserExposed: false,
  }),
  meta_pixel: Object.freeze({
    key: 'meta_pixel',
    name: 'Meta Pixel (Browser)',
    requiredSettings: Object.freeze(['fb_pixel_id']),
    secretSettings: Object.freeze([]),
    supportsManaged: true,
    browserExposed: true,
  }),
  whatsapp: Object.freeze({
    key: 'whatsapp',
    name: 'WhatsApp Order Verification',
    requiredSettings: Object.freeze(['whatsapp_number', 'staff_whatsapp_list']),
    secretSettings: Object.freeze([]),
    supportsManaged: false,
    browserExposed: false,
  }),
  analytics: Object.freeze({
    key: 'analytics',
    name: 'Campaign Analytics',
    requiredSettings: Object.freeze(['fb_capi_token', 'fb_ad_account_id']),
    secretSettings: Object.freeze(['fb_capi_token']),
    supportsManaged: false,
    browserExposed: false,
  }),
});

/**
 * Retrieves the declarative definition for a specific service.
 * Read-only lookup with case-insensitive, trimmed key matching.
 *
 * @param {string} serviceKey - Service identifier (e.g. 'anderson', 'meta_capi')
 * @returns {object|null} The frozen service definition, or null if unknown.
 */
export function getServiceDefinition(serviceKey) {
  if (!serviceKey || typeof serviceKey !== 'string') return null;

  const cleanKey = serviceKey.trim().toLowerCase();

  return SERVICE_REGISTRY[cleanKey] || null;
}

/**
 * Returns an array of all registered service keys.
 *
 * @returns {string[]} List of valid service keys.
 */
export function getRegisteredServiceKeys() {
  return Object.keys(SERVICE_REGISTRY);
}
