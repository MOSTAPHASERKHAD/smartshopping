/**
 * Smart Shopping — Super Admin & Platform Handlers
 * ملف: src/handlers/super_admin.js
 * 
 * معالجات الإدارة المركزية للمنصة (Platform Oversight & Multi-Tenant Management)
 * ─────────────────────────────────────────────
 * يوفر لوحة تحكم وإحصائيات عامة للمالك الرئيسي (Super Admin)
 * مع ضمان عزل البيانات بنسبة 100% ومنع التجار العاديين من الوصول لبيانات المنصة.
 */

import { DEFAULT_MASTER_TENANT_ID, recordAuditLog } from '../utils/auth.js';
import { ROLES } from '../utils/rbac.js';
import { sanitize } from '../utils/sanitize.js';
import { getServiceDefinition, getRegisteredServiceKeys, SERVICE_MODES, SERVICE_REGISTRY } from '../utils/services.js';

/**
 * التحقق الصارم من صلاحية Super Admin على الخادم
 * @param {object} authSession
 * @returns {boolean}
 */
export function isSuperAdminSession(authSession) {
  if (!authSession) return false;
  // إما جلسة الأدمن الكلاسيكية، أو جلسة مستأجر الماستر بدور OWNER، أو دور SUPER_ADMIN صريح
  if (authSession.isLegacy) return true;
  if (String(authSession.role).toUpperCase() === 'SUPER_ADMIN') return true;
  if (authSession.tenantId === DEFAULT_MASTER_TENANT_ID && String(authSession.role).toUpperCase() === ROLES.OWNER) {
    return true;
  }
  return false;
}

/**
 * [SUPER_ADMIN] استعراض قائمة كافة المتاجر والتجار على المنصة
 */
export async function superListTenants(env, authSession) {
  if (!isSuperAdminSession(authSession)) {
    return {
      ok: false,
      error: 'غير مصرح: هذه العملية مخصصة للمالك الرئيسي للمنصة (Super Admin) فقط',
    };
  }

  // استعلام تجميعي لكافة المتاجر مع حساب عدد المنتجات والطلبات وإجمالي المبيعات
  const tenantsQuery = await env.DB.prepare(`
    SELECT 
      t.id as tenant_id,
      t.name as store_name,
      t.slug,
      t.domain,
      t.status,
      t.plan,
      t.created_at,
      t.updated_at,
      u.id as owner_id,
      u.email as owner_email,
      u.name as owner_name,
      u.status as owner_status,
      u.email_verified_at,
      u.last_login_at,
      (SELECT COUNT(*) FROM products p WHERE p.tenant_id = t.id) as products_count,
      (SELECT COUNT(*) FROM orders o WHERE o.tenant_id = t.id) as orders_count,
      COALESCE((SELECT SUM(o.total) FROM orders o WHERE o.tenant_id = t.id AND o.status != 'cancelled'), 0) as total_revenue
    FROM tenants t
    LEFT JOIN users u ON u.tenant_id = t.id AND u.role = 'OWNER'
    ORDER BY t.created_at DESC
  `).all();

  const tenants = (tenantsQuery.results || []).map(row => ({
    tenant_id: row.tenant_id,
    store_name: row.store_name,
    slug: row.slug,
    domain: row.domain || 'NOT_CONFIGURED',
    status: row.status,
    plan: row.plan,
    created_at: row.created_at,
    updated_at: row.updated_at,
    owner: {
      id: row.owner_id || 'UNKNOWN',
      email: row.owner_email || 'NOT_AVAILABLE',
      name: row.owner_name || '',
      status: row.owner_status || 'active',
      email_verified: !!row.email_verified_at,
      last_login_at: row.last_login_at || 'NEVER',
    },
    metrics: {
      products_count: Number(row.products_count || 0),
      orders_count: Number(row.orders_count || 0),
      total_revenue: Number(row.total_revenue || 0),
    }
  }));

  return {
    ok: true,
    tenants,
    count: tenants.length,
  };
}

/**
 * [SUPER_ADMIN] إحصائيات عامة للمنصة ككل
 */
