const API_URL = 'https://smart-shopping-api.mostaphaserkhad.workers.dev';
async function test() {
  const r = await fetch(`${API_URL}?action=auth_register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `test-${Date.now()}@example.invalid`,
      password: 'StrongPhase32Password123!',
      name: 'Test Name',
      store_name: 'Test Store'
    })
  });
  console.log('Status:', r.status);
  const data = await r.json();
  console.log('Response:', data);
}
test();
