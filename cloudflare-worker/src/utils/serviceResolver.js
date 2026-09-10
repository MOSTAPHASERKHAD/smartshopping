/**
 * SmartKiosk / Smart Shopping — Managed Services Resolver
 * file: cloudflare-worker/src/utils/serviceResolver.js
 *
 * Server-authoritative gateway for resolving service configuration and credentials.
 *
 * Architectural Invariants:
 * - Single-hop resolution strictly: 'own' -> merchantId, 'managed' -> tenant_master_default.
 * - Zero chaining: never resolves from a third tenant or secondary provider.
 * - Zero fallback: missing credentials in 'managed' NEVER fall back to merchant;
 *   missing credentials in 'own' NEVER fall back to Master.
 * - Strict tenant verification: only tenants with status = 'active' may resolve services.
 * - Master protection: tenant_master_default is permanently locked to mode = 'own'.
 * - Zero secret disclosure: resolveServiceCredential NEVER returns secret keys or tokens.
 */

import { getServiceDefinition, SERVICE_MODES } from './services.js';
import { DEFAULT_MASTER_TENANT_ID } from './auth.js';

/**
 * Standard error codes returned by the resolver.
 */
export const RESOLVER_ERROR_CODES = Object.freeze({
  TENANT_NOT_FOUND: 'TENANT_NOT_FOUND',
  TENANT_NOT_ACTIVE: 'TENANT_NOT_ACTIVE',
  UNKNOWN_SERVICE: 'UNKNOWN_SERVICE',
  SERVICE_MANAGED_NOT_SUPPORTED: 'SERVICE_MANAGED_NOT_SUPPORTED',
  SERVICE_DISABLED: 'SERVICE_DISABLED',
  SERVICE_CONFIGURATION_MISSING: 'SERVICE_CONFIGURATION_MISSING',
  SERVICE_SECRET_MISSING: 'SERVICE_SECRET_MISSING',
  INVALID_SERVICE_MODE: 'INVALID_SERVICE_MODE',
  INVALID_SECRET_KEY: 'INVALID_SECRET_KEY',
});

/**
 * Resolves configuration and safe non-secret settings for a platform service.
 * Guaranteed to NEVER include tokens, API keys, or secret settings in the return object.
 *
 * @param {object} env - Cloudflare Worker environment containing env.DB
 * @param {string} tenantId - Trusted server-side authenticated tenant identifier
 * @param {string} serviceKey - Target service identifier (e.g. 'anderson', 'meta_capi')
 * @returns {Promise<object>} Resolved service context with non-secret settings or safe error object
 */
