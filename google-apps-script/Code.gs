// SmartKiosk - Google Apps Script Backend
// Deploy as Web App → Execute as: Me → Who has access: Anyone

function doGet(e) {
  var params = e.parameter;
  var action = params.action || '';
  var callback = params.callback || '';
  var result;

  switch (action) {
    case 'catalog': result = getCatalog(); break;
    case 'settings': result = getSettings(); break;
    case 'track': result = trackOrder(params.order_id || ''); break;
    case 'order': result = createOrder(params); break;
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
    default: result = { error: 'Unknown action' };
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

  switch (action) {
    case 'order': result = createOrder(params); break;
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
    default: result = { error: 'Unknown action' };
  }

  var json = JSON.stringify(result);
  if (action === 'admin_upload_image') {
    var safeJson = json.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/</g, '\\x3c');
    return ContentService.createTextOutput(
      '<script>try{window.top.postMessage(' + safeJson + ',"*");}catch(e){document.title="ERROR";}</script>'
    ).setMimeType(ContentService.MimeType.HTML);
  }
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function getCatalog() {
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
    if (product.active === true || product.active === 'TRUE' || product.active === 'true' || product.active === 1) {
      products.push(product);
    }
  }
  return { products: products };
}

function getSettings() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Settings');
  if (!sheet) return {};
  var data = sheet.getDataRange().getValues();
  var settings = {};
  for (var i = 1; i < data.length; i++) { settings[data[i][0]] = data[i][1]; }
  return settings;
}

function trackOrder(orderId) {
  if (!orderId) return { error: 'No order_id provided' };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Orders');
  if (!sheet) return { error: 'Orders sheet not found' };
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var idIndex = headers.indexOf('order_id');
    if (row[idIndex] === orderId) {
      var order = {};
      for (var j = 0; j < headers.length; j++) { order[headers[j]] = row[j]; }
      return { found: true, order: order };
    }
  }
  return { found: false, error: 'Order not found' };
}

function createOrder(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Orders');
  if (!sheet) return { error: 'Orders sheet not found' };
  var orderId = generateOrderId();
  var now = new Date();
  var createdAt = Utilities.formatDate(now, 'Africa/Algiers', 'yyyy-MM-dd HH:mm:ss');
  sheet.appendRow([
    orderId, createdAt, params.name || '', params.phone || '',
    params.wilaya_code || '', params.wilaya_ar || '', params.wilaya_en || '',
    params.delivery_type || '', params.items_json || '[]',
    params.subtotal || '0', 'سعر التوصيل يُحدد بعد التأكيد', 'pending', params.note || ''
  ]);
  return { ok: true, order_id: orderId };
}

function generateOrderId() {
  var now = new Date();
  var datePart = Utilities.formatDate(now, 'Africa/Algiers', 'yyyyMMdd');
  var randomPart = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return 'SK-' + datePart + '-' + randomPart;
}

function adminListProducts() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Catalog');
  if (!sheet) return { products: [] };
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var products = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var product = { _row: i + 1 };
    for (var j = 0; j < headers.length; j++) { product[headers[j]] = row[j]; }
    products.push(product);
  }
  return { products: products };
}

function adminAddProduct(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Catalog');
  if (!sheet) return { error: 'Catalog sheet not found' };
  var id = params.id || ('PROD-' + Date.now());
  sheet.appendRow([
    id, params.title_ar || '', params.title_en || '',
    params.price || 0, params.old_price || 0, params.currency || 'DZD',
    params.image1 || '', params.image2 || '', params.image3 || '',
    params.category_ar || '', params.category_en || '',
    params.desc_ar || '', params.desc_en || '',
    params.stock || 0, params.active === false || params.active === 'false' ? false : true
  ]);
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
  for (var j = 0; j < headers.length; j++) {
    if (params[headers[j]] !== undefined) {
      var val = params[headers[j]];
      if (headers[j] === 'active') { val = (val === true || val === 'true' || val === 'TRUE' || val === 1 || val === '1'); }
      sheet.getRange(row, j + 1).setValue(val);
    }
  }
  return { ok: true };
}

function adminDeleteProduct(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Catalog');
  if (!sheet) return { error: 'Catalog sheet not found' };
  var row = parseInt(params._row);
  if (!row || row < 2) return { error: 'Invalid row' };
  sheet.deleteRow(row);
  return { ok: true };
}

function adminListOrders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Orders');
  if (!sheet) return { orders: [] };
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var orders = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var order = { _row: i + 1 };
    for (var j = 0; j < headers.length; j++) { order[headers[j]] = row[j]; }
    orders.push(order);
  }
  orders.reverse();
  return { orders: orders };
}

