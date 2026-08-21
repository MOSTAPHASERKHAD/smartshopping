/**
 * Smart Shopping — Cloudflare Worker
 * ملف: src/utils/rbac.js
 * 
 * نظام الصلاحيات المتقدم (RBAC - Role-Based Access Control)
 * ─────────────────────────────────────────────
 * يحدد مصفوفة الصلاحيات التفصيلية لكل دور ومطابقة الـ Actions بالصلاحيات المطلوبة.
 */

export const ROLES = {
  OWNER:         'OWNER',
  ADMIN:         'ADMIN',
  ORDER_MANAGER: 'ORDER_MANAGER',
  SUPPORT:       'SUPPORT',
  VIEWER:        'VIEWER',
};

// تعريف كافة الصلاحيات المتاحة في المنصة
export const PERMISSIONS = {
  // Products
  PRODUCTS_READ:   'products.read',
  PRODUCTS_CREATE: 'products.create',
  PRODUCTS_UPDATE: 'products.update',
  PRODUCTS_DELETE: 'products.delete',

  // Orders
  ORDERS_READ:   'orders.read',
  ORDERS_UPDATE: 'orders.update',
  ORDERS_DELETE: 'orders.delete',
  ORDERS_EXPORT: 'orders.export',

  // Customers
  CUSTOMERS_READ:   'customers.read',
  CUSTOMERS_UPDATE: 'customers.update',

  // Settings
  SETTINGS_READ:   'settings.read',
  SETTINGS_UPDATE: 'settings.update',

  // Coupons
  COUPONS_READ:   'coupons.read',
  COUPONS_CREATE: 'coupons.create',
  COUPONS_UPDATE: 'coupons.update',
  COUPONS_DELETE: 'coupons.delete',

  // Testimonials
  TESTIMONIALS_READ:   'testimonials.read',
  TESTIMONIALS_CREATE: 'testimonials.create',
  TESTIMONIALS_UPDATE: 'testimonials.update',
  TESTIMONIALS_DELETE: 'testimonials.delete',

  // Reviews
  REVIEWS_READ:   'reviews.read',
  REVIEWS_UPDATE: 'reviews.update',
  REVIEWS_DELETE: 'reviews.delete',

  // Pages
  PAGES_READ:   'pages.read',
  PAGES_UPDATE: 'pages.update',

  // Subscribers
  SUBSCRIBERS_READ: 'subscribers.read',

  // Themes
  THEMES_READ:   'themes.read',
  THEMES_UPDATE: 'themes.update',
  THEMES_DELETE: 'themes.delete',

  // Media
  MEDIA_READ:   'media.read',
  MEDIA_CREATE: 'media.create',
  MEDIA_DELETE: 'media.delete',

  // Marketing & AI
  MARKETING_TEST: 'marketing.test',
  AI_USE:         'ai.use',

  // User Management
  USERS_READ:   'users.read',
  USERS_CREATE: 'users.create',
  USERS_UPDATE: 'users.update',
  USERS_DELETE: 'users.delete',

  // Audit Logs
  AUDIT_READ: 'audit.read',

  // Platform & Super Admin Management
  PLATFORM_MANAGE: 'platform.manage',
};

