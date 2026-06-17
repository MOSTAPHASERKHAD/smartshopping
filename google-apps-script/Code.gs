// SmartKiosk - Google Apps Script Backend (JSONP API)
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
  var params;
  try {
    params = JSON.parse(e.postData.contents);
  } catch(ex) {
    params = e.parameter || {};
  }
  var action = params.action || '';
  var callback = params.callback || '';

  var result;

  switch (action) {
    case 'order':
      result = createOrder(params);
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
    orderId,
    createdAt,
    name,
    phone,
    wilayaCode,
    wilayaAr,
    wilayaEn,
    deliveryType,
    itemsJson,
    subtotal,
    shippingNote,
    'pending',
    note
  ]);

  return { ok: true, order_id: orderId };
}

function generateOrderId() {
  var now = new Date();
  var datePart = Utilities.formatDate(now, 'Africa/Algiers', 'yyyyMMdd');
  var randomPart = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return 'SK-' + datePart + '-' + randomPart;
}

function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Catalog sheet
  var catalogSheet = ss.getSheetByName('Catalog');
  if (!catalogSheet) {
    catalogSheet = ss.insertSheet('Catalog');
    catalogSheet.appendRow([
      'id', 'title_ar', 'title_en', 'price', 'old_price', 'currency',
      'image1', 'image2', 'image3', 'category_ar', 'category_en',
      'desc_ar', 'desc_en', 'stock', 'active'
    ]);
    catalogSheet.appendRow([
      'PROD-001', 'سماعة بلوتوث', 'Bluetooth Speaker', 2500, 3500, 'DZD',
      'https://i.imgur.com/example1.jpg', '', '', 'إلكترونيات', 'Electronics',
      'سماعة بلوتوث متحركة', 'Portable Bluetooth Speaker', 10, true
    ]);
  }

  // Orders sheet
  var ordersSheet = ss.getSheetByName('Orders');
  if (!ordersSheet) {
    ordersSheet = ss.insertSheet('Orders');
    ordersSheet.appendRow([
      'order_id', 'created_at', 'name', 'phone', 'wilaya_code',
      'wilaya_ar', 'wilaya_en', 'delivery_type', 'items_json',
      'subtotal', 'shipping_note', 'status', 'notes'
    ]);
  }

  // Settings sheet
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