export async function superPlatformStats(env, authSession) {
  if (!isSuperAdminSession(authSession)) {
    return {
      ok: false,
      error: 'غير مصرح: هذه العملية مخصصة للمالك الرئيسي للمنصة (Super Admin) فقط',
    };
  }

  const [tenantStats, userStats, productStats, orderStats] = await Promise.all([
    env.DB.prepare(`
      SELECT 
        COUNT(*) as total_tenants,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_tenants,
        SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) as suspended_tenants,
        SUM(CASE WHEN plan = 'master' THEN 1 ELSE 0 END) as master_tenants,
        SUM(CASE WHEN plan = 'starter' THEN 1 ELSE 0 END) as starter_tenants,
        SUM(CASE WHEN plan = 'pro' THEN 1 ELSE 0 END) as pro_tenants,
        SUM(CASE WHEN plan = 'enterprise' THEN 1 ELSE 0 END) as enterprise_tenants
      FROM tenants
    `).first(),

    env.DB.prepare(`
      SELECT 
        COUNT(*) as total_users,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_users,
        SUM(CASE WHEN email_verified_at IS NOT NULL THEN 1 ELSE 0 END) as verified_users
      FROM users
    `).first(),

    env.DB.prepare(`SELECT COUNT(*) as total_products FROM products`).first(),

    env.DB.prepare(`
      SELECT 
        COUNT(*) as total_orders,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_orders,
        SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered_orders,
        COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END), 0) as total_platform_gmv
      FROM orders
    `).first(),
  ]);

  return {
    ok: true,
    stats: {
      tenants: {
        total: Number(tenantStats?.total_tenants || 0),
        active: Number(tenantStats?.active_tenants || 0),
        suspended: Number(tenantStats?.suspended_tenants || 0),
        by_plan: {
          master: Number(tenantStats?.master_tenants || 0),
          starter: Number(tenantStats?.starter_tenants || 0),
          pro: Number(tenantStats?.pro_tenants || 0),
          enterprise: Number(tenantStats?.enterprise_tenants || 0),
        }
      },
      users: {
        total: Number(userStats?.total_users || 0),
        active: Number(userStats?.active_users || 0),
        verified: Number(userStats?.verified_users || 0),
      },
      products: {
        total: Number(productStats?.total_products || 0),
      },
      orders: {
        total: Number(orderStats?.total_orders || 0),
        pending: Number(orderStats?.pending_orders || 0),
        delivered: Number(orderStats?.delivered_orders || 0),
        total_gmv: Number(orderStats?.total_platform_gmv || 0),
      }
    }
  };
}

/**
 * [SUPER_ADMIN] تحديث حالة أو باقة مستأجر معين
 */
export async function superUpdateTenant(env, params, authSession) {
  if (!isSuperAdminSession(authSession)) {
    return {
      ok: false,
      error: 'غير مصرح: هذه العملية مخصصة للمالك الرئيسي للمنصة (Super Admin) فقط',
    };
  }

  const targetTenantId = params.target_tenant_id || params.tenant_id;
  const status = params.status;
  const plan   = params.plan;

  if (!targetTenantId) {
    return { ok: false, error: 'معرف المتجر (target_tenant_id) مطلوب' };
  }

  if (targetTenantId === DEFAULT_MASTER_TENANT_ID) {
    return { ok: false, error: 'لا يمكن تعديل أو تعليق المستأجر الرئيسي للمنصة' };
  }

  const updates = [];
  const args = [];

  if (status && ['active', 'suspended', 'archived'].includes(status)) {
    updates.push('status = ?');
    args.push(status);
  }

  if (plan && ['starter', 'pro', 'enterprise'].includes(plan)) {
    updates.push('plan = ?');
    args.push(plan);
  }

  if (updates.length === 0) {
    return { ok: false, error: 'لم يتم توفير حقول صالحة للتعديل (status أو plan)' };
  }

  updates.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')");
  args.push(targetTenantId);

  const result = await env.DB.prepare(`
    UPDATE tenants SET ${updates.join(', ')} WHERE id = ?
  `).bind(...args).run();

  if (result.meta?.changes === 0) {
    return { ok: false, error: 'المتجر غير موجود' };
  }

  return { ok: true, message: 'تم تحديث بيانات المتجر بنجاح' };
}

/**
 * [SUPER_ADMIN] اعتماد وتفعيل متجر جديد (PENDING -> ACTIVE)
 */
