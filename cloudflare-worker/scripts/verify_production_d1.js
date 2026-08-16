const { execSync } = require('child_process');

function runD1Query(query) {
  const result = execSync(`npx wrangler d1 execute smart-shopping-db --remote --json --command="${query}"`, { encoding: 'utf-8' });
  return JSON.parse(result);
}

try {
  console.log('--- Counts ---');
  console.log('Products:', runD1Query('SELECT COUNT(*) as count FROM products')[0].results[0].count);
  console.log('Orders:', runD1Query('SELECT COUNT(*) as count FROM orders')[0].results[0].count);
  console.log('Customers:', runD1Query('SELECT COUNT(*) as count FROM customers')[0].results[0].count);
  console.log('Subscribers:', runD1Query('SELECT COUNT(*) as count FROM subscribers')[0].results[0].count);
  console.log('Themes:', runD1Query('SELECT COUNT(*) as count FROM themes')[0].results[0].count);
  console.log('Settings:', runD1Query('SELECT COUNT(*) as count FROM settings')[0].results[0].count);
  
  console.log('\n--- Integrity Checks ---');
  const duplicateOrders = runD1Query('SELECT order_id, COUNT(*) as count FROM orders GROUP BY order_id HAVING count > 1')[0].results;
  console.log('Duplicate Orders:', duplicateOrders.length);
  
  const duplicatePhones = runD1Query('SELECT phone, COUNT(*) as count FROM customers GROUP BY phone HAVING count > 1')[0].results;
  console.log('Duplicate Phones:', duplicatePhones.length);
  
  const nullNames = runD1Query('SELECT COUNT(*) as count FROM products WHERE name IS NULL')[0].results[0].count;
  console.log('Products with NULL name:', nullNames);
  
  const invalidJson = runD1Query("SELECT COUNT(*) as count FROM themes WHERE json_valid(config_json) = 0")[0].results[0].count;
  console.log('Themes with invalid JSON config:', invalidJson);
  
  const invalidOrderItems = runD1Query("SELECT COUNT(*) as count FROM orders WHERE json_valid(items_json) = 0")[0].results[0].count;
  console.log('Orders with invalid JSON items:', invalidOrderItems);
  
  const priceCheck = runD1Query("SELECT COUNT(*) as count FROM products WHERE price < 0")[0].results[0].count;
  console.log('Products with negative price:', priceCheck);

} catch (e) {
  console.error("Error running validation:", e.message);
}
