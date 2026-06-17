// SmartKiosk - Google Apps Script Backend (JSONP + Admin CRUD)
// Deploy as Web App → Execute as: Me → Who has access: Anyone

function doGet(e) {
  var params = e.parameter;
  var action = params.action || '';
  var callback = params.callback || '';

  var result;

  switch (action) {
    case 'catalog':
      result = getCatalog();
      break;
    case 'settings':
      result = getSettings();
      break;
    case 'track':
      result = trackOrder(params.order_id || '');
      break;
    case 'order':
      result = createOrder(params);
      break;
    case 'admin_list':
      result = adminListProducts();
      break;
    case 'admin_orders':
      result = adminListOrders();
      break;
    case 'admin_settings':
      result = getSettings();
      break;
    default:
      result = { error: 'Unknown action' };
  }

  var json = JSON.stringify(result);

  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var params = JSON.parse(e.postData.contents);
  var action = params.action || '';
  var callback = params.callback || '';

  var result;

  switch (action) {
    case 'order':
      result = createOrder(params);
      break;
    case 'admin_add_product':
      result = adminAddProduct(params);
      break;
    case 'admin_edit_product':
      result = adminEditProduct(params);
      break;
    case 'admin_delete_product':
      result = adminDeleteProduct(params);
      break;
    case 'admin_update_order':
      result = adminUpdateOrder(params);
      break;
    case 'admin_update_settings':
      result = adminUpdateSettings(params);
      break;
    default:
      result = { error: 'Unknown action' };
  }

  var json = JSON.stringify(result);

  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== PUBLIC =====

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

    for (var j = 0; j < headers.length; j++) {
      product[headers[j]] = row[j];
    }

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

  for (var i = 1; i < data.length; i++) {
    settings[data[i][0]] = data[i][1];
  }

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
      for (var j = 0; j < headers.length; j++) {
        order[headers[j]] = row[j];
      }
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

  var name = params.name || '';
  var phone = params.phone || '';
  var wilayaCode = params.wilaya_code || '';
  var wilayaAr = params.wilaya_ar || '';
  var wilayaEn = params.wilaya_en || '';
  var deliveryType = params.delivery_type || '';
  var itemsJson = params.items_json || '[]';
  var subtotal = params.subtotal || '0';
  var note = params.note || '';

  var shippingNote = 'سعر التوصيل يُحدد بعد التأكيد';

  sheet.appendRow([
    orderId, createdAt, name, phone, wilayaCode,
    wilayaAr, wilayaEn, deliveryType, itemsJson,
    subtotal, shippingNote, 'pending', note
  ]);

  return { ok: true, order_id: orderId };
}

function generateOrderId() {
  var now = new Date();
  var datePart = Utilities.formatDate(now, 'Africa/Algiers', 'yyyyMMdd');
  var randomPart = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return 'SK-' + datePart + '-' + randomPart;
}

// ===== ADMIN =====

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
    for (var j = 0; j < headers.length; j++) {
      product[headers[j]] = row[j];
    }
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
    id,
    params.title_ar || '',
    params.title_en || '',
    params.price || 0,
    params.old_price || 0,
    params.currency || 'DZD',
    params.image1 || '',
    params.image2 || '',
    params.image3 || '',
    params.category_ar || '',
    params.category_en || '',
    params.desc_ar || '',
    params.desc_en || '',
    params.stock || 0,
    params.active === false || params.active === 'false' ? false : true
  ]);

  return { ok: true, id: id };
}

function adminEditProduct(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Catalog');
  if (!sheet) return { error: 'Catalog sheet not found' };

  var row = parseInt(params._row);
  if (!row || row < 2) return { error: 'Invalid row number' };

  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  var fields = ['id', 'title_ar', 'title_en', 'price', 'old_price', 'currency',
    'image1', 'image2', 'image3', 'category_ar', 'category_en',
    'desc_ar', 'desc_en', 'stock', 'active'];

  for (var j = 0; j < headers.length; j++) {
    if (params[headers[j]] !== undefined) {
      var val = params[headers[j]];
      if (headers[j] === 'active') {
        val = (val === true || val === 'true' || val === 'TRUE' || val === 1 || val === '1');
      }
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
  if (!row || row < 2) return { error: 'Invalid row number' };

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
    for (var j = 0; j < headers.length; j++) {
      order[headers[j]] = row[j];
    }
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
  if (!row || row < 2) return { error: 'Invalid row number' };

  if (params.status) {
    var statusCol = 12;
    sheet.getRange(row, statusCol).setValue(params.status);
  }
  if (params.notes !== undefined) {
    var notesCol = 13;
    sheet.getRange(row, notesCol).setValue(params.notes);
  }

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
      if (data[i][0] === key) {
        sheet.getRange(i + 1, 2).setValue(params[key]);
        found = true;
        break;
      }
    }
    if (!found) {
      sheet.appendRow([key, params[key]]);
    }
  }

  return { ok: true };
}

// ===== SETUP =====

function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var catalogSheet = ss.getSheetByName('Catalog');
  if (!catalogSheet) {
    catalogSheet = ss.insertSheet('Catalog');
    catalogSheet.appendRow([
      'id', 'title_ar', 'title_en', 'price', 'old_price', 'currency',
      'image1', 'image2', 'image3', 'category_ar', 'category_en',
      'desc_ar', 'desc_en', 'stock', 'active'
    ]);
    catalogSheet.appendRow([
      'PROD-001', 'ساعة ذكية', 'Smart Watch', 5900, 7500, 'DZD',
      '', '', '', 'إلكترونيات', 'Electronics',
      'ساعة ذكية عملية بتصميم أنيق', 'Practical smart watch with elegant design', 10, true
    ]);
  }

  var ordersSheet = ss.getSheetByName('Orders');
  if (!ordersSheet) {
    ordersSheet = ss.insertSheet('Orders');
    ordersSheet.appendRow([
      'order_id', 'created_at', 'name', 'phone', 'wilaya_code',
      'wilaya_ar', 'wilaya_en', 'delivery_type', 'items_json',
      'subtotal', 'shipping_note', 'status', 'notes'
    ]);
  }

  var settingsSheet = ss.getSheetByName('Settings');
  if (!settingsSheet) {
    settingsSheet = ss.insertSheet('Settings');
    settingsSheet.appendRow(['key', 'value']);
    settingsSheet.appendRow(['store_name_ar', 'Smart Shopping']);
    settingsSheet.appendRow(['store_name_en', 'Smart Shopping']);
    settingsSheet.appendRow(['whatsapp', '213557543177']);
    settingsSheet.appendRow(['phone', '213557543177']);
    settingsSheet.appendRow(['currency', 'DZD']);
    settingsSheet.appendRow(['pixel_id', '']);
  }
}
