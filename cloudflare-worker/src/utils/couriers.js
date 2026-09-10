/**
 * SmartKiosk / Smart Shopping — Courier Adapter Registry
 * file: cloudflare-worker/src/utils/couriers.js
 *
 * Minimal, decoupled registry layer for courier integrations.
 * Allows orders and admin handlers to look up courier drivers dynamically
 * without direct coupling to specific courier driver implementations.
 */

import * as andersonDriver from './anderson.js';

/**
 * Registry of available courier adapters.
 * Each entry provides driver functions and corresponding tenant settings keys.
 */
export const COURIER_REGISTRY = {
  anderson: {
    id: 'anderson',
    name: 'Anderson Delivery',
    driver: andersonDriver,
    settingsKeys: {
      baseUrl: 'anderson_base_url',
      token: 'anderson_token',
      active: 'anderson_active',
    },
  },
};

/**
 * Resolves a courier adapter by identifier (case-insensitive, trimmed).
 *
 * @param {string} courierId - Courier identifier (e.g. 'anderson')
 * @returns {object|null} The courier adapter configuration, or null if unsupported.
 */
export function getCourier(courierId) {
  if (!courierId) return null;

  const key = String(courierId).trim().toLowerCase();

  return COURIER_REGISTRY[key] || null;
}
