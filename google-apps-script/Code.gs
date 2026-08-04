// SmartShopping - Google Apps Script Backend
// Deploy as Web App → Execute as: Me → Who has access: Anyone

function testAuth() {
  UrlFetchApp.fetch('https://httpbin.org/get');
  Logger.log('Authorization successful!');
}

// ── Admin session tokens (issued on login, 24h TTL) ──
var ADMIN_TOKEN_KEY = 'admin_token';
var ADMIN_TOKEN_KEY_EXP = 'admin_token_exp';
var ADMIN_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function _issueAdminToken() {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var props = PropertiesService.getScriptProperties();
  props.setProperty(ADMIN_TOKEN_KEY, token);
  props.setProperty(ADMIN_TOKEN_KEY_EXP, String(Date.now() + ADMIN_TOKEN_TTL_MS));
  return token;
}

function _isValidAdminToken(token) {
  if (!token) return false;
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(ADMIN_TOKEN_KEY) !== token) return false;
  var exp = parseInt(props.getProperty(ADMIN_TOKEN_KEY_EXP) || '0');
  if (Date.now() > exp) {
    props.deleteProperty(ADMIN_TOKEN_KEY);
    props.deleteProperty(ADMIN_TOKEN_KEY_EXP);
    return false;
  }
  return true;
}

function _isSetupMode() {
  return !getSettingsValue('admin_password');
}

// Actions that require a valid admin token.
// NOTE: these stay public on purpose (used by the public storefront):
//  - admin_list_themes: theme display data is non-sensitive; storefront loads it for rendering
//  - upload_image: customers upload review photos
//  - customer_orders / track: customers view their own orders
var ADMIN_REQUIRED = {
  'admin_list': 1, 'admin_orders': 1, 'admin_settings': 1,
  'admin_add_product': 1, 'admin_edit_product': 1, 'admin_delete_product': 1,
  'admin_update_order': 1, 'admin_update_settings': 1, 'admin_delete_order': 1,
  'admin_list_testimonials': 1, 'admin_add_testimonial': 1,
  'admin_edit_testimonial': 1, 'admin_delete_testimonial': 1, 'admin_upload_image': 1,
  'admin_list_coupons': 1, 'admin_add_coupon': 1, 'admin_edit_coupon': 1,
  'admin_delete_coupon': 1, 'admin_list_reviews': 1, 'admin_delete_review': 1,
  'admin_list_pages': 1, 'admin_save_page': 1, 'admin_list_customers': 1,
  'admin_list_subscribers': 1, 'admin_save_theme': 1,
  'admin_delete_theme': 1, 'admin_set_default_theme': 1, 'generate_recovery': 1
};

function _adminGate(action, params) {
  if (!ADMIN_REQUIRED[action]) return true;
  if (action === 'admin_update_settings' && _isSetupMode()) return true;
  return _isValidAdminToken(params.token);
}

// ── Per-phone spam guard for order creation (60s between orders from same phone) ──
function _orderSpamGuard(phone) {
  if (!phone) return true;
  var props = PropertiesService.getScriptProperties();
  var key = 'order_last_' + phone;
  var last = parseInt(props.getProperty(key) || '0');
  var now = Date.now();
  if (now - last < 60000) return false;
  props.setProperty(key, String(now));
  return true;
}

// ── Login brute-force throttle (admin login / recovery): after N failures, block 60s ──
var LOGIN_MAX_FAILS = 5;
var LOGIN_BLOCK_MS = 60 * 1000;

function _loginBlocked() {
  var props = PropertiesService.getScriptProperties();
  var until = parseInt(props.getProperty('login_blocked_until') || '0');
  return Date.now() < until;
}

function _loginRecordFailure() {
  var props = PropertiesService.getScriptProperties();
  var fails = parseInt(props.getProperty('login_fails') || '0') + 1;
  if (fails >= LOGIN_MAX_FAILS) {
    props.setProperty('login_blocked_until', String(Date.now() + LOGIN_BLOCK_MS));
    props.setProperty('login_fails', '0');
  } else {
    props.setProperty('login_fails', String(fails));
  }
}

function _loginReset() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('login_fails', '0');
  props.deleteProperty('login_blocked_until');
}

// ── Image upload hardening: allowlist, size + magic-byte validation, rate limit ──
var UPLOAD_ALLOWED_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
var UPLOAD_MAX_BYTES = 3 * 1024 * 1024;
var UPLOAD_RATE_LIMIT = 300;

function _uploadRateOk() {
  var props = PropertiesService.getScriptProperties();
  var hour = Math.floor(Date.now() / 3600000);
  if (props.getProperty('upload_hour') !== String(hour)) {
    props.setProperty('upload_hour', String(hour));
    props.setProperty('upload_count', '1');
    return true;
  }
  var count = parseInt(props.getProperty('upload_count') || '0');
  if (count >= UPLOAD_RATE_LIMIT) return false;
  props.setProperty('upload_count', String(count + 1));
  return true;
}

