import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const errors = [];
const warnings = [];
const networkErrors = [];

page.on('console', msg => {
  if (msg.type() === 'error') errors.push(msg.text());
  if (msg.type() === 'warning') warnings.push(msg.text());
});

page.on('pageerror', err => errors.push('PAGE ERROR: ' + err.message));

page.on('requestfailed', req => {
  const url = req.url();
  // Ignore aborted AWS requests (React StrictMode double-mount artifact)
  if (!url.includes('amazonaws.com') || req.failure()?.errorText !== 'net::ERR_ABORTED') {
    networkErrors.push(`FAILED: ${req.method()} ${url} — ${req.failure()?.errorText}`);
  }
});

await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(5000);

// Check if map canvas rendered
const mapCanvas = await page.$('canvas');
const hasMap = mapCanvas !== null;

console.log('=== MAP RENDERED ===', hasMap);
console.log('\n=== CONSOLE ERRORS ===');
errors.forEach(e => console.log(e));
console.log('\n=== CONSOLE WARNINGS (non-WebGL) ===');
warnings.filter(w => !w.includes('GL Driver')).forEach(w => console.log(w));
console.log('\n=== REAL NETWORK FAILURES ===');
networkErrors.forEach(n => console.log(n));
console.log('\nDone.');

await browser.close();
