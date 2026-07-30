const CleanCSS = require('clean-css');
const fs = require('fs');
const path = require('path');

const cssFiles = [
  'assets/css/index.css',
  'assets/css/product.css',
  'assets/css/admin.css'
];

async function minifyCSS() {
  console.log('📦 Minifying CSS files...');
  
  for (const file of cssFiles) {
    const fullPath = path.join(__dirname, '..', file);
    if (!fs.existsSync(fullPath)) {
      console.log(`⚠️  Not found: ${file}`);
      continue;
    }
    
    const css = fs.readFileSync(fullPath, 'utf8');
    const result = new CleanCSS({ level: 2 }).minify(css);
    
    if (result.errors.length) {
      console.error(`❌ Errors in ${file}:`, result.errors);
      continue;
    }
    
    const minPath = file.replace('.css', '.min.css');
    const minFullPath = path.join(__dirname, '..', minPath);
    fs.writeFileSync(minFullPath, result.styles);
    console.log(`✅ ${file} → ${minPath} (${(result.stats.originalSize / 1024).toFixed(1)}KB → ${(result.stats.minifiedSize / 1024).toFixed(1)}KB, ${(result.stats.efficiency * 100).toFixed(1)}% reduction)`);
  }
  
  console.log('🎉 CSS minification complete!');
}

minifyCSS().catch(console.error);