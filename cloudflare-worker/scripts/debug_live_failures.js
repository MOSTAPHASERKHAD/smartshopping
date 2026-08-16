const BASE_URL = 'https://smart-shopping-api.mostaphaserkhad.workers.dev';

async function debug() {
  const rCat = await fetch(`${BASE_URL}?action=catalog`);
  console.log('Catalog status:', rCat.status, 'text:', await rCat.text());

  const rTest = await fetch(`${BASE_URL}?action=testimonials`);
  console.log('Testimonials status:', rTest.status, 'text:', await rTest.text());

  const rLogin = await fetch(`${BASE_URL}?action=auth_login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ghost@shop.com', password: '123' })
  });
  console.log('Auth login status:', rLogin.status, 'text:', await rLogin.text());

  const rVerify = await fetch(`${BASE_URL}?action=auth_verify_email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'bogus' })
  });
  console.log('Verify email status:', rVerify.status, 'text:', await rVerify.text());
}

debug();
