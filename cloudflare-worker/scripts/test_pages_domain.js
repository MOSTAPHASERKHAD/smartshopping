async function test() {
  try {
    const r1 = await fetch('https://smartshopping-76x.pages.dev');
    console.log('smartshopping-76x.pages.dev status:', r1.status);
  } catch (e) {
    console.error('smartshopping-76x.pages.dev error:', e.message);
  }

  try {
    const r2 = await fetch('https://smartshopping.click');
    console.log('smartshopping.click status:', r2.status);
  } catch (e) {
    console.error('smartshopping.click error:', e.message);
  }
}
test();