function adminUpdateOrder(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Orders');
  if (!sheet) return { error: 'Orders sheet not found' };
  var row = parseInt(params._row);
  if (!row || row < 2) return { error: 'Invalid row' };
  if (params.status) sheet.getRange(row, 12).setValue(params.status);
  if (params.notes !== undefined) sheet.getRange(row, 13).setValue(params.notes);
  return { ok: true };
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
  for (var key in params) {
    if (key === 'action' || key === 'callback') continue;
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === key) { sheet.getRange(i + 1, 2).setValue(params[key]); found = true; break; }
    }
    if (!found) sheet.appendRow([key, params[key]]);
  }
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
  sheet.appendRow([
    params.name || '', params.location || '', params.text || '',
    params.rating || 5, params.active !== 'false', now
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
  var base64 = params.imageData;
  var fileName = params.fileName || 'image.jpg';
  var mimeType = params.mimeType || 'image/jpeg';
  var num = params.num || '1';
  if (!base64) return { error: 'No image data' };

  var blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, fileName);
  var folder = DriveApp.getFolderById(getOrCreateFolderId());
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var url = 'https://drive.google.com/uc?id=' + file.getId() + '&export=view';
  return { ok: true, url: url, _num: num };
}

function getOrCreateFolderId() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('smartkiosk_images_folder');
  if (folderId) return folderId;
  var folder = DriveApp.createFolder('SmartKiosk_Images');
  props.setProperty('smartkiosk_images_folder', folder.getId());
  return folder.getId();
}

function adminUploadImageGet(params) {
  var base64 = params.base64;
  var fileName = params.fileName || 'image.jpg';
  var num = params.num || '1';
  if (!base64) return { error: 'No image data' };

  try {
    var blob = Utilities.newBlob(Utilities.base64Decode(base64), 'image/jpeg', fileName);
    var folder = DriveApp.getFolderById(getOrCreateFolderId());
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var url = 'https://drive.google.com/uc?id=' + file.getId() + '&export=view';
    return { url: url, _num: num };
  } catch(ex) {
    return { error: ex.toString() };
  }
}

function verifyAdmin(params) {
  var settings = getSettings();
  var storedHash = settings.admin_password || '';
  var providedHash = params.password || '';
  if (!storedHash) return { ok: true, warning: 'No password set' };
  if (providedHash === storedHash) return { ok: true };
  return { ok: false, error: 'Invalid password' };
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
    sheet.appendRow(['product_id', 'name', 'location', 'text', 'rating', 'active', 'created_at']);
  }
  var now = Utilities.formatDate(new Date(), 'Africa/Algiers', 'yyyy-MM-dd HH:mm:ss');
  sheet.appendRow([
    params.product_id || '',
    params.name || '',
    params.location || '',
    params.text || '',
    params.rating || 5,
    true,
    now
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
  sheet.appendRow([phone, password, name, '', now, 0, 0]);
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
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[0] === phone) {
      if (row[1] === password) {
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
  if (!phone) return { ok: false, error: 'Phone required' };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Customers');
  if (!sheet) return { ok: false, error: 'No accounts' };
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === phone) {
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

// === AI Chat with Gemini ===
function aiChat(params) {
  var message = params.message || '';
  var history = params.history || '';
  if (!message) return { reply: 'Please send a message.' };

  var settings = getSettings();
  var apiKey = settings.gemini_api_key || '';
  if (!apiKey) return { reply: 'AI not configured. Please set Gemini API key in settings.' };

  var systemPrompt = settings.ai_prompt || 'You are Smart Assistant for Smart Shopping Algeria. Help customers with product search, prices, shipping, returns, payment, order tracking. Reply in Arabic or Darja as the customer prefers. Be friendly and professional. If asked about a product defect, mention it honestly without exaggeration. If a product is not suitable, tell them honestly instead of pushing them to buy. If you are not sure, say you are not sure and give WhatsApp 0557543177. Do not exaggerate or make up information.';

  var chatHistory = [];
  if (history) {
    try { chatHistory = JSON.parse(history); } catch(e) {}
  }

  var contents = [];
  // Build conversation history
  chatHistory.forEach(function(h) {
    contents.push({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.text }] });
  });
  contents.push({ role: 'user', parts: [{ text: message }] });

  var payload = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024
    }
  };

  try {
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey;
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
    var errMsg = json.error ? JSON.stringify(json.error) : JSON.stringify(json);
    return { reply: 'Error: ' + errMsg };
  } catch(e) {
    return { reply: 'خطأ في الاتصال: ' + e.toString() };
  }
}