export async function resolveServiceCredential(env, tenantId, serviceKey) {
  // 1. Validate tenantId parameter presence
  if (!tenantId || typeof tenantId !== 'string' || !tenantId.trim()) {
    return {
      ok: false,
      serviceKey: serviceKey || null,
      mode: null,
      error: 'معرّف المتجر غير صالح أو مفقود',
      errorCode: RESOLVER_ERROR_CODES.TENANT_NOT_FOUND,
    };
  }

  const cleanTenantId = tenantId.trim();

  // 2. Validate service definition from central declarative registry
  const serviceDef = getServiceDefinition(serviceKey);
  if (!serviceDef) {
    return {
      ok: false,
      serviceKey: serviceKey || null,
      mode: null,
      error: `الخدمة المطلوبة غير معروفة: ${serviceKey}`,
      errorCode: RESOLVER_ERROR_CODES.UNKNOWN_SERVICE,
    };
  }

  // 3. Verify tenant existence and active status in D1 database
  if (!env || !env.DB) {
    return {
      ok: false,
      serviceKey: serviceDef.key,
      mode: null,
      error: 'اتصال قاعدة البيانات غير متاح',
      errorCode: 'DB_UNAVAILABLE',
    };
  }

  const tenantStmt = env.DB.prepare(
    `SELECT id, status FROM tenants WHERE id = ? LIMIT 1`
  ).bind(cleanTenantId);

  const tenantRow = await tenantStmt.first();
  if (!tenantRow) {
    return {
      ok: false,
      serviceKey: serviceDef.key,
      mode: null,
      error: 'المتجر غير موجود',
      errorCode: RESOLVER_ERROR_CODES.TENANT_NOT_FOUND,
    };
  }

  if (tenantRow.status !== 'active') {
    return {
      ok: false,
      serviceKey: serviceDef.key,
      mode: null,
      error: `حساب المتجر غير نشط (الحالة: ${tenantRow.status})`,
      errorCode: RESOLVER_ERROR_CODES.TENANT_NOT_ACTIVE,
    };
  }

  // 4. Query tenant_service_configs for tenant + serviceKey
  const configStmt = env.DB.prepare(`
    SELECT tenant_id, service_key, mode, config_json
    FROM tenant_service_configs
    WHERE tenant_id = ? AND service_key = ?
    LIMIT 1
  `).bind(cleanTenantId, serviceDef.key);

  const configRow = await configStmt.first();

  // Default to 'own' if no row exists in tenant_service_configs
  let mode = configRow ? configRow.mode : SERVICE_MODES.OWN;
  let rawConfigJson = configRow ? configRow.config_json : null;

  // 5. Validate mode value
  if (![SERVICE_MODES.OWN, SERVICE_MODES.MANAGED, SERVICE_MODES.DISABLED].includes(mode)) {
    return {
      ok: false,
      serviceKey: serviceDef.key,
      mode: mode,
      error: `وضع الخدمة غير صالح: ${mode}`,
      errorCode: RESOLVER_ERROR_CODES.INVALID_SERVICE_MODE,
    };
  }

  // 6. Master Tenant Protection
  // Master tenant must ALWAYS operate in 'own' mode. It cannot be managed or disabled.
  if (cleanTenantId === DEFAULT_MASTER_TENANT_ID) {
    if (mode !== SERVICE_MODES.OWN) {
      return {
        ok: false,
        serviceKey: serviceDef.key,
        mode: mode,
        error: 'المتجر الرئيسي للمنصة يجب أن يعمل دائماً بالوضع الخاص (own)',
        errorCode: RESOLVER_ERROR_CODES.INVALID_SERVICE_MODE,
      };
    }
  }

  // 7. Handle 'disabled' mode
  if (mode === SERVICE_MODES.DISABLED) {
    return {
      ok: false,
      serviceKey: serviceDef.key,
      mode: SERVICE_MODES.DISABLED,
      error: `خدمة (${serviceDef.name}) معطلة لهذا المتجر`,
      errorCode: RESOLVER_ERROR_CODES.SERVICE_DISABLED,
    };
  }

  // 8. Handle 'managed' mode capabilities
  if (mode === SERVICE_MODES.MANAGED) {
    if (!serviceDef.supportsManaged) {
      return {
        ok: false,
        serviceKey: serviceDef.key,
        mode: SERVICE_MODES.MANAGED,
        error: `خدمة (${serviceDef.name}) لا تدعم الوضع المُدار (Managed)`,
        errorCode: RESOLVER_ERROR_CODES.SERVICE_MANAGED_NOT_SUPPORTED,
      };
    }
  }

  // 9. Single-Hop Source Determination
  // 'own' -> cleanTenantId
  // 'managed' -> DEFAULT_MASTER_TENANT_ID
  const sourceTenantId = (mode === SERVICE_MODES.MANAGED)
    ? DEFAULT_MASTER_TENANT_ID
    : cleanTenantId;

  // 10. Load required settings strictly from sourceTenantId
  const targetKeys = [...serviceDef.requiredSettings];
  if (targetKeys.includes('fb_pixel_id') && !targetKeys.includes('pixel_id')) {
    targetKeys.push('pixel_id');
  }
  const placeholders = targetKeys.map(() => '?').join(', ');
  const settingsStmt = env.DB.prepare(`
    SELECT key, value FROM settings
    WHERE tenant_id = ? AND key IN (${placeholders})
  `).bind(sourceTenantId, ...targetKeys);

  const { results: settingsRows } = await settingsStmt.all();
  const rawSettingsMap = {};
  for (const row of (settingsRows || [])) {
    rawSettingsMap[row.key] = row.value;
  }

  // Backward compatibility alias: fb_pixel_id <-> pixel_id
  if (!rawSettingsMap.fb_pixel_id && rawSettingsMap.pixel_id) {
    rawSettingsMap.fb_pixel_id = rawSettingsMap.pixel_id;
  }

  // 11. Validate presence of secrets server-side (without exposing them)
  const secretKeySet = new Set(serviceDef.secretSettings || []);
  for (const secretKey of (serviceDef.secretSettings || [])) {
    const val = rawSettingsMap[secretKey];
    if (!val || typeof val !== 'string' || !val.trim()) {
      return {
        ok: false,
        serviceKey: serviceDef.key,
        mode: mode,
        error: mode === SERVICE_MODES.MANAGED
          ? `بيانات الاعتماد للخدمة المُدارة (${serviceDef.name}) غير مهيأة على المنصة`
          : `بيانات الاعتماد للخدمة (${serviceDef.name}) غير مضبوطة في إعدادات متجرك`,
        errorCode: RESOLVER_ERROR_CODES.SERVICE_SECRET_MISSING,
      };
    }
  }

  // Check required non-secret settings
  for (const reqKey of (serviceDef.requiredSettings || [])) {
    if (secretKeySet.has(reqKey)) continue; // Already validated
    const val = rawSettingsMap[reqKey];
    if (val === undefined || val === null || String(val).trim() === '') {
      return {
        ok: false,
        serviceKey: serviceDef.key,
        mode: mode,
        error: mode === SERVICE_MODES.MANAGED
          ? `إعدادات الخدمة المُدارة (${serviceDef.name}) غير مكتملة على المنصة`
          : `إعدادات الخدمة (${serviceDef.name}) غير مكتملة في متجرك`,
        errorCode: RESOLVER_ERROR_CODES.SERVICE_CONFIGURATION_MISSING,
      };
    }
  }

  // 12. Build safeSettings by strictly filtering out all secretSettings
  const safeSettings = {};
  for (const [k, v] of Object.entries(rawSettingsMap)) {
    if (!secretKeySet.has(k)) {
      safeSettings[k] = v;
    }
  }

  // 13. Parse optional config_json safely
  let parsedConfig = null;
  if (rawConfigJson && typeof rawConfigJson === 'string') {
    try {
      parsedConfig = JSON.parse(rawConfigJson);
    } catch (_) {}
  }

  // 14. Return sanitized, structured resolution context (zero secrets)
  return {
    ok: true,
    serviceKey: serviceDef.key,
    mode: mode,
    sourceTenantId: sourceTenantId,
    settings: safeSettings,
    config: parsedConfig,
    metadata: {
      isManaged: (mode === SERVICE_MODES.MANAGED),
      serviceName: serviceDef.name,
      browserExposed: serviceDef.browserExposed,
    },
  };
}