// خريطة الصلاحيات لكل دور
const ROLE_PERMISSIONS = {
  // OWNER يمتلك جميع صلاحيات متجره
  [ROLES.OWNER]: new Set(Object.values(PERMISSIONS)),

  // ADMIN يمتلك صلاحيات إدارة المتجر بالكامل ما عدا حذف المستخدمين الآخرين أو حذف السجلات الحرجة
  [ROLES.ADMIN]: new Set([
    PERMISSIONS.PRODUCTS_READ, PERMISSIONS.PRODUCTS_CREATE, PERMISSIONS.PRODUCTS_UPDATE, PERMISSIONS.PRODUCTS_DELETE,
    PERMISSIONS.ORDERS_READ, PERMISSIONS.ORDERS_UPDATE, PERMISSIONS.ORDERS_EXPORT,
    PERMISSIONS.CUSTOMERS_READ, PERMISSIONS.CUSTOMERS_UPDATE,
    PERMISSIONS.SETTINGS_READ, PERMISSIONS.SETTINGS_UPDATE,
    PERMISSIONS.COUPONS_READ, PERMISSIONS.COUPONS_CREATE, PERMISSIONS.COUPONS_UPDATE, PERMISSIONS.COUPONS_DELETE,
    PERMISSIONS.TESTIMONIALS_READ, PERMISSIONS.TESTIMONIALS_CREATE, PERMISSIONS.TESTIMONIALS_UPDATE, PERMISSIONS.TESTIMONIALS_DELETE,
    PERMISSIONS.REVIEWS_READ, PERMISSIONS.REVIEWS_UPDATE, PERMISSIONS.REVIEWS_DELETE,
    PERMISSIONS.PAGES_READ, PERMISSIONS.PAGES_UPDATE,
    PERMISSIONS.SUBSCRIBERS_READ,
    PERMISSIONS.THEMES_READ, PERMISSIONS.THEMES_UPDATE,
    PERMISSIONS.MEDIA_READ, PERMISSIONS.MEDIA_CREATE, PERMISSIONS.MEDIA_DELETE,
    PERMISSIONS.MARKETING_TEST, PERMISSIONS.AI_USE,
    PERMISSIONS.USERS_READ,
    PERMISSIONS.AUDIT_READ,
  ]),

  // ORDER_MANAGER مخصص لمعالجة وتأكيد وشحن الطلبات
  [ROLES.ORDER_MANAGER]: new Set([
    PERMISSIONS.ORDERS_READ, PERMISSIONS.ORDERS_UPDATE, PERMISSIONS.ORDERS_EXPORT,
    PERMISSIONS.PRODUCTS_READ,
    PERMISSIONS.CUSTOMERS_READ,
    PERMISSIONS.COUPONS_READ,
    PERMISSIONS.REVIEWS_READ,
    PERMISSIONS.AI_USE,
  ]),

  // SUPPORT مخصص لخدمة العملاء والرد على الاستفسارات
  [ROLES.SUPPORT]: new Set([
    PERMISSIONS.ORDERS_READ,
    PERMISSIONS.CUSTOMERS_READ,
    PERMISSIONS.PRODUCTS_READ,
    PERMISSIONS.REVIEWS_READ,
    PERMISSIONS.TESTIMONIALS_READ,
    PERMISSIONS.AI_USE,
  ]),

  // VIEWER للقراءة فقط (Read-only analytics & reporting)
  [ROLES.VIEWER]: new Set([
    PERMISSIONS.PRODUCTS_READ,
    PERMISSIONS.ORDERS_READ,
    PERMISSIONS.CUSTOMERS_READ,
    PERMISSIONS.SETTINGS_READ,
    PERMISSIONS.COUPONS_READ,
    PERMISSIONS.TESTIMONIALS_READ,
    PERMISSIONS.REVIEWS_READ,
    PERMISSIONS.PAGES_READ,
    PERMISSIONS.SUBSCRIBERS_READ,
    PERMISSIONS.THEMES_READ,
    PERMISSIONS.MEDIA_READ,
  ]),
};