function _validateImageBlob(blob) {
  var bytes = blob.getBytes();
  if (!bytes || bytes.length === 0) return { error: 'Empty file' };
  if (bytes.length > UPLOAD_MAX_BYTES) return { error: 'File too large (max 3MB)' };
  var mime = (blob.getContentType() || '').toLowerCase();
  var ext = UPLOAD_ALLOWED_MIME[mime];
  if (!ext) return { error: 'Unsupported image type' };
  function match(prefix) { for (var i = 0; i < prefix.length; i++) { if (bytes[i] !== prefix[i]) return false; } return true; }
  var ok = false;
  if (mime === 'image/jpeg') ok = match([0xFF, 0xD8, 0xFF]);
  else if (mime === 'image/png') ok = match([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  else if (mime === 'image/gif') ok = match([0x47, 0x49, 0x46, 0x38]);
  else if (mime === 'image/webp') ok = match([0x52, 0x49, 0x46, 0x46]) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (!ok) return { error: 'File is not a valid image' };
  return { ok: true, blob: blob, ext: ext };
}

function _createVerifiedUpload(base64, mimeType) {
  if (!_uploadRateOk()) return { error: 'Upload limit reached, try again later' };
  var blob;
  try {
    blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType || 'image/jpeg', 'upload');
  } catch (e) { return { error: 'Invalid image data' }; }
  var v = _validateImageBlob(blob);
  if (v.error) return { error: v.error };
  var folder = DriveApp.getFolderById(getOrCreateFolderId());
  var file = folder.createFile(v.blob.setName('sk_' + Utilities.getUuid().replace(/-/g, '') + '.' + v.ext));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { ok: true, url: 'https://drive.google.com/uc?id=' + file.getId() + '&export=view' };
}

// ── Input sanitizer: strips HTML/angle brackets + caps length ──
function _sanitize(value, maxLen) {
  if (value === null || value === undefined) return '';
  var s = String(value).replace(/[<>]/g, '').trim();
  if (maxLen && s.length > maxLen) s = s.substring(0, maxLen);
  return s;
}

function doGet(e) {
  var params = e.parameter;
  var action = params.action || '';
  var callback = params.callback || '';
  var result;

  if (!_adminGate(action, params)) {
    result = { error: 'غير مصرح: انتهت الجلسة. سجل الدخول من جديد.' };
  } else {
    switch (action) {
      case 'catalog': result = getCatalog(); break;
    case 'capi_test': result = capiTest(); break;
    case 'settings': result = getSettings(); break;
    case 'track': result = trackOrder(params.order_id || ''); break;
    case 'customer_orders': result = customerOrders(params.phone || ''); break;
    case 'order': result = createOrder(params); break;
    case 'capi_send': result = capiSendPurchase(params); break;
    case 'admin_list': result = adminListProducts(); break;
    case 'admin_orders': result = adminListOrders(); break;
    case 'admin_settings': result = getSettings(); break;
    case 'upload_image': result = adminUploadImageGet(params); break;
    case 'admin_add_product': result = adminAddProduct(params); break;
    case 'admin_edit_product': result = adminEditProduct(params); break;
    case 'admin_delete_product': result = adminDeleteProduct(params); break;
    case 'admin_update_order': result = adminUpdateOrder(params); break;
    case 'admin_update_settings': result = adminUpdateSettings(params); break;
    case 'admin_delete_order': result = adminDeleteOrder(params); break;
    case 'testimonials': result = getTestimonials(); break;
    case 'admin_list_testimonials': result = adminListTestimonials(); break;
    case 'admin_add_testimonial': result = adminAddTestimonial(params); break;
    case 'admin_edit_testimonial': result = adminEditTestimonial(params); break;
    case 'admin_delete_testimonial': result = adminDeleteTestimonial(params); break;
    case 'verify_admin': result = verifyAdmin(params); break;
    case 'validate_coupon': result = validateCoupon(params); break;
    case 'admin_list_coupons': result = adminListCoupons(); break;
    case 'admin_add_coupon': result = adminAddCoupon(params); break;
    case 'admin_edit_coupon': result = adminEditCoupon(params); break;
    case 'admin_delete_coupon': result = adminDeleteCoupon(params); break;
    case 'get_reviews': result = getReviews(params); break;
    case 'add_review': result = addReview(params); break;
    case 'admin_list_reviews': result = adminListReviews(); break;
    case 'admin_delete_review': result = adminDeleteReview(params); break;
    case 'admin_list_pages': result = adminListPages(); break;
    case 'admin_save_page': result = adminSavePage(params); break;
    case 'get_pages': result = getPages(); break;
    case 'customer_register': result = customerRegister(params); break;
    case 'customer_login': result = customerLogin(params); break;
    case 'customer_profile': result = customerProfile(params); break;
    case 'admin_list_customers': result = adminListCustomers(); break;
    case 'newsletter_subscribe': result = newsletterSubscribe(params); break;
    case 'admin_list_subscribers': result = adminListSubscribers(); break;
    case 'ai_chat': result = aiChat(params); break;
    case 'verify_recovery': result = verifyRecovery(params); break;
    case 'generate_recovery': result = generateRecoveryCode(); break;
    case 'admin_list_themes': result = adminListThemes(); break;
    case 'admin_save_theme': result = adminSaveTheme(params); break;
    case 'admin_delete_theme': result = adminDeleteTheme(params); break;
    case 'admin_set_default_theme': result = adminSetDefaultTheme(params); break;
    default: result = { error: 'Unknown action' };
    }
  }

  var json = JSON.stringify(result);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var params;
  try { params = JSON.parse(e.postData.contents); } catch(ex) { params = e.parameter || {}; }
  var action = params.action || '';
  var callback = params.callback || '';
  var result;

  if (!_adminGate(action, params)) {
    result = { error: 'غير مصرح: انتهت الجلسة. سجل الدخول من جديد.' };
  } else {
    switch (action) {
      case 'order': result = createOrder(params); break;
    case 'capi_send': result = capiSendPurchase(params); break;
    case 'admin_add_product': result = adminAddProduct(params); break;
    case 'admin_edit_product': result = adminEditProduct(params); break;
    case 'admin_delete_product': result = adminDeleteProduct(params); break;
    case 'admin_update_order': result = adminUpdateOrder(params); break;
    case 'admin_delete_order': result = adminDeleteOrder(params); break;
    case 'admin_add_testimonial': result = adminAddTestimonial(params); break;
    case 'admin_edit_testimonial': result = adminEditTestimonial(params); break;
    case 'admin_delete_testimonial': result = adminDeleteTestimonial(params); break;
    case 'admin_update_settings': result = adminUpdateSettings(params); break;
    case 'admin_upload_image': result = adminUploadImage(params); break;
    case 'verify_admin': result = verifyAdmin(params); break;
    case 'validate_coupon': result = validateCoupon(params); break;
    case 'admin_add_coupon': result = adminAddCoupon(params); break;
    case 'admin_edit_coupon': result = adminEditCoupon(params); break;
    case 'admin_delete_coupon': result = adminDeleteCoupon(params); break;
    case 'get_reviews': result = getReviews(params); break;
    case 'add_review': result = addReview(params); break;
    case 'admin_list_reviews': result = adminListReviews(); break;
    case 'admin_delete_review': result = adminDeleteReview(params); break;
    case 'admin_list_pages': result = adminListPages(); break;
    case 'admin_save_page': result = adminSavePage(params); break;
    case 'get_pages': result = getPages(); break;
    case 'customer_register': result = customerRegister(params); break;
    case 'customer_login': result = customerLogin(params); break;
    case 'customer_profile': result = customerProfile(params); break;
    case 'admin_list_customers': result = adminListCustomers(); break;
    case 'newsletter_subscribe': result = newsletterSubscribe(params); break;
    case 'admin_list_subscribers': result = adminListSubscribers(); break;
    case 'ai_chat': result = aiChat(params); break;
    case 'verify_recovery': result = verifyRecovery(params); break;
    case 'generate_recovery': result = generateRecoveryCode(); break;
    case 'admin_list_themes': result = adminListThemes(); break;
    case 'admin_save_theme': result = adminSaveTheme(params); break;
    case 'admin_delete_theme': result = adminDeleteTheme(params); break;
    case 'admin_set_default_theme': result = adminSetDefaultTheme(params); break;
    default: result = { error: 'Unknown action' };
    }
  }

  var json = JSON.stringify(result);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function getCatalog() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('catalog');
  if (cached) {
    try { return JSON.parse(cached); } catch(e) {}
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Catalog');
  if (!sheet) return { products: [] };
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var products = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var product = {};
    for (var j = 0; j < headers.length; j++) { product[headers[j]] = row[j]; }
    
    // Parse variant options JSON if present
    if (product.variant_options) {
      try { product.variant_options = JSON.parse(product.variant_options); } catch(e) { product.variant_options = []; }
    } else { product.variant_options = []; }
    
    // Auto-convert display values
    if (product.variant_price && !product.variant_price.startsWith('EGP')) {
      product.variant_price = 'EGP ' + product.variant_price;
    }
    
    if (product.active === true || product.active === 'TRUE' || product.active === 'true' || product.active === 1) {
      products.push(product);
    }
  }
  var result = { products: products };
  try { cache.put('catalog', JSON.stringify(result), 600); } catch(e) {}
  return result;
}

function getSettings() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('settings');
  if (cached) {
    try { return JSON.parse(cached); } catch(e) {}
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Settings');
  if (!sheet) return {};
  var data = sheet.getDataRange().getValues();
  var settings = {};
  var secretKeys = { fb_capi_token: true, gemini_api_key: true, admin_password: true, admin_recovery: true };
  for (var i = 1; i < data.length; i++) {
    if (!secretKeys[data[i][0]]) { settings[data[i][0]] = data[i][1]; }
  }
  try { cache.put('settings', JSON.stringify(settings), 600); } catch(e) {}
  return settings;
}

function trackOrder(orderId) {
  if (!orderId) return { error: 'No order_id provided' };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Orders');
  if (!sheet) return { error: 'Orders sheet not found' };
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var idx = {};
  for (var h = 0; h < headers.length; h++) { idx[String(headers[h]).toLowerCase().trim()] = h; }
  var statusCol = idx['status'] >= 0 ? idx['status'] : idx['shipping_note'];
  var idCol = idx['order_id'];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (idCol >= 0 && row[idCol] === orderId) {
      // Public response contains NO PII (name/phone/address/notes/utm stay private).
      var order = {
        order_id: row[idCol],
        created_at: (idx['created_at'] >= 0) ? row[idx['created_at']] : '',
        status: (statusCol >= 0) ? row[statusCol] : '',
        wilaya_ar: (idx['wilaya_ar'] >= 0) ? row[idx['wilaya_ar']] : '',
        wilaya_en: (idx['wilaya_en'] >= 0) ? row[idx['wilaya_en']] : '',
        delivery_type: (idx['delivery_type'] >= 0) ? row[idx['delivery_type']] : '',
        items_json: (idx['items_json'] >= 0) ? row[idx['items_json']] : '[]',
        subtotal: (idx['subtotal'] >= 0) ? row[idx['subtotal']] : 0
      };
      return { found: true, order: order };
    }
  }
  return { found: false, error: 'Order not found' };
}

