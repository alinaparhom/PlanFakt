'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const port = 44000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
const testParent = path.join(root, '.test-tmp');
fs.mkdirSync(testParent, { recursive: true });
const testRoot = fs.mkdtempSync(path.join(testParent, 'responsible-report-'));
const dataDir = path.join(testRoot, 'data');
fs.cpSync(path.join(root, 'data'), dataDir, { recursive: true });

const usersPath = path.join(dataDir, 'users.json');
const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
const admin = users.find(item => item.assignments?.some(assignment => assignment.role === 'admin'));
const responsible = users.find(item => item.assignments?.some(assignment => assignment.role === 'responsible'));
assert(admin && responsible, 'Для теста нужны администратор и ответственный');
responsible.passwordHash = admin.passwordHash;
fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));

async function waitForServer(child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Тестовый сервер завершился с кодом ${child.exitCode}`);
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Тестовый сервер не запустился');
}

async function post(route, body, cookie = '') {
  const response = await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  return { response, data: await response.json() };
}

(async () => {
  const child = spawn(process.execPath, [path.join(root, 'server.js')], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', PLAN_FACT_DATA_DIR: dataDir, TELEGRAM_BOT_DISABLED: '1', SESSION_SECRET: 'responsible-report-test-secret' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostics = '';
  child.stdout.on('data', chunk => { diagnostics += chunk; });
  child.stderr.on('data', chunk => { diagnostics += chunk; });
  try {
    await waitForServer(child);
    const login = await post('/api/auth/login', { login: responsible.login, password: '286' });
    assert.equal(login.response.status, 200);
    const cookie = login.response.headers.get('set-cookie').split(';')[0];
    const assignment = responsible.assignments.find(item => item.role === 'responsible');
    const worksResponse = await fetch(`${base}/api/works?projectId=${encodeURIComponent(assignment.projectId)}`, { headers: { cookie } });
    const worksData = await worksResponse.json();
    assert.equal(worksResponse.status, 200);
    assert(worksData.works.length > 0);
    assert(worksData.works.every(item => assignment.organizationIds.includes(item.organizationId)));
    assert(worksData.works.every(item => Number.isFinite(item.totalVolume) && Number.isFinite(item.accumulatedActual) && Number.isFinite(item.monthActual)));

    const noFacts = await post('/api/reports', { projectId: assignment.projectId, reportDate: '2099-01-01', facts: [], noFacts: true }, cookie);
    assert.equal(noFacts.response.status, 201);
    assert.equal(noFacts.data.report.noFacts, true);
    assert.equal(noFacts.data.report.noWork, false);

    const noWork = await post('/api/reports', { projectId: assignment.projectId, reportDate: '2099-01-02', facts: [], noWork: true, workers: [{ name: 'Не должен сохраниться', count: 1 }] }, cookie);
    assert.equal(noWork.response.status, 201);
    assert.equal(noWork.data.report.noWork, true);
    assert.deepEqual(noWork.data.report.workers, []);
    console.log('Отчёт ответственного: список работ, нулевые объёмы и «Сегодня не работали» работают.');
  } catch (error) {
    if (diagnostics.trim()) console.error(diagnostics.trim());
    throw error;
  } finally {
    if (child.exitCode === null) child.kill();
    await new Promise(resolve => child.exitCode === null ? child.once('exit', resolve) : resolve());
    fs.rmSync(testRoot, { recursive: true, force: true });
    try { fs.rmdirSync(testParent); } catch {}
  }
})().catch(error => { console.error(error); process.exit(1); });
