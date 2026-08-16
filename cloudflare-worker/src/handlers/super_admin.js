/**
 * Smart Shopping — Super Admin & Platform Handlers
 * ملف: src/handlers/super_admin.js
 * 
 * معالجات الإدارة المركزية للمنصة (Platform Oversight & Multi-Tenant Management)
 * ─────────────────────────────────────────────
 * يوفر لوحة تحكم وإحصائيات عامة للمالك الرئيسي (Super Admin)
 * مع ضمان عزل البيانات بنسبة 100% ومنع التجار العاديين من الوصول لبيانات المنصة.
 */

import { DEFAULT_MASTER_TENANT_ID } from '../utils/auth.js';
import { ROLES } from '../utils/rbac.js';

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