// Public endpoint: customers see only their own orders (matched by phone)
function customerOrders(phone) {
  if (!phone) return { error: 'Missing phone' };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Orders');
  if (!sheet) return { orders: [] };
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var phoneCol = headers.indexOf('phone');
  var statusCol = -1;
  for (var k = 0; k < headers.length; k++) {
    var h = headers[k].toString().toLowerCase().trim();
    if (h === 'status') { statusCol = k; break; }
    if (h === 'shipping_note') { statusCol = k; }
  }
  var orders = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var rowPhone = String(phoneCol >= 0 ? row[phoneCol] : '').replace(/[^0-9+]/g, '');
    var searchPhone = String(phone).replace(/[^0-9+]/g, '');
    if (rowPhone === searchPhone) {
      var order = { order_id: row[0], created_at: row[1] };
      if (statusCol >= 0) { order.status = row[statusCol]; }
      orders.push(order);
    }
  }
  orders.reverse();
  return { orders: orders };
}

// Rebuild an order's items_json with every string field sanitized (kills stored XSS).
function _sanitizeOrderItems(itemsJson) {
  var items = [];
  try { items = JSON.parse(itemsJson || '[]'); } catch(e) { items = []; }
  if (!Array.isArray(items)) items = [];
  var cleaned = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (!it || typeof it !== 'object') continue;
    var c = {};
    for (var k in it) {
      if (k === 'title' || k === 'name') c[k] = _sanitize(it[k], 300);
      else if (typeof it[k] === 'string') c[k] = _sanitize(it[k], 500);
      else c[k] = it[k];
    }
    cleaned.push(c);
  }
  return JSON.stringify(cleaned);
}

function createOrder(params) {
  params = params || {};
  if (!params.name || !params.phone) return { error: 'Missing required fields (name, phone)' };
  var name = (params.name || '').replace(/[<>"'&]/g, '').substring(0, 200);
  var phone = (params.phone || '').replace(/[^0-9+]/g, '').substring(0, 20);
  var note = (params.note || '').replace(/[<>"'&]/g, '').substring(0, 500);
  // All remaining fields are sanitized too — otherwise a public order could
  // inject HTML that later renders in the admin panel or the public track view.
  var wilayaAr = _sanitize(params.wilaya_ar, 100);
  var wilayaEn = _sanitize(params.wilaya_en, 100);
  var municipality = _sanitize(params.municipality, 200);
  var deliveryType = _sanitize(params.delivery_type, 20);
  var subtotal = String(params.subtotal || '0').replace(/[^0-9.]/g, '').substring(0, 20) || '0';
  var utmSource = _sanitize(params.utm_source, 100);
  var utmMedium = _sanitize(params.utm_medium, 100);
  var utmCampaign = _sanitize(params.utm_campaign, 100);
  var itemsJson = _sanitizeOrderItems(params.items_json);
  if (!_orderSpamGuard(phone)) return { error: 'يرجى الانتظار قليلاً قبل إرسال طلب آخر' };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Orders');
  if (!sheet) return { error: 'Orders sheet not found' };
  var orderId = generateOrderId();
  var now = new Date();
  var createdAt = Utilities.formatDate(now, 'Africa/Algiers', 'yyyy-MM-dd HH:mm:ss');
  sheet.appendRow([
    orderId, createdAt, name, phone,
    _sanitize(params.wilaya_code, 20), wilayaAr, wilayaEn,
    municipality,  // البلدية
    deliveryType, itemsJson,
    subtotal, 'سعر التوصيل يُحدد بعد التأكيد', 'pending', note,
    utmSource,    // مصدر الحملة الإعلانية
    utmMedium,    // وسيلة الإعلان
    utmCampaign   // اسم الحملة
  ]);
  return { ok: true, order_id: orderId };
}

function capiSendPurchase(params) {
  params = params || {};
  var orderId = (params.order_id || '').substring(0, 60);
  var phone = (params.phone || '').replace(/[^0-9+]/g, '').substring(0, 20);
  var subtotal = String(params.subtotal || '0').substring(0, 20);
  if (!orderId) return { error: 'Missing order_id' };
  var enabled = getSettingsValue('capi_enabled');
  if (enabled === 'false' || enabled === '0') return { ok: true, sent: false, reason: 'capi_disabled' };
  var pixelId = getSettingsValue('pixel_id');
  var token = getSettingsValue('fb_capi_token');
  if (!pixelId || !token) return { ok: true, sent: false, reason: 'missing_config' };
  var orderData = { orderId: orderId, phone: phone, subtotal: subtotal };
  try { sendPurchaseToFacebook(orderData); } catch(e) { Logger.log('CAPI err: ' + e); }
  return { ok: true, sent: true };
}

function getSettingsValue(key){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Settings');
  if (!sheet) return '';
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) { if (data[i][0] === key) return data[i][1]; }
  return '';
}

function sendPurchaseToFacebook(orderData){
  var pixelId = getSettingsValue('pixel_id');
  var accessToken = getSettingsValue('fb_capi_token');
  if (!pixelId || !accessToken) { Logger.log('CAPI: no pixel or token'); return; }
  var now = new Date();
  var timestamp = Math.floor(now.getTime() / 1000);
  var phoneHash = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    orderData.phone,
    Utilities.Charset.UTF_8
  ).map(function(b) {
    return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2);
  }).join('');
  var payload = {
    data: [{
      event_name: 'Purchase',
      event_time: timestamp,
      action_source: 'website',
      event_id: orderData.orderId,
      user_data: {
        ph: phoneHash,
        client_ip_address: '',
        client_user_agent: ''
      },
      custom_data: {
        currency: 'DZD',
        value: parseFloat(orderData.subtotal) || 0,
        order_id: orderData.orderId,
        content_type: 'product',
        num_items: 1
      }
    }]
  };
  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  try {
    var resp = UrlFetchApp.fetch(
      'https://graph.facebook.com/v22.0/' + pixelId + '/events?access_token=' + encodeURIComponent(accessToken),
      options
    );
    var result = JSON.parse(resp.getContentText());
    Logger.log('CAPI response [pixel ' + pixelId + ']: ' + JSON.stringify(result));
  } catch(e) {
    Logger.log('CAPI error [pixel ' + pixelId + ']: ' + e.toString());
  }
}

function capiTest() {
  var pixelId = getSettingsValue('pixel_id');
  var accessToken = getSettingsValue('fb_capi_token');
  if (!pixelId) return { error: 'pixel_id not set' };
  if (!accessToken) return { error: 'fb_capi_token not set' };
  var tokenInfo = {};
  try {
    var tResp = UrlFetchApp.fetch(
      'https://graph.facebook.com/debug_token?input_token=' + encodeURIComponent(accessToken) + '&access_token=' + encodeURIComponent(accessToken),
      { muteHttpExceptions: true }
    );
    tokenInfo = JSON.parse(tResp.getContentText());
  } catch(e) { tokenInfo = { error: e.toString() }; }
  var testResult = {};
  try {
    var payload = {
      data: [{
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        action_source: 'website',
        user_data: { client_ip_address: '127.0.0.1', client_user_agent: 'Mozilla/5.0 (SmartKiosk Diagnostic)' },
        custom_data: { currency: 'DZD', value: 0, order_id: 'DIAG-' + Date.now(), content_type: 'product' }
      }]
    };
    var opts = { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true };
    var resp = UrlFetchApp.fetch(
      'https://graph.facebook.com/v22.0/' + pixelId + '/events?access_token=' + encodeURIComponent(accessToken),
      opts
    );
    testResult = JSON.parse(resp.getContentText());
  } catch(e) { testResult = { error: e.toString() }; }
  var tokenOk = !(tokenInfo && tokenInfo.error) || (testResult && testResult.events_received === 1);
  return { pixel_id: pixelId, token_valid: !!tokenOk, token_info: tokenInfo, test_event: testResult };
}

function fixOrdersHeaders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Orders');
  if (!sheet) return { error: 'Orders sheet not found' };
  var canonical = ['order_id','created_at','name','phone','wilaya_code','wilaya_ar','wilaya_en','municipality','delivery_type','items_json','subtotal','shipping_note','status','notes','utm_source','utm_medium','utm_campaign'];
  var lastCol = sheet.getLastColumn();
  var current = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h){ return String(h || '').toLowerCase().trim(); });
  var hasMunicipality = current.indexOf('municipality') >= 0;
  var hasDelivery = current.indexOf('delivery_type') >= 0;
  if (hasMunicipality) return { ok: true, message: 'العناوين سليمة (tوجد municipality). لم يتم أي تغيير.' };
  if (!hasDelivery) return { ok: true, message: 'تخطيط عناوين غير متعارف عليه، لم يتم تغيير شيء: ' + current.join(', ') };
  sheet.getRange(1, 1, 1, canonical.length).setValues([canonical]);
  Logger.log('Orders headers fixed to: ' + canonical.join(', '));
  return { ok: true, message: 'تم إصلاح عناوين جدول Orders إلى 17 عموداً صحيحاً.' };
}

