const { createCanvas } = require('canvas');
const fs = require('fs');

function makeIcon(size, file) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  
  // Background
  ctx.fillStyle = '#1a1a2e';
  ctx.beginPath();
  ctx.arc(size/2, size/2, size/2, 0, Math.PI * 2);
  ctx.fill();
  
  // Cart emoji text
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${size * 0.45}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🛒', size/2, size/2);
  
  fs.writeFileSync(file, c.toBuffer('image/png'));
  console.log('Created: ' + file);
}

makeIcon(192, 'D:\\pro\\ccc\\smartkiosk\\icon-192.png');
makeIcon(512, 'D:\\pro\\ccc\\smartkiosk\\icon-512.png');