/**
 * Internal server-only helper to fetch an authorized secret credential for execution.
 * MUST NEVER be returned in API responses, rendered in HTML, or logged.
 *
 * @param {object} env - Cloudflare Worker environment
 * @param {string} tenantId - Trusted server-side tenant ID
 * @param {string} serviceKey - Target service key
 * @param {string} secretKey - The secret setting key to retrieve (e.g. 'anderson_token')
 * @returns {Promise<{ ok: boolean, secret?: string, error?: string, errorCode?: string }>}
 */
export async function getServiceSecret(env, tenantId, serviceKey, secretKey) {
  // 1. Resolve general governance first (validates tenant, active status, mode, supportsManaged, presence)
  const resolution = await resolveServiceCredential(env, tenantId, serviceKey);
  if (!resolution.ok) {
    return { ok: false, error: resolution.error, errorCode: resolution.errorCode };
  }

  const serviceDef = getServiceDefinition(serviceKey);
  if (!serviceDef || !serviceDef.secretSettings.includes(secretKey)) {
    return {
      ok: false,
      error: 'المفتاح المطلوب ليس معرفاً كمفتاح سري لهذه الخدمة',
      errorCode: RESOLVER_ERROR_CODES.INVALID_SECRET_KEY,
    };
  }

  // 2. Fetch the secret directly from the resolved source tenant
  const stmt = env.DB.prepare(`
    SELECT value FROM settings
    WHERE tenant_id = ? AND key = ?
    LIMIT 1
  `).bind(resolution.sourceTenantId, secretKey);

  const row = await stmt.first();
  const secretValue = row ? row.value : null;

  if (!secretValue || typeof secretValue !== 'string' || !secretValue.trim()) {
    return {
      ok: false,
      error: 'بيانات الاعتماد السرية غير موجودة',
      errorCode: RESOLVER_ERROR_CODES.SERVICE_SECRET_MISSING,
    };
  }

  return {
    ok: true,
    secret: secretValue.trim(),
  };
}