// One-time data repair (run from Apps Script editor after deploying):
//  - clears the empty-key row in Settings (key '')
//  - fixes legacy order rows whose columns were shifted by one
//    (municipality holds the delivery type, delivery_type holds items_json, etc.)
function repairData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var results = [];

  var setSheet = ss.getSheetByName('Settings');
  if (setSheet) {
    var setData = setSheet.getDataRange().getValues();
    var removed = 0;
    for (var i = setData.length - 1; i >= 1; i--) {
      if (!setData[i][0] || String(setData[i][0]).trim() === '') {
        setSheet.deleteRow(i + 1);
        removed++;
      }
    }
    results.push('Settings: removed ' + removed + ' empty-key row(s)');
  }

  var ordSheet = ss.getSheetByName('Orders');
  if (ordSheet) {
    var headers = ordSheet.getRange(1, 1, 1, ordSheet.getLastColumn()).getValues()[0];
    var idx = {};
    for (var h = 0; h < headers.length; h++) { idx[String(headers[h]).toLowerCase().trim()] = h; }
    var munCol = idx['municipality'], deliveryCol = idx['delivery_type'], itemsCol = idx['items_json'],
        subCol = idx['subtotal'], shipCol = idx['shipping_note'], statusCol = idx['status'],
        notesCol = idx['notes'], orderIdCol = idx['order_id'];
    var data = ordSheet.getDataRange().getValues();
    var repaired = 0;
    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      var munVal = munCol >= 0 ? String(row[munCol]) : '';
      var delVal = deliveryCol >= 0 ? String(row[deliveryCol]) : '';
      if (/^(Home|Office)$/i.test(munVal) && delVal.indexOf('[') === 0) {
        // Columns shifted by one: true values sit one column left.
        //   delivery_type = munVal (Office/Home)
        //   items_json    = delVal (the JSON array)
        //   subtotal      = current items_json value
        //   status        = current shipping_note value
        //   notes         = current status value
        if (munCol >= 0) ordSheet.getRange(r + 1, munCol + 1).setValue('');
        if (deliveryCol >= 0) ordSheet.getRange(r + 1, deliveryCol + 1).setValue(munVal);
        if (itemsCol >= 0) ordSheet.getRange(r + 1, itemsCol + 1).setValue(delVal);
        if (subCol >= 0 && itemsCol >= 0) ordSheet.getRange(r + 1, subCol + 1).setValue(row[itemsCol]);
        if (shipCol >= 0) ordSheet.getRange(r + 1, shipCol + 1).setValue('سعر التوصيل يُحدد بعد التأكيد');
        if (statusCol >= 0 && shipCol >= 0) ordSheet.getRange(r + 1, statusCol + 1).setValue(row[shipCol]);
        if (notesCol >= 0 && statusCol >= 0) ordSheet.getRange(r + 1, notesCol + 1).setValue(row[statusCol]);
        var orderId = orderIdCol >= 0 ? row[orderIdCol] : ('row ' + (r + 1));
        results.push('Orders row ' + (r + 1) + ' (' + orderId + '): repaired shifted columns');
        repaired++;
      }
    }
    results.push('Orders: repaired ' + repaired + ' shifted row(s)');
  }

  try { CacheService.getScriptCache().remove('catalog'); CacheService.getScriptCache().remove('settings'); } catch(e) {}
  return { ok: true, results: results };
}

function generateOrderId() {
  var now = new Date();
  var datePart = Utilities.formatDate(now, 'Africa/Algiers', 'yyyyMMdd');
  // 8 hex chars from a v4 UUID (cryptographically random) -> 4 billion+ combos, not enumerable.
  var randomPart = Utilities.getUuid().replace(/-/g, '').substring(0, 8).toUpperCase();
  return 'SK-' + datePart + '-' + randomPart;
}

function adminListProducts() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Catalog');
  if (!sheet) return { products: [] };
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return { products: [] };
  var headers = data[0];
  var products = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue; // تخطي الصفوف الفارغة
    var row = data[i];
    var product = { _row: i + 1 };
    for (var j = 0; j < headers.length; j++) { product[headers[j]] = row[j]; }
    
    // توقع حقول التفاعل مع تهيئة افتراضية
    var size = product.size || '';
    var color = product.color || '';
    var variant_name = product.variant_name || '';
    var variant_sku = product.variant_sku || '';
    var variant_price = product.variant_price || '';
    var variant_stock = product.variant_stock || '';
    var variant_options = product.variant_options || '[]';
    
    // تكوين نموذج خيارات التفاعل
    var variantModel = {
      sizes: size ? size.split(',').map(s => s.trim()).filter(s => s) : [],
      colors: color ? color.split(',').map(c => c.trim()).filter(c => c) : [],
      name: variant_name,
      sku: variant_sku,
      price: variant_price ? parseFloat(variant_price) || 0 : 0,
      stock: variant_stock ? parseInt(variant_stock) || 0 : 0,
      options: []
    };
    
    // إنشاء مجموعة بجميع التركيبات الممكنة
    if (variantModel.sizes.length > 0 && variantModel.colors.length > 0) {
      variantModel.sizes.forEach(function(s) {
        variantModel.colors.forEach(function(c) {
          variantModel.options.push({
            size: s,
            color: c,
            sku: variantModel.sku || (variantModel.sizes.length <= 2 && variantModel.colors.length <= 2 ? 
              (s === variantModel.sizes[0] && c === variantModel.colors[0] ? 'BASE' : 
               'COMBO') : 
              'VAR-' + s + '-' + c),
            price: variantModel.price,
            stock: variantModel.stock,
            image: variantModel.image || ''
          });
        });
      });
    }
    
    product.variant_model = variantModel;
    
    products.push(product);
  }
  return { products: products };
}

function adminAddProduct(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Catalog');
  if (!sheet) return { error: 'Catalog sheet not found' };
  var id = params.id || ('PROD-' + Date.now());

  // SELECTION HANDLERS for variant fields - support both string and array
  var size = '';
  if (params.size) {
    if (Array.isArray(params.size)) size = params.size.join(', ');
    else size = String(params.size);
  }

  var color = '';
  if (params.color) {
    if (Array.isArray(params.color)) color = params.color.join(', ');
    else color = String(params.color);
  }

  var variant_name = params.variant_name || '';
  var variant_sku = params.variant_sku || '';
  var variant_price = params.variant_price || '';
  var variant_stock = params.variant_stock || '';

  // FIX: Handle variant matrix — if comma-separated string, use first value
  if (size.includes(',') && !variant_name) {
    variant_name = size.split(',')[0];
    size = size.split(',')[0].trim();
  }
  if (color.includes(',') && !variant_sku) {
    variant_sku = color.split(',')[0];
    color = color.split(',')[0].trim();
  }

  sheet.appendRow([
    id, params.title_ar || '', params.title_en || '',
    params.price || 0, params.old_price || 0, params.currency || 'DZD',
    params.image1 || '', params.image2 || '', params.image3 || '',
    params.image4 || '', params.image5 || '', params.image6 || '',
    params.category_ar || '', params.category_en || '',
    params.desc_ar || '', params.desc_en || '',
    params.stock || 0,
    params.active === false || params.active === 'false' ? false : true,
    size, color,
    variant_name, variant_sku,
    variant_price, variant_stock,
    JSON.stringify(params.variant_options || [])
  ]);
  try { CacheService.getScriptCache().remove('catalog'); } catch(e) {}
  return { ok: true, id: id };
}

