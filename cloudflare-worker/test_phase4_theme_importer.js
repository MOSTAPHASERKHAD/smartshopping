/**
 * SmartKiosk / Smart Shopping — Phase 4 Test Suite
 * Universal Shopify Theme Importer & Package Assets Engine
 * cloudflare-worker/test_phase4_theme_importer.js
 */

import ThemeSchema from '../themes/theme-schema.js';
import ThemeImporter from '../themes/theme-importer.js';
import pkgEngine from '../themes/theme-engine.js';
const { ThemeEngine } = pkgEngine;

async function runPhase4Tests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📦 SMARTKIOSK — PHASE 4: SHOPIFY THEME IMPORTER & ASSETS TEST');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let passed = 0;
  let failed = 0;

  function assert(cond, label) {
    if (cond) {
      console.log(`  ✅ PASS [${String(passed + 1).padStart(2, '0')}]: ${label}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL [${String(failed + 1).padStart(2, '0')}]: ${label}`);
      failed++;
    }
  }

  const engine = new ThemeEngine();

  // ── [1] Import Shopify settings_data.json Bundle ──
  console.log('── [1] Shopify settings_data.json Import & Normalization ──');
  const shopifyThemeRaw = {
    "theme_name": "Dawn Modern Luxury",
    "author": "Shopify Partner",
    "version": "12.0.0",
    "current": {
      "theme": {
        "color_primary": "#0f172a",
        "color_sale": "#dc2626",
        "color_background": "#f8fafc",
        "color_card": "#ffffff",
        "font_heading": "'Cairo',sans-serif"
      },
      "sections": {
        "hero_banner": {
          "disabled": false,
          "settings": {
            "headline": "عروض الصيف الحصرية 2026",
            "cta_label": "احصل على العرض الآن"
          }
        },
        "faq_accordion": {
          "disabled": true,
          "settings": {}
        }
      }
    }
  };

  const normalizedShopify = ThemeImporter.normalize(shopifyThemeRaw);

  assert(normalizedShopify.__format === 'smartkiosk', 'Theme normalized to SmartKiosk standard format');
  assert(normalizedShopify.tokens.colors.primary === '#0f172a', 'Shopify color_primary correctly mapped to primary');
  assert(normalizedShopify.tokens.colors.secondary === '#dc2626', 'Shopify color_sale mapped to secondary');
  assert(normalizedShopify.tokens.fonts.heading === "'Cairo',sans-serif", 'Shopify heading font mapped');
  assert(normalizedShopify.sections['hero-banner'].settings.headline === 'عروض الصيف الحصرية 2026', 'Section headline imported');
  assert(normalizedShopify.sections['faq-accordion'].enabled === false, 'Section disabled state imported');

  // ── [2] Import CSS Variables Theme ──
  console.log('\n── [2] CSS Variables Theme Import ──');
  const cssVarsTheme = {
    "--color-primary": "#4f46e5",
    "--color-secondary": "#10b981",
    "--color-bg": "#ffffff"
  };

  const normalizedCss = ThemeImporter.normalize(cssVarsTheme);
  assert(normalizedCss.tokens.colors.primary === '#4f46e5', 'Mapped --color-primary');
  assert(normalizedCss.tokens.colors.secondary === '#10b981', 'Mapped --color-secondary');

  // ── [3] Engine Registration & Token Generation ──
  console.log('\n── [3] Registration & CSS Custom Properties Generation ──');
  const registered = engine.register(normalizedShopify);
  assert(registered !== null, 'Registered imported theme in ThemeEngine');

  const cssString = engine._tokensToCSS(registered.tokens, 'light', registered.base);
  assert(cssString.includes('--color-primary:#0f172a'), 'CSS generated with imported primary color');
  assert(cssString.includes('--color-secondary:#dc2626'), 'CSS generated with imported secondary color');
  assert(cssString.includes('--font-heading:\'Cairo\',sans-serif'), 'CSS generated with imported heading font');

  // ── [4] Portable Package Export ──
  console.log('\n── [4] Single-File Portable Theme Export ──');
  const exportedBundle = ThemeImporter.exportTheme(registered);
  assert(typeof exportedBundle === 'string', 'Exported bundle is JSON string');

  const parsedExport = JSON.parse(exportedBundle);
  assert(parsedExport.__format === 'smartkiosk', 'Export package contains __format: smartkiosk');
  assert(parsedExport.tokens.colors.primary === '#0f172a', 'Exported tokens match imported data');
  assert(parsedExport.sections['hero-banner'] != null, 'Exported sections preserved');

  // ── Summary ──
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`📊 PHASE 4 RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase4Tests().catch(err => {
  console.error('Test Runner Exception:', err);
  process.exit(1);
});
