/**
 * أداة تصدير البيانات من Google Sheets (GAS)
 * انسخ هذا الكود والصقه في محرر Apps Script الخاص بمتجرك القديم
 * ثم قم بتشغيل الدالة `exportAllData` للحصول على رابط لتحميل البيانات كـ JSON
 */

function exportAllData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  const db = {};

  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i];
    const name = sheet.getName();
    
    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();
    
    if (values.length <= 1) {
      db[name] = [];
      continue;
    }
    
    const headers = values[0];
    const rows = [];
    
    for (let r = 1; r < values.length; r++) {
      const rowData = {};
      let isEmpty = true;
      for (let c = 0; c < headers.length; c++) {
        rowData[headers[c]] = values[r][c];
        if (values[r][c] !== '') isEmpty = false;
      }
      if (!isEmpty) {
        rows.push(rowData);
      }
    }
    
    db[name] = rows;
  }
  
  // قم بحفظ الملف في Google Drive
  const fileName = 'smart_shopping_gas_export.json';
  const fileContent = JSON.stringify(db, null, 2);
  
  const blob = Utilities.newBlob(fileContent, 'application/json', fileName);
  const file = DriveApp.createFile(blob);
  
  Logger.log('تم تصدير البيانات بنجاح!');
  Logger.log('رابط التحميل: ' + file.getDownloadUrl());
  Logger.log('رابط العرض: ' + file.getUrl());
}
