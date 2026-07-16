# SmartShopping / Smart Shopping

متجر إلكتروني مجاني -類似 Shopify - الجزائر - الدفع عند الاستلام (COD)

## الملفات

```
smartshopping/
├── index.html                    # الواجهة الكاملة (ملف واحد)
└── google-apps-script/
    └── Code.gs                   # كود Google Apps Script
```

## Checklist التشغيل

### 1. إعداد Google Sheet
- [ ] أنشئ Google Sheet جديد وسمّه `SmartShopping`
- [ ] افتح Apps Script من Extensions → Apps Script
- [ ] امسح الكود الحالي والصق محتوى `google-apps-script/Code.gs`
- [ ] شغّل الدالة `setupSheets()` مرة واحدة (Run → setupSheets)
- [ ] سيُنشأ 3 أوراق: Catalog, Orders, Settings

### 2. إضافة المنتجات
- [ ] افتح ورقة `Catalog`
- [ ] أضف منتجاتك في الأعمدة المحددة
- [ ] `active` = TRUE للمنتجات النشطة
- [ ] `image1` = رابط الصورة الخارجي (ImgBB, etc.)

### 3. نشر Apps Script كـ Web App
- [ ] اضغط Deploy → New deployment
- [ ] Type: Web app
- [ ] Execute as: Me
- [ ] Who has access: Anyone
- [ ] انسخ الرابط النهائي

### 4. ربط الـ Frontend بالـ API
- [ ] افتح `index.html`
- [ ] ابحث عن `PASTE_YOUR_APPS_SCRIPT_URL_HERE`
- [ ] استبدل بالرابط الذي نسخته في الخطوة 3

### 5. نشر على GitHub Pages
- [ ] أنشئ ريبو جديد على GitHub اسمه `smartshopping`
- [ ] ارفع الملفات (index.html + google-apps-script/)
- [ ] اذهب إلى Settings → Pages
- [ ] Source: Deploy from branch → main
- [ ] انسخ رابط الموقع (مثل: https://username.github.io/smartshopping/)

### 6. الإعدادات الاختيارية
- [ ] أضف Facebook Pixel ID في ورقة Settings
- [ ] عدّل اسم المتجر في ورقة Settings
- [ ] أضف روابط صور حقيقية للمنتجات

## ملاحظات

- **الشحن:** لا يُحسب آليًا. العميل يختار الولاية ونوع التوصيل، ثم تأكّد السعر عبر الهاتف/واتساب
- **الدفع:** COD فقط (الدفع عند الاستلام)
- **رقم واتساب:** +213557543177
- **API:** JSONP لتجاوز مشكلة CORS
- **البيانات:** Google Sheets كقاعدة بيانات مجانية