function adminEditProduct(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Catalog');
  if (!sheet) return { error: 'Catalog sheet not found' };
  var row = parseInt(params._row);
  if (!row || row < 2) return { error: 'Invalid row' };
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  
  // SELECTION HANDLERS for variant fields - support both string and array
  var size = params.size !== undefined ? (Array.isArray(params.size) ? params.size.join(', ') : String(params.size)) : null;
  if (size !== null) {
    var colIndex = headers.indexOf('size');
    if (colIndex >= 0) sheet.getRange(row, colIndex + 1).setValue(size);
  }
  
  var color = params.color !== undefined ? (Array.isArray(params.color) ? params.color.join(', ') : String(params.color)) : null;
  if (color !== null) {
    var colIndex = headers.indexOf('color');
    if (colIndex >= 0) sheet.getRange(row, colIndex + 1).setValue(color);
  }

  var variant_name = params.variant_name !== undefined ? String(params.variant_name) : null;
  if (variant_name !== null) {
    var colIndex = headers.indexOf('variant_name');
    if (colIndex >= 0) sheet.getRange(row, colIndex + 1).setValue(variant_name);
  }

  var variant_sku = params.variant_sku !== undefined ? String(params.variant_sku) : null;
  if (variant_sku !== null) {
    var colIndex = headers.indexOf('variant_sku');
    if (colIndex >= 0) sheet.getRange(row, colIndex + 1).setValue(variant_sku);
  }

  var variant_price = params.variant_price !== undefined ? String(params.variant_price) : null;
  if (variant_price !== null) {
    var colIndex = headers.indexOf('variant_price');
    if (colIndex >= 0) sheet.getRange(row, colIndex + 1).setValue(variant_price);
  }

  var variant_stock = params.variant_stock !== undefined ? String(params.variant_stock) : null;
  if (variant_stock !== null) {
    var colIndex = headers.indexOf('variant_stock');
    if (colIndex >= 0) sheet.getRange(row, colIndex + 1).setValue(variant_stock);
  }

  // Process other fields
  for (var j = 0; j < headers.length; j++) {
    if (['size', 'color', 'variant_name', 'variant_sku', 'variant_price', 'variant_stock', '_row'].indexOf(headers[j]) >= 0) continue;
    if (params[headers[j]] !== undefined && params[headers[j]] !== null) {
      var val = params[headers[j]];
      if (headers[j] === 'active') { val = (val === true || val === 'true' || val === 'TRUE' || val === 1 || val === '1'); }
      sheet.getRange(row, j + 1).setValue(val);
    }
  }
  try { CacheService.getScriptCache().remove('catalog'); } catch(e) {}
  return { ok: true };
}

function adminDeleteProduct(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Catalog');
  if (!sheet) return { error: 'Catalog sheet not found' };
  var row = parseInt(params._row);
  if (!row || row < 2) return { error: 'Invalid row' };
  sheet.deleteRow(row);
  try { CacheService.getScriptCache().remove('catalog'); } catch(e) {}
  return { ok: true };
}

function adminListOrders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Orders');
  if (!sheet) return { orders: [] };
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var statusCol = -1;
  for (var k = 0; k < headers.length; k++) {
    var h = headers[k].toString().toLowerCase().trim();
    if (h === 'status') { statusCol = k; break; }
    if (h === 'shipping_note') { statusCol = k; }
  }
  var orders = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var order = { _row: i + 1 };
    for (var j = 0; j < headers.length; j++) { order[headers[j]] = row[j]; }
    if (statusCol >= 0) { order.status = row[statusCol]; }
    orders.push(order);
  }
  orders.reverse();
  return { orders: orders };
}

function adminUpdateOrder(params) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Orders');
    if (!sheet) return { error: 'Orders sheet not found' };
    var row = parseInt(params._row);
    if (!row || row < 2) return { error: 'Invalid row: ' + params._row };
    var lastRow = sheet.getLastRow();
    if (row > lastRow) return { error: 'Row ' + row + ' exceeds sheet rows (' + lastRow + ')' };
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var statusCol = -1;
    for (var i = 0; i < headers.length; i++) {
      var h = headers[i].toString().toLowerCase().trim();
      if (h === 'status') { statusCol = i + 1; break; }
      if (h === 'shipping_note') { statusCol = i + 1; }
    }
    var oldStatus = statusCol > 0 ? String(sheet.getRange(row, statusCol).getValue()).toLowerCase().trim() : '';
    if (params.status) {
      if (statusCol === -1) return { error: 'Status column not found. Headers: ' + headers.join(', ') };
      sheet.getRange(row, statusCol).setValue(params.status);
      var itemsCol = -1;
      for (var i = 0; i < headers.length; i++) {
        var h = headers[i].toString().toLowerCase().trim();
        if (h === 'items_json' || h === 'items') { itemsCol = i + 1; break; }
      }
      var itemsJson = itemsCol > 0 ? String(sheet.getRange(row, itemsCol).getValue()) : '[]';
      var newStatus = params.status.toLowerCase().trim();
      if (newStatus === 'delivered' && oldStatus !== 'delivered') {
        adjustStock(itemsJson, -1);
      }
      if (newStatus === 'cancelled' && oldStatus === 'delivered') {
        adjustStock(itemsJson, 1);
      }
    }
    if (params.notes !== undefined) {
      var notesCol = -1;
      for (var i = 0; i < headers.length; i++) {
        var h = headers[i].toString().toLowerCase().trim();
        if (h === 'notes' || h === 'note') { notesCol = i + 1; break; }
      }
      if (notesCol > 0) sheet.getRange(row, notesCol).setValue(params.notes);
    }
    SpreadsheetApp.flush();
    return { ok: true, row: row, status: params.status, oldStatus: oldStatus };
  } catch(ex) {
    return { error: ex.toString() };
  }
}

function adjustStock(itemsJson, direction) {
  try {
    var items = JSON.parse(itemsJson || '[]');
    if (!items.length) return;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var catalog = ss.getSheetByName('Catalog');
    if (!catalog) return;
    var data = catalog.getDataRange().getValues();
    var headers = data[0];
    var idCol = headers.indexOf('id');
    var stockCol = headers.indexOf('stock');
    if (idCol < 0 || stockCol < 0) return;
    for (var i = 1; i < data.length; i++) {
      var productId = data[i][idCol];
      for (var j = 0; j < items.length; j++) {
        if (items[j].id === productId) {
          var currentStock = parseInt(data[i][stockCol]) || 0;
          var change = (items[j].qty || 1) * direction;
          var newStock = Math.max(0, currentStock + change);
          catalog.getRange(i + 1, stockCol + 1).setValue(newStock);
        }
      }
    }
  } catch(ex) {}
}

function adminDeleteOrder(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Orders');
  if (!sheet) return { error: 'Orders sheet not found' };
  var row = parseInt(params._row);
  if (!row || row < 2) return { error: 'Invalid row' };
  sheet.deleteRow(row);
  return { ok: true };
}

function adminUpdateSettings(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Settings');
  if (!sheet) return { error: 'Settings sheet not found' };
  var data = sheet.getDataRange().getValues();
  var secretKeys = { fb_capi_token: true, gemini_api_key: true, admin_password: true, admin_recovery: true };
  var passwordChanged = false;
  for (var key in params) {
    if (key === 'action' || key === 'callback') continue;
    if (secretKeys[key] && (params[key] === '' || params[key] === undefined || params[key] === null)) continue;
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === key) { sheet.getRange(i + 1, 2).setValue(params[key]); found = true; break; }
    }
    if (!found) sheet.appendRow([key, params[key]]);
    if (key === 'admin_password') passwordChanged = true;
  }
  if (passwordChanged) {
    var recovery = generateRecoveryCode();
    try { CacheService.getScriptCache().remove('settings'); } catch(e) {}
    return { ok: true, recovery_code: recovery.recovery_code || '' };
  }
  try { CacheService.getScriptCache().remove('settings'); } catch(e) {}
  return { ok: true };
}

