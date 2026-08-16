import { webcrypto } from 'node:crypto';
const crypto = webcrypto;

async function benchmarkPBKDF2(iterations, samples = 5) {
  const password = "SuperSecretPassword123!@#";
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const passwordBuffer = enc.encode(password);

  const times = [];

  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      passwordBuffer,
      { name: "PBKDF2" },
      false,
      ["deriveBits", "deriveKey"]
    );

    const derivedKey = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: iterations,
        hash: "SHA-256"
      },
      keyMaterial,
      256
    );
    const end = performance.now();
    times.push(end - start);
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(`Iterations: ${iterations.toLocaleString()} | Avg: ${avg.toFixed(2)}ms | Min: ${Math.min(...times).toFixed(2)}ms | Max: ${Math.max(...times).toFixed(2)}ms`);
  return avg;
}

async function runAllBenchmarks() {
  console.log("=== PBKDF2-HMAC-SHA256 BENCHMARK (Web Crypto API) ===");
  await benchmarkPBKDF2(100000);
  await benchmarkPBKDF2(300000);
  await benchmarkPBKDF2(600000);
  await benchmarkPBKDF2(1000000);
}

runAllBenchmarks();