export async function superApproveMerchant(env, params, authSession, request) {
  if (!isSuperAdminSession(authSession)) {
    return {
      ok: false,
      error: 'غير مصرح: هذه العملية مخصصة للمالك الرئيسي للمنصة (Super Admin) فقط',
    };
  }

  const targetTenantId = sanitize(params.target_tenant_id || params.tenant_id || '', 60);

  if (!targetTenantId) {
    return { ok: false, error: 'معرف المتجر المستهدف (target_tenant_id) مطلوب' };
  }

  if (targetTenantId === DEFAULT_MASTER_TENANT_ID) {
    return { ok: false, error: 'لا يمكن اعتماد المستأجر الرئيسي للمنصة' };
  }

  // 1. التحقق من وجود المتجر وحالته الحالية
  const targetTenant = await env.DB.prepare(`
    SELECT id, name, slug, domain, status, plan
    FROM tenants
    WHERE id = ?
    LIMIT 1
  `).bind(targetTenantId).first();

  if (!targetTenant) {
    return { ok: false, error: 'المتجر المستهدف غير موجود' };
  }

  if (targetTenant.status !== 'pending') {
    return {
      ok: false,
      error: `لا يمكن اعتماد المتجر لأن حالته الحالية هي (${targetTenant.status}) وليست قيد الانتظار (pending)`,
    };
  }

  // 2. تفعيل المتجر والمستخدم بدور OWNER بشكل ذري (Atomic Batch)
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE tenants
      SET status = 'active', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
      WHERE id = ? AND status = 'pending'
    `).bind(targetTenantId),

    env.DB.prepare(`
      UPDATE users
      SET status = 'active', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
      WHERE tenant_id = ? AND role = 'OWNER'
    `).bind(targetTenantId),
  ]);

  // 3. تطهير الكاش الخاص بالمتجر فقط (Scoped Cache Invalidation)
  const cache = env.CACHE || env.KV;
  if (cache) {
    if (targetTenant.slug) await cache.delete(`tenant:host:${targetTenant.slug}`).catch(() => {});
    if (targetTenant.domain) await cache.delete(`tenant:host:${targetTenant.domain}`).catch(() => {});
    await cache.delete(`tenant:${targetTenantId}:settings_v1`).catch(() => {});
  }

  // 4. تسجيل في سجل التدقيق الأمني
  await recordAuditLog(env.DB, {
    tenant_id: targetTenantId,
    user_id: authSession?.userId || 'super_admin',
    action: 'TENANT_APPROVED',
    resource_type: 'tenant',
    resource_id: targetTenantId,
    metadata: {
      target_tenant_id: targetTenantId,
      store_name: targetTenant.name,
      slug: targetTenant.slug,
      actor_id: authSession?.userId || 'super_admin',
      actor_role: authSession?.role || 'OWNER',
      previous_status: 'pending',
      new_status: 'active',
    },
    request,
  });

  return {
    ok: true,
    message: 'تمت الموافقة على المتجر وتفعيله بنجاح',
    tenant: {
      id: targetTenant.id,
      name: targetTenant.name,
      slug: targetTenant.slug,
      status: 'active',
      plan: targetTenant.plan,
    },
  };
}

/**
 * [SUPER_ADMIN] رفض طلب متجر جديد (PENDING -> REJECTED)
 */
export async function superRejectMerchant(env, params, authSession, request) {
  if (!isSuperAdminSession(authSession)) {
    return {
      ok: false,
      error: 'غير مصرح: هذه العملية مخصصة للمالك الرئيسي للمنصة (Super Admin) فقط',
    };
  }

  const targetTenantId = sanitize(params.target_tenant_id || params.tenant_id || '', 60);
  const reason = sanitize(params.reason || '', 500);

  if (!targetTenantId) {
    return { ok: false, error: 'معرف المتجر المستهدف (target_tenant_id) مطلوب' };
  }

  if (targetTenantId === DEFAULT_MASTER_TENANT_ID) {
    return { ok: false, error: 'لا يمكن رفض المستأجر الرئيسي للمنصة' };
  }

  // 1. التحقق من وجود المتجر وحالته الحالية
  const targetTenant = await env.DB.prepare(`
    SELECT id, name, slug, domain, status, plan
    FROM tenants
    WHERE id = ?
    LIMIT 1
  `).bind(targetTenantId).first();

  if (!targetTenant) {
    return { ok: false, error: 'المتجر المستهدف غير موجود' };
  }

  if (targetTenant.status !== 'pending') {
    return {
      ok: false,
      error: `لا يمكن رفض المتجر لأن حالته الحالية هي (${targetTenant.status}) وليست قيد الانتظار (pending)`,
    };
  }

  // 2. تحديث حالة المتجر إلى rejected دون حذف أي بيانات أو إعدادات
  await env.DB.prepare(`
    UPDATE tenants
    SET status = 'rejected', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
    WHERE id = ? AND status = 'pending'
  `).bind(targetTenantId).run();

  // 3. تطهير الكاش الخاص بالمتجر فقط
  const cache = env.CACHE || env.KV;
  if (cache) {
    if (targetTenant.slug) await cache.delete(`tenant:host:${targetTenant.slug}`).catch(() => {});
    if (targetTenant.domain) await cache.delete(`tenant:host:${targetTenant.domain}`).catch(() => {});
  }

  // 4. تسجيل في سجل التدقيق الأمني متضمناً سبب الرفض
  await recordAuditLog(env.DB, {
    tenant_id: targetTenantId,
    user_id: authSession?.userId || 'super_admin',
    action: 'TENANT_REJECTED',
    resource_type: 'tenant',
    resource_id: targetTenantId,
    metadata: {
      target_tenant_id: targetTenantId,
      store_name: targetTenant.name,
      slug: targetTenant.slug,
      actor_id: authSession?.userId || 'super_admin',
      actor_role: authSession?.role || 'OWNER',
      previous_status: 'pending',
      new_status: 'rejected',
      reason: reason || 'لم يُحدد سبب',
    },
    request,
  });

  return {
    ok: true,
    message: 'تم رفض طلب إنشاء المتجر بنجاح',
    tenant: {
      id: targetTenant.id,
      name: targetTenant.name,
      slug: targetTenant.slug,
      status: 'rejected',
    },
  };
}

/**
 * [SUPER_ADMIN] استعراض قائمة تكوينات الخدمات لمستأجر معين (بدون كشف أي أسرار)
 * @param {object} env
 * @param {object} params
 * @param {object} authSession
 * @returns {Promise<object>}
 */
export async function superListTenantServices(env, params, authSession) {
  if (!isSuperAdminSession(authSession)) {
    return {
      ok: false,
      error: 'غير مصرح: هذه العملية مخصصة للمالك الرئيسي للمنصة (Super Admin) فقط',
      errorCode: 'FORBIDDEN',
    };
  }

  const targetTenantId = sanitize(params?.target_tenant_id || params?.tenant_id || '', 60);
  if (!targetTenantId) {
    return {
      ok: false,
      error: 'معرف المتجر المستهدف (tenant_id) مطلوب',
      errorCode: 'TENANT_ID_REQUIRED',
    };
  }

  // 1. التحقق من وجود المستأجر
  const targetTenant = await env.DB.prepare(`
    SELECT id, name, slug, status, plan
    FROM tenants
    WHERE id = ?
    LIMIT 1
  `).bind(targetTenantId).first();

  if (!targetTenant) {
    return {
      ok: false,
      error: 'المتجر المستهدف غير موجود',
      errorCode: 'TENANT_NOT_FOUND',
    };
  }

  // 2. جلب التكوينات المسجلة في جدول tenant_service_configs
  const configRowsRes = await env.DB.prepare(`
    SELECT service_key, mode, updated_at
    FROM tenant_service_configs
    WHERE tenant_id = ?
  `).bind(targetTenantId).all();

  const configsMap = {};
  for (const row of (configRowsRes?.results || [])) {
    configsMap[row.service_key] = row;
  }

  // 3. جلب حالة ضبط الإعدادات بأمان (فحص وجود القيمة دون قراءة أسرار التوكن)
  // نفحص إعدادات المتجر المستهدف وإعدادات Master (في حال الوضع Managed)
  const [merchantSettingsRes, masterSettingsRes] = await Promise.all([
    env.DB.prepare(`
      SELECT key, CASE WHEN value IS NOT NULL AND length(trim(value)) > 0 THEN 1 ELSE 0 END as has_val
      FROM settings
      WHERE tenant_id = ?
    `).bind(targetTenantId).all(),
    env.DB.prepare(`
      SELECT key, CASE WHEN value IS NOT NULL AND length(trim(value)) > 0 THEN 1 ELSE 0 END as has_val
      FROM settings
      WHERE tenant_id = ? OR tenant_id IS NULL
    `).bind(DEFAULT_MASTER_TENANT_ID).all(),
  ]);

  const merchantSettingsPresence = new Set();
  for (const row of (merchantSettingsRes?.results || [])) {
    if (row.has_val) merchantSettingsPresence.add(row.key);
  }
  // توافقية: fb_pixel_id و pixel_id
  if (merchantSettingsPresence.has('pixel_id')) merchantSettingsPresence.add('fb_pixel_id');
  if (merchantSettingsPresence.has('fb_pixel_id')) merchantSettingsPresence.add('pixel_id');

  const masterSettingsPresence = new Set();
  for (const row of (masterSettingsRes?.results || [])) {
    if (row.has_val) masterSettingsPresence.add(row.key);
  }
  if (masterSettingsPresence.has('pixel_id')) masterSettingsPresence.add('fb_pixel_id');
  if (masterSettingsPresence.has('fb_pixel_id')) masterSettingsPresence.add('pixel_id');

  // 4. بناء قائمة الخدمات استناداً حصرياً إلى SERVICE_REGISTRY
  const isMasterTenant = targetTenantId === DEFAULT_MASTER_TENANT_ID;
  const servicesList = getRegisteredServiceKeys().map(serviceKey => {
    const serviceDef = getServiceDefinition(serviceKey);
    const configuredRow = configsMap[serviceKey];

    // الوضع الافتراضي 'own' إن لم يكن مضبوطاً مسبقاً
    let currentMode = configuredRow ? configuredRow.mode : SERVICE_MODES.OWN;
    if (isMasterTenant) currentMode = SERVICE_MODES.OWN;

    // فحص اكتمال الإعدادات (configured boolean) دون تسريب أي قيم
    const targetPresence = (currentMode === SERVICE_MODES.MANAGED)
      ? masterSettingsPresence
      : merchantSettingsPresence;

    const allRequiredPresent = (serviceDef.requiredSettings || []).every(reqKey => targetPresence.has(reqKey));
    const configured = allRequiredPresent;

    return {
      service_key: serviceDef.key,
      name: serviceDef.name,
      mode: currentMode,
      supportsManaged: serviceDef.supportsManaged,
      browserExposed: serviceDef.browserExposed,
      configured: configured,
      updated_at: configuredRow?.updated_at || null,
    };
  });

  return {
    ok: true,
    tenant: {
      id: targetTenant.id,
      name: targetTenant.name,
      slug: targetTenant.slug,
      status: targetTenant.status,
      plan: targetTenant.plan,
    },
    services: servicesList,
  };
}

/**
 * [SUPER_ADMIN] تحديث وضع خدمة معينة لمستأجر (own / managed / disabled)
 * @param {object} env
 * @param {object} params
 * @param {object} authSession
 * @param {Request} request
 * @returns {Promise<object>}
 */
export async function superUpdateTenantService(env, params, authSession, request) {
  if (!isSuperAdminSession(authSession)) {
    return {
      ok: false,
      error: 'غير مصرح: هذه العملية مخصصة للمالك الرئيسي للمنصة (Super Admin) فقط',
      errorCode: 'FORBIDDEN',
    };
  }

  const targetTenantId = sanitize(params?.target_tenant_id || params?.tenant_id || '', 60);
  const rawServiceKey  = sanitize(params?.service_key || params?.service || '', 50).toLowerCase();
  const rawMode        = sanitize(params?.mode || '', 30).toLowerCase();

  // 1. التحقق من المدخلات الأساسية
  if (!targetTenantId) {
    return { ok: false, error: 'معرف المتجر المستهدف (tenant_id) مطلوب', errorCode: 'TENANT_ID_REQUIRED' };
  }
  if (!rawServiceKey) {
    return { ok: false, error: 'معرف الخدمة (service_key) مطلوب', errorCode: 'SERVICE_KEY_REQUIRED' };
  }
  if (!rawMode) {
    return { ok: false, error: 'وضع الخدمة (mode) مطلوب', errorCode: 'MODE_REQUIRED' };
  }

  // 2. التحقق من وجود الخدمة في SERVICE_REGISTRY
  const serviceDef = getServiceDefinition(rawServiceKey);
  if (!serviceDef) {
    return {
      ok: false,
      error: `الخدمة المطلوبة غير معروفة: ${rawServiceKey}`,
      errorCode: 'UNKNOWN_SERVICE',
    };
  }

  // 3. التحقق من صحة الوضع (own | managed | disabled)
  if (![SERVICE_MODES.OWN, SERVICE_MODES.MANAGED, SERVICE_MODES.DISABLED].includes(rawMode)) {
    return {
      ok: false,
      error: `وضع الخدمة غير صالح: ${rawMode}`,
      errorCode: 'INVALID_SERVICE_MODE',
    };
  }

  // 4. فرض قدرة الخدمة المُدارة (Managed Capability Enforcement)
  if (rawMode === SERVICE_MODES.MANAGED && !serviceDef.supportsManaged) {
    return {
      ok: false,
      error: `خدمة (${serviceDef.name}) لا تدعم الوضع المُدار (Managed)`,
      errorCode: 'SERVICE_MANAGED_NOT_SUPPORTED',
    };
  }

  // 5. حماية المتجر الرئيسي (Master Tenant Protection)
  // Master tenant مقفل دائماً على 'own' وممنوع تحويله إلى managed أو disabled
  if (targetTenantId === DEFAULT_MASTER_TENANT_ID) {
    if (rawMode !== SERVICE_MODES.OWN) {
      return {
        ok: false,
        error: 'المتجر الرئيسي للمنصة مقفل دائماً على الوضع الخاص (own) ولا يمكن تغييره',
        errorCode: 'MASTER_MODE_IMMUTABLE',
      };
    }
  }

  // 6. التحقق من وجود المستأجر في قاعدة البيانات
  const targetTenant = await env.DB.prepare(`
    SELECT id, name, slug, status
    FROM tenants
    WHERE id = ?
    LIMIT 1
  `).bind(targetTenantId).first();

  if (!targetTenant) {
    return {
      ok: false,
      error: 'المتجر المستهدف غير موجود',
      errorCode: 'TENANT_NOT_FOUND',
    };
  }

  // 7. جلب الوضع القديم لسجل التدقيق الأمني
  const oldRow = await env.DB.prepare(`
    SELECT mode FROM tenant_service_configs
    WHERE tenant_id = ? AND service_key = ?
    LIMIT 1
  `).bind(targetTenantId, serviceDef.key).first();
  const oldMode = oldRow ? oldRow.mode : SERVICE_MODES.OWN;

  // 8. كتابة التكوين في قاعدة البيانات باستخدام Atomic UPSERT
  await env.DB.prepare(`
    INSERT INTO tenant_service_configs (tenant_id, service_key, mode, updated_at)
    VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    ON CONFLICT(tenant_id, service_key)
    DO UPDATE SET
      mode = excluded.mode,
      updated_at = excluded.updated_at
  `).bind(targetTenantId, serviceDef.key, rawMode).run();

  // 9. تطهير الكاش المرتبط بإعدادات المستأجر
  const cache = env.CACHE || env.KV;
  if (cache) {
    await cache.delete(`tenant:${targetTenantId}:settings_v1`).catch(() => {});
  }

  // 10. تسجيل العملية في سجل التدقيق الأمني (Audit Log)
  await recordAuditLog(env.DB, {
    tenant_id: targetTenantId,
    user_id: authSession?.userId || 'super_admin',
    action: 'TENANT_SERVICE_CONFIG_UPDATED',
    resource_type: 'service_config',
    resource_id: `${targetTenantId}:${serviceDef.key}`,
    metadata: {
      target_tenant_id: targetTenantId,
      store_name: targetTenant.name,
      service_key: serviceDef.key,
      service_name: serviceDef.name,
      old_mode: oldMode,
      new_mode: rawMode,
      actor_id: authSession?.userId || 'super_admin',
      actor_role: authSession?.role || 'SUPER_ADMIN',
    },
    request,
  });

  return {
    ok: true,
    message: `تم تحديث وضع خدمة (${serviceDef.name}) للمتجر (${targetTenant.name}) إلى (${rawMode}) بنجاح`,
    service: {
      tenant_id: targetTenantId,
      service_key: serviceDef.key,
      name: serviceDef.name,
      mode: rawMode,
      old_mode: oldMode,
      supportsManaged: serviceDef.supportsManaged,
    },
  };
}