function getTestimonials() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Testimonials');
  if (!sheet) return { testimonials: [] };
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return { testimonials: [] };
  var headers = data[0];
  var testimonials = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var t = {};
    for (var j = 0; j < headers.length; j++) { t[headers[j]] = row[j]; }
    if (t.active === true || t.active === 'TRUE' || t.active === 'true' || t.active === 1) {
      testimonials.push(t);
    }
  }
  return { testimonials: testimonials };
}

function adminListTestimonials() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Testimonials');
  if (!sheet) {
    ss.insertSheet('Testimonials');
    var newSheet = ss.getSheetByName('Testimonials');
    newSheet.appendRow(['name', 'location', 'text', 'rating', 'active', 'created_at']);
    return { testimonials: [] };
  }
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return { testimonials: [] };
  var headers = data[0];
  var testimonials = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var t = { _row: i + 1 };
    for (var j = 0; j < headers.length; j++) { t[headers[j]] = row[j]; }
    testimonials.push(t);
  }
  return { testimonials: testimonials };
}

function adminAddTestimonial(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Testimonials');
  if (!sheet) {
    sheet = ss.insertSheet('Testimonials');
    sheet.appendRow(['name', 'location', 'text', 'rating', 'active', 'created_at']);
  }
  var now = Utilities.formatDate(new Date(), 'Africa/Algiers', 'yyyy-MM-dd HH:mm:ss');
  var rating = parseInt(params.rating) || 5;
  if (rating < 1) rating = 1; if (rating > 5) rating = 5;
  sheet.appendRow([
    _sanitize(params.name, 100), _sanitize(params.location, 100),
    _sanitize(params.text, 1000), rating, params.active !== 'false', now
  ]);
  return { ok: true };
}

function adminEditTestimonial(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Testimonials');
  if (!sheet) return { error: 'Testimonials sheet not found' };
  var row = parseInt(params._row);
  if (!row || row < 2) return { error: 'Invalid row' };
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  for (var j = 0; j < headers.length; j++) {
    if (params[headers[j]] !== undefined) {
      var val = params[headers[j]];
      if (headers[j] === 'active') { val = (val === true || val === 'true' || val === 'TRUE' || val === 1 || val === '1'); }
      sheet.getRange(row, j + 1).setValue(val);
    }
  }
  return { ok: true };
}

function adminDeleteTestimonial(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Testimonials');
  if (!sheet) return { error: 'Testimonials sheet not found' };
  var row = parseInt(params._row);
  if (!row || row < 2) return { error: 'Invalid row' };
  sheet.deleteRow(row);
  return { ok: true };
}

function adminUploadImage(params) {
  var v = _createVerifiedUpload(params.imageData, params.mimeType);
  return { ok: !!v.ok, url: v.url || '', _num: params.num || '1', error: v.error || '' };
}

function getOrCreateFolderId() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('smartshopping_images_folder');
  if (folderId) return folderId;
  var folder = DriveApp.createFolder('SmartShopping_Images');
  props.setProperty('smartshopping_images_folder', folder.getId());
  return folder.getId();
}

function adminUploadImageGet(params) {
  var v = _createVerifiedUpload(params.base64, params.mimeType);
  return { ok: !!v.ok, url: v.url || '', _num: params.num || '1', error: v.error || '' };
}

function verifyAdmin(params) {
  var storedPassword = getSettingsValue('admin_password');
  if (!storedPassword) return { ok: false, error: 'لم يتم تعيين كلمة مرور. أدخل كلمة مرور في الإعدادات أولاً.', setupRequired: true };
  if (_loginBlocked()) return { ok: false, error: 'محاولات كثيرة خاطئة. انتظر دقيقة وحاول مرة أخرى.' };
  if (params.password === storedPassword) {
    _loginReset();
    return { ok: true, token: _issueAdminToken() };
  }
  _loginRecordFailure();
  return { ok: false, error: 'كلمة المرور غير صحيحة' };
}

function hashString(str) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i];
    if (b < 0) b += 256;
    hex += ('0' + b.toString(16)).slice(-2);
  }
  return hex;
}

function generateRecoveryCode() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var code = '';
  for (var i = 0; i < 16; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  var hashed = hashString(code);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Settings');
  if (!sheet) return { error: 'Settings sheet not found' };
  var data = sheet.getDataRange().getValues();
  var found = false;
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === 'admin_recovery') { sheet.getRange(i + 1, 2).setValue(hashed); found = true; break; }
  }
  if (!found) sheet.appendRow(['admin_recovery', hashed]);
  return { ok: true, recovery_code: code };
}

function verifyRecovery(params) {
  var storedHash = getSettingsValue('admin_recovery');
  var providedHash = params.code ? hashString(params.code) : '';
  if (!storedHash) return { ok: false, error: 'لا يوجد رمز استرجاع. استخدم إعدادات Google Sheet.' };
  if (!providedHash) return { ok: false, error: 'أدخل رمز الاسترجاع' };
  if (_loginBlocked()) return { ok: false, error: 'محاولات كثيرة خاطئة. انتظر دقيقة وحاول مرة أخرى.' };
  if (providedHash === storedHash) {
    _loginReset();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Settings');
    if (sheet) {
      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (data[i][0] === 'admin_recovery') { sheet.getRange(i + 1, 2).setValue(''); }
        if (data[i][0] === 'admin_password') { sheet.getRange(i + 1, 2).setValue(''); }
      }
    }
    try { CacheService.getScriptCache().remove('settings'); } catch(e) {}
    return { ok: true };
  }
  _loginRecordFailure();
  return { ok: false, error: 'رمز الاسترجاع غير صحيح' };
}

function validateCoupon(params) {
  var code = (params.coupon_code || '').toUpperCase().trim();
  if (!code) return { valid: false, error: 'Enter a coupon code' };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Coupons');
  if (!sheet) return { valid: false, error: 'No coupons available' };
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return { valid: false, error: 'Invalid coupon' };
  var headers = data[0];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var coupon = {};
    for (var j = 0; j < headers.length; j++) { coupon[headers[j]] = row[j]; }
    if ((coupon.code || '').toUpperCase() === code) {
      if (coupon.active === false || coupon.active === 'FALSE' || coupon.active === 'false') {
        return { valid: false, error: 'Coupon is inactive' };
      }
      if (coupon.expiry) {
        var expiryDate = new Date(coupon.expiry);
        if (expiryDate < new Date()) return { valid: false, error: 'Coupon expired' };
      }
      var maxUses = parseInt(coupon.max_uses) || 999999;
      var usedCount = parseInt(coupon.used_count) || 0;
      if (usedCount >= maxUses) return { valid: false, error: 'Coupon usage limit reached' };
      var minOrder = parseInt(coupon.min_order) || 0;
      var subtotal = parseInt(params.subtotal) || 0;
      if (subtotal < minOrder) return { valid: false, error: 'Minimum order for this coupon is ' + minOrder + ' DZD' };
      var percent = parseFloat(coupon.percent) || 0;
      var discount = Math.round(subtotal * percent / 100);
      sheet.getRange(i + 1, headers.indexOf('used_count') + 1).setValue(usedCount + 1);
      return { valid: true, percent: percent, discount: discount, code: code };
    }
  }
  return { valid: false, error: 'Invalid coupon code' };
}

function adminListCoupons() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Coupons');
  if (!sheet) return { coupons: [] };
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return { coupons: [] };
  var headers = data[0];
  var coupons = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var coupon = { _row: i + 1 };
    for (var j = 0; j < headers.length; j++) { coupon[headers[j]] = row[j]; }
    coupons.push(coupon);
  }
  return { coupons: coupons };
}