// خريطة مطابقة كل Action إداري بالصلاحية المطلوبة
export const ACTION_PERMISSIONS = {
  // Products
  admin_list:           PERMISSIONS.PRODUCTS_READ,
  admin_add_product:    PERMISSIONS.PRODUCTS_CREATE,
  admin_edit_product:   PERMISSIONS.PRODUCTS_UPDATE,
  admin_delete_product: PERMISSIONS.PRODUCTS_DELETE,

  // Orders
  admin_orders:         PERMISSIONS.ORDERS_READ,
  admin_update_order:   PERMISSIONS.ORDERS_UPDATE,
  admin_delete_order:   PERMISSIONS.ORDERS_DELETE,

  // Settings
  admin_settings:        PERMISSIONS.SETTINGS_READ,
  admin_update_settings: PERMISSIONS.SETTINGS_UPDATE,

  // Coupons
  admin_list_coupons:   PERMISSIONS.COUPONS_READ,
  admin_add_coupon:     PERMISSIONS.COUPONS_CREATE,
  admin_edit_coupon:    PERMISSIONS.COUPONS_UPDATE,
  admin_delete_coupon:  PERMISSIONS.COUPONS_DELETE,

  // Testimonials
  admin_list_testimonials:  PERMISSIONS.TESTIMONIALS_READ,
  admin_add_testimonial:    PERMISSIONS.TESTIMONIALS_CREATE,
  admin_edit_testimonial:   PERMISSIONS.TESTIMONIALS_UPDATE,
  admin_delete_testimonial: PERMISSIONS.TESTIMONIALS_DELETE,

  // Reviews
  admin_list_reviews:   PERMISSIONS.REVIEWS_READ,
  admin_approve_review: PERMISSIONS.REVIEWS_UPDATE,
  admin_delete_review:  PERMISSIONS.REVIEWS_DELETE,

  // Pages
  admin_list_pages: PERMISSIONS.PAGES_READ,
  admin_save_page:  PERMISSIONS.PAGES_UPDATE,

  // Customers & Subscribers
  admin_list_customers:   PERMISSIONS.CUSTOMERS_READ,
  admin_list_subscribers: PERMISSIONS.SUBSCRIBERS_READ,

  // Themes
  admin_list_themes:        PERMISSIONS.THEMES_READ,
  admin_save_theme:         PERMISSIONS.THEMES_UPDATE,
  admin_delete_theme:       PERMISSIONS.THEMES_DELETE,
  admin_set_default_theme:  PERMISSIONS.THEMES_UPDATE,

  // Media
  admin_list_media:    PERMISSIONS.MEDIA_READ,
  admin_upload_image:  PERMISSIONS.MEDIA_CREATE,
  admin_delete_media:  PERMISSIONS.MEDIA_DELETE,

  // Marketing & AI
  admin_capi_test: PERMISSIONS.MARKETING_TEST,
  admin_ai_chat:   PERMISSIONS.AI_USE,

  // User & Session Management
  admin_list_users:   PERMISSIONS.USERS_READ,
  admin_add_user:     PERMISSIONS.USERS_CREATE,
  admin_edit_user:    PERMISSIONS.USERS_UPDATE,
  admin_delete_user:  PERMISSIONS.USERS_DELETE,
  auth_sessions:      PERMISSIONS.USERS_READ,
  auth_revoke_session:PERMISSIONS.USERS_UPDATE,
  auth_revoke_all:    PERMISSIONS.USERS_UPDATE,

  // Super Admin Platform Actions
  admin_super_list_tenants:   PERMISSIONS.PLATFORM_MANAGE,
  admin_super_platform_stats: PERMISSIONS.PLATFORM_MANAGE,
  admin_super_update_tenant:  PERMISSIONS.PLATFORM_MANAGE,

  // Audit Logs
  admin_list_audit_logs: PERMISSIONS.AUDIT_READ,
};

/**
 * التحقق مما إذا كان الدور يمتلك الصلاحية المطلوبة
 * @param {string} role
 * @param {string} permission
 * @returns {boolean}
 */
export function hasPermission(role, permission) {
  if (!role || !permission) return false;
  const userRole = String(role).toUpperCase();
  if (userRole === ROLES.OWNER || userRole === 'SUPER_ADMIN') return true;
  const perms = ROLE_PERMISSIONS[userRole];
  return perms ? perms.has(permission) : false;
}

/**
 * التحقق مما إذا كان الدور يمتلك صلاحية تنفيذ Action معين
 * @param {string} role
 * @param {string} action
 * @param {string} tenantId
 * @returns {boolean}
 */
export function canExecuteAction(role, action, tenantId = null) {
  if (!action) return false;

  // إجراءات Super Admin مخصصة لمالك المتجر الرئيسي فقط أو دور SUPER_ADMIN
  if (action.startsWith('admin_super_')) {
    const userRole = String(role || '').toUpperCase();
    if (userRole === 'SUPER_ADMIN') return true;
    if (userRole === ROLES.OWNER && (!tenantId || tenantId === 'tenant_master_default')) {
      return true;
    }
    return false;
  }

  const requiredPerm = ACTION_PERMISSIONS[action];
  if (!requiredPerm) {
    // Fail-closed: أي Action يبدأ بـ admin_ وغير مسجل في الخريطة يتاح للمالك (OWNER) فقط
    if (action.startsWith('admin_')) {
      return String(role).toUpperCase() === ROLES.OWNER;
    }
    return true;
  }
  return hasPermission(role, requiredPerm);
}
