/* Roda tudo no GitHub (e na sua máquina, se tiver Node): verificações estáticas + testes no navegador.
   Uso:  npm install --no-save playwright && npx playwright install chromium && node tests/run-ci.js */
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
let falhou = false;
const erro = (msg) => { falhou = true; console.error('✗ ' + msg); };

// 1) Sintaxe de todos os <script> do index.html
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
scripts.forEach((src, i) => {
  try { new vm.Script(src, { filename: 'index.html#script' + i }); }
  catch (e) { erro('Erro de sintaxe no script ' + i + ' do index.html: ' + e.message); }
});
console.log(scripts.length + ' scripts do index.html: sintaxe ' + (falhou ? 'COM ERRO' : 'ok'));

// 2) Servidor estático da pasta do projeto
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(root, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nao encontrado'); }
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  // fuso de Brasília: os testes de data dependem dele
  const ctx = await browser.newContext({ timezoneId: 'America/Fortaleza', locale: 'pt-BR' });
  // nada além do próprio servidor local é acessível: os testes nunca tocam o banco real
  await ctx.route('**/*', (route) => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  [erro na página] ' + e.message));
  await page.goto(base + '/tests/runner.html');
  await page.waitForFunction(() => window.__testResults, null, { timeout: 180000 });
  const r = await page.evaluate(() => window.__testResults);
  const linhas = await page.evaluate(() => [...document.querySelectorAll('#lista li')].map((li) => li.textContent));
  linhas.forEach((l) => console.log('  ' + l));
  console.log('\n' + r.passed + ' passaram · ' + r.failed + ' falharam · ' + r.skipped + ' pulados · ' + r.total + ' no total');
  if (r.failed) falhou = true;
  await browser.close();
  server.close();
  process.exit(falhou ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