function adminAddCoupon(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Coupons');
  if (!sheet) {
    sheet = ss.insertSheet('Coupons');
    sheet.appendRow(['code', 'percent', 'min_order', 'max_uses', 'used_count', 'expiry', 'active']);
  }
  sheet.appendRow([
    (params.code || '').toUpperCase().trim(),
    params.percent || 10,
    params.min_order || 0,
    params.max_uses || 100,
    0,
    params.expiry || '',
    params.active === false || params.active === 'false' ? false : true
  ]);
  return { ok: true };
}

function adminEditCoupon(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Coupons');
  if (!sheet) return { error: 'Coupons sheet not found' };
  var row = parseInt(params._row);
  if (!row || row < 2) return { error: 'Invalid row' };
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  for (var j = 0; j < headers.length; j++) {
    if (params[headers[j]] !== undefined) {
      var val = params[headers[j]];
      if (headers[j] === 'active') { val = (val === true || val === 'true' || val === 'TRUE' || val === 1 || val === '1'); }
      if (headers[j] === 'code') { val = (val || '').toUpperCase().trim(); }
      sheet.getRange(row, j + 1).setValue(val);
    }
  }
  return { ok: true };
}

function adminDeleteCoupon(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Coupons');
  if (!sheet) return { error: 'Coupons sheet not found' };
  var row = parseInt(params._row);
  if (!row || row < 2) return { error: 'Invalid row' };
  sheet.deleteRow(row);
  return { ok: true };
}

// === Reviews ===
function getReviews(params) {
  var pid = params.product_id || '';
  if (!pid) return { reviews: [] };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Reviews');
  if (!sheet) return { reviews: [] };
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return { reviews: [] };
  var headers = data[0];
  var reviews = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var r = {};
    for (var j = 0; j < headers.length; j++) { r[headers[j]] = row[j]; }
    if (r.product_id === pid && (r.active === true || r.active === 'TRUE' || r.active === 'true' || r.active === 1)) {
      reviews.push(r);
    }
  }
  return { reviews: reviews };
}

function addReview(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Reviews');
  if (!sheet) {
    sheet = ss.insertSheet('Reviews');
    sheet.appendRow(['product_id', 'name', 'location', 'text', 'rating', 'active', 'created_at', 'photos']);
  }
  var now = Utilities.formatDate(new Date(), 'Africa/Algiers', 'yyyy-MM-dd HH:mm:ss');
  // Sanitize user input (defense-in-depth alongside frontend escaping)
  var rating = parseInt(params.rating) || 5;
  if (rating < 1) rating = 1; if (rating > 5) rating = 5;
  sheet.appendRow([
    _sanitize(params.product_id, 50),
    _sanitize(params.name, 100),
    _sanitize(params.location, 100),
    _sanitize(params.text, 1000),
    rating,
    true,
    now,
    _sanitize(params.photos, 500)
  ]);
  return { ok: true };
}

function adminListReviews() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Reviews');
  if (!sheet) return { reviews: [] };
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return { reviews: [] };
  var headers = data[0];
  var reviews = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var r = { _row: i + 1 };
    for (var j = 0; j < headers.length; j++) { r[headers[j]] = row[j]; }
    reviews.push(r);
  }
  reviews.reverse();
  return { reviews: reviews };
}

function adminDeleteReview(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Reviews');
  if (!sheet) return { error: 'Reviews sheet not found' };
  var row = parseInt(params._row);
  if (!row || row < 2) return { error: 'Invalid row' };
  sheet.deleteRow(row);
  return { ok: true };
}

// === Pages ===
function getPages() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Pages');
  if (!sheet) return {};
  var data = sheet.getDataRange().getValues();
  var pages = {};
  for (var i = 1; i < data.length; i++) { pages[data[i][0]] = data[i][1]; }
  return pages;
}

function adminListPages() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Pages');
  if (!sheet) return { pages: {} };
  var data = sheet.getDataRange().getValues();
  var pages = {};
  for (var i = 1; i < data.length; i++) { pages[data[i][0]] = data[i][1]; }
  return { pages: pages };
}

function adminSavePage(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Pages');
  if (!sheet) {
    sheet = ss.insertSheet('Pages');
    sheet.appendRow(['key', 'content']);
  }
  var key = params.key || '';
  var content = params.content || '';
  if (!key) return { error: 'No key' };
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(content);
      return { ok: true };
    }
  }
  sheet.appendRow([key, content]);
  return { ok: true };
}

// === Customers ===
function _hashCustomerPassword(password, phone) {
  // Hash with SHA-256 + phone as salt for per-customer uniqueness
  return hashString(password + ':' + phone);
}

function customerRegister(params) {
  var phone = (params.phone || '').replace(/\s/g, '').trim();
  var password = params.password || '';
  var name = params.name || '';
  if (!phone || !password) return { ok: false, error: 'Phone and password required' };
  if (password.length < 4) return { ok: false, error: 'Password must be at least 4 characters' };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Customers');
  if (!sheet) {
    sheet = ss.insertSheet('Customers');
    sheet.appendRow(['phone', 'password', 'name', 'email', 'created_at', 'orders_count', 'total_spent']);
  }
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === phone) return { ok: false, error: 'Phone number already registered' };
  }
  var now = Utilities.formatDate(new Date(), 'Africa/Algiers', 'yyyy-MM-dd HH:mm:ss');
  var hashedPw = _hashCustomerPassword(password, phone);
  sheet.appendRow([phone, hashedPw, name, '', now, 0, 0]);
  return { ok: true, customer: { phone: phone, name: name } };
}

function customerLogin(params) {
  var phone = (params.phone || '').replace(/\s/g, '').trim();
  var password = params.password || '';
  if (!phone || !password) return { ok: false, error: 'Phone and password required' };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Customers');
  if (!sheet) return { ok: false, error: 'No accounts found' };
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return { ok: false, error: 'Account not found' };
  var headers = data[0];
  var hashedInput = _hashCustomerPassword(password, phone);
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[0] === phone) {
      if (row[1] === hashedInput) {
        var customer = {};
        for (var j = 0; j < headers.length; j++) { customer[headers[j]] = row[j]; }
        delete customer.password;
        return { ok: true, customer: customer };
      }
      return { ok: false, error: 'Wrong password' };
    }
  }
  return { ok: false, error: 'Account not found' };
}

function customerProfile(params) {
  var phone = (params.phone || '').replace(/\s/g, '').trim();
  var password = params.password || '';
  if (!phone || !password) return { ok: false, error: 'Phone and password required' };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Customers');
  if (!sheet) return { ok: false, error: 'No accounts' };
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var hashedInput = _hashCustomerPassword(password, phone);
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === phone) {
      if (data[i][1] !== hashedInput) return { ok: false, error: 'Wrong password' };
      var customer = {};
      for (var j = 0; j < headers.length; j++) { customer[headers[j]] = data[i][j]; }
      delete customer.password;
      return { ok: true, customer: customer };
    }
  }
  return { ok: false, error: 'Account not found' };
}

function adminListCustomers() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Customers');
  if (!sheet) return { customers: [] };
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return { customers: [] };
  var headers = data[0];
  var customers = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var c = { _row: i + 1 };
    for (var j = 0; j < headers.length; j++) { c[headers[j]] = row[j]; }
    delete c.password;
    customers.push(c);
  }
  customers.reverse();
  return { customers: customers };
}

// === Newsletter ===
function newsletterSubscribe(params) {
  var email = (params.email || '').toLowerCase().trim();
  if (!email || email.indexOf('@') < 1) return { ok: false, error: 'Invalid email' };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Newsletter');
  if (!sheet) {
    sheet = ss.insertSheet('Newsletter');
    sheet.appendRow(['email', 'subscribed_at']);
  }
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === email) return { ok: false, exists: true };
  }
  var now = Utilities.formatDate(new Date(), 'Africa/Algiers', 'yyyy-MM-dd HH:mm:ss');
  sheet.appendRow([email, now]);
  return { ok: true };
}

function adminListSubscribers() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Newsletter');
  if (!sheet) return { subscribers: [] };
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return { subscribers: [] };
  var headers = data[0];
  var subs = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var s = { _row: i + 1 };
    for (var j = 0; j < headers.length; j++) { s[headers[j]] = row[j]; }
    subs.push(s);
  }
  subs.reverse();
  return { subscribers: subs };
}

// === Themes (advanced theming system) ===
function getThemesSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Themes');
  if (!sheet) {
    sheet = ss.insertSheet('Themes');
    sheet.appendRow(['id', 'name', 'author', 'version', 'base', 'is_default', 'theme_json', 'created_at']);
  }
  return sheet;
}

function adminListThemes() {
  var sheet = getThemesSheet();
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return { themes: [] };
  var headers = data[0];
  var idCol = headers.indexOf('id');
  var themes = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var t = {};
    for (var j = 0; j < headers.length; j++) { t[headers[j]] = row[j]; }
    // auto-fix empty IDs
    if (!t.id && idCol >= 0) {
      t.id = 'theme-' + Utilities.formatDate(new Date(), 'GMT', 'yyyyMMddHHmmss');
      sheet.getRange(i + 1, idCol + 1).setValue(t.id);
    }
    var tokens = {};
    try { tokens = JSON.parse(t.theme_json || '{}'); } catch (e) { tokens = {}; }
    themes.push({
      id: t.id, name: t.name, author: t.author, version: t.version,
      base: t.base, is_default: (t.is_default === true || t.is_default === 'TRUE' || t.is_default === 'true' || t.is_default === 1),
      tokens: tokens
    });
  }
  return { themes: themes };
}

function adminSaveTheme(params) {
  var id = _sanitize(params.id, 100);
  if (!id) id = 'theme-' + Utilities.formatDate(new Date(), 'GMT', 'yyyyMMddHHmmss');
  var name = _sanitize(params.name, 100);
  var author = _sanitize(params.author, 100);
  var version = _sanitize(params.version, 20);
  var base = params.base === 'dark' ? 'dark' : 'light';
  var themeJson = params.theme_json || '{}';
  try { JSON.parse(themeJson); } catch (e) { return { error: 'Invalid theme JSON' }; }
  var sheet = getThemesSheet();
  var data = sheet.getDataRange().getValues();
  var idCol = data[0].indexOf('id');
  for (var i = 1; i < data.length; i++) {
    if (data[i][idCol] === id) {
      sheet.getRange(i + 1, 2).setValue(name);
      sheet.getRange(i + 1, 3).setValue(author);
      sheet.getRange(i + 1, 4).setValue(version);
      sheet.getRange(i + 1, 5).setValue(base);
      sheet.getRange(i + 1, 7).setValue(themeJson);
      return { ok: true, updated: true };
    }
  }
  var now = Utilities.formatDate(new Date(), 'Africa/Algiers', 'yyyy-MM-dd HH:mm:ss');
  sheet.appendRow([id, name, author, version, base, false, themeJson, now]);
  return { ok: true, created: true };
}

function adminDeleteTheme(params) {
  var id = params.theme_id || params.id || '';
  if (!id) return { error: 'Theme ID is empty - please re-save the theme first' };
  var sheet = getThemesSheet();
  var data = sheet.getDataRange().getValues();
  var idCol = data[0].indexOf('id');
  for (var i = 1; i < data.length; i++) {
    if (data[i][idCol] === id) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { error: 'Theme not found' };
}

function adminSetDefaultTheme(params) {
  var id = params.theme_id || params.id || '';
  if (!id) return { error: 'No theme id' };
  var sheet = getThemesSheet();
  var data = sheet.getDataRange().getValues();
  var idCol = data[0].indexOf('id');
  var defCol = data[0].indexOf('is_default');
  var found = false;
  for (var i = 1; i < data.length; i++) {
    if (data[i][idCol] === id) {
      sheet.getRange(i + 1, defCol + 1).setValue(true);
      found = true;
    } else {
      sheet.getRange(i + 1, defCol + 1).setValue(false);
    }
  }
  if (!found) return { error: 'Theme not found' };
  return { ok: true };
}

// === AI Chat with Gemini ===
function aiChat(params) {
  var message = params.message || '';
  if (!message) return { reply: 'Please send a message.' };
  // Sanitize: limit message length
  message = message.substring(0, 500);

  var settings = getSettings();
  var apiKey = settings.gemini_api_key || '';
  if (!apiKey) return { reply: 'AI not configured. Please set Gemini API key in settings.' };

  // Limit chat history depth to prevent token abuse
  var chatHistory = [];
  if (params.history) {
    try { chatHistory = JSON.parse(params.history); } catch(e) {}
  }
  if (chatHistory.length > 20) {
    chatHistory = chatHistory.slice(-20);
  }

  var products = getCatalog().products || [];
  var productList = products.map(function(p) {
    var name = p.title_ar || p.title_en || '';
    var price = p.price || 0;
    var oldPrice = p.old_price || 0;
    var stock = p.stock || 0;
    var category = p.category_ar || p.category_en || '';
    var status = stock > 0 ? 'in stock' : 'OUT OF STOCK';
    var discount = oldPrice > 0 ? Math.round((oldPrice - price) / oldPrice * 100) + '% off' : '';
    var id = p.id || '';
    return id + ' | ' + name + ' | ' + price + ' DZD' + (discount ? ' (' + discount + ')' : '') + ' | stock: ' + stock + ' ' + status + ' | cat: ' + category;
  }).join('\n');

  var systemPrompt = settings.ai_prompt || 'You are the Smart Shopping Algeria store manager AI. You know EVERYTHING about the store inventory. You have access to the full product database below. When a customer asks about products, tell them EXACTLY what is available with real names, real prices, and real stock status. If a product is out of stock, say so honestly. If they ask about a product you have, give them the price and stock. If they ask about a product you don\'t have, say you don\'t carry it. Be honest about stock - never say a product is available if stock is 0. Give product IDs when mentioning products so the customer can find them. Reply in the same language the customer uses. Be warm, professional, and helpful like a real store manager.';

  var fullContext = systemPrompt + '\n\n=== PRODUCT DATABASE (' + products.length + ' products) ===\n' + productList + '\n=== END DATABASE ===\n\nStore: Smart Shopping Algeria. Payment: COD. Shipping: 58 wilayas. WhatsApp: 0557543177.';

  var contents = [];
  chatHistory.forEach(function(h) {
    contents.push({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.text }] });
  });
  contents.push({ role: 'user', parts: [{ text: message }] });

  var payload = {
    system_instruction: { parts: [{ text: fullContext }] },
    contents: contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024
    }
  };

  var models = getAvailableModels(apiKey);

  for (var i = 0; i < models.length; i++) {
    try {
      var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + models[i] + ':generateContent?key=' + apiKey;
      var options = {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      };
      var response = UrlFetchApp.fetch(url, options);
      var json = JSON.parse(response.getContentText());

      if (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts) {
        var reply = json.candidates[0].content.parts[0].text;
        return { reply: reply };
      }
      continue;
    } catch(e) {
      continue;
    }
  }

  var wa = getSettingsValue('phone') || getSettingsValue('whatsapp') || '213557543177';
  return { reply: 'All AI models unavailable. Contact us on WhatsApp: +' + wa };
}

function getAvailableModels(apiKey) {
  try {
    var url = 'https://generativelanguage.googleapis.com/v1beta/models?key=' + apiKey;
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var json = JSON.parse(response.getContentText());

    if (json.models) {
      var models = [];
      for (var i = 0; i < json.models.length; i++) {
        var m = json.models[i];
        if (m.supportedGenerationMethods) {
          var methods = m.supportedGenerationMethods;
          if (methods.indexOf('generateContent') > -1 && methods.indexOf('embedContent') === -1) {
            var name = m.name.replace('models/', '');
            models.push(name);
          }
        }
      }
      models.sort(function(a, b) {
        if (a.indexOf('flash') > -1 && b.indexOf('flash') === -1) return -1;
        if (a.indexOf('flash') === -1 && b.indexOf('flash') > -1) return 1;
        return 0;
      });
      return models;
    }
    return [];
  } catch(e) {
    return [];
  }
}
