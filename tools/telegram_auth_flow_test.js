'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const testToken = '123456789:test-only-token';
const port = 43000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
const testParent = path.join(root, '.test-tmp');
fs.mkdirSync(testParent, { recursive: true });
const testRoot = fs.mkdtempSync(path.join(testParent, 'plan-fakt-telegram-'));
const dataDir = path.join(testRoot, 'data');
fs.cpSync(path.join(root, 'data'), dataDir, { recursive: true });

function read(name) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
}

function write(name, value) {
  fs.writeFileSync(path.join(dataDir, name), JSON.stringify(value, null, 2));
}

const projects = read('projects.json');
const users = read('users.json');
const organizations = read('organizations.json');
const customer = { fullName: 'ОАО «Заказчик № 2»', portalName: 'customer-2', portalPage: 'customer-2.php' };
const secondProject = { id: 'second', name: 'Второй объект', shortName: 'Объект 2', status: 'active', timezone: 'Europe/Moscow', customerOrganization: customer, contractorIds: ['contractor-2'] };
projects.push(secondProject);
organizations.push({ id: 'contractor-2', fullName: 'ООО «Подрядчик № 2»', shortName: 'Подрядчик 2', status: 'active', projectIds: ['second'], reportSettings: { planFact: true, workforce: false, machinery: false } });
users[0].assignments.push({ projectId: 'second', role: 'admin', organizationIds: [], customerOrganization: customer });
users.push({ id: 'u_single', name: 'Пользователь одного объекта', login: 'single-user', passwordHash: users[0].passwordHash, telegramId: '777777777', status: 'active', organization: users[0].organization, assignments: [users[0].assignments[0]] });
users.push({ id: 'u_link', name: 'Новый пользователь', login: 'link-user', passwordHash: users[0].passwordHash, status: 'active', assignments: [users[0].assignments[0]] });
write('projects.json', projects);
write('organizations.json', organizations);
write('users.json', users);

function initData(userId, startParam = '') {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: `test-${userId}`, user: JSON.stringify({ id: userId, first_name: 'Test' }) });
  if (startParam) params.set('start_param', startParam);
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(testToken).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}

async function post(route, body) {
  const response = await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { response, data: await response.json() };
}

async function waitForServer(child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Тестовый сервер завершился с кодом ${child.exitCode}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Тестовый сервер не запустился');
}

(async () => {
  const child = spawn(process.execPath, [path.join(root, 'server.js')], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', PLAN_FACT_DATA_DIR: dataDir, TELEGRAM_BOT_TOKEN: testToken, TELEGRAM_BOT_DISABLED: '1', SESSION_SECRET: 'telegram-flow-test-session-secret' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let diagnostics = '';
  child.stdout.on('data', chunk => { diagnostics += chunk; });
  child.stderr.on('data', chunk => { diagnostics += chunk; });
  try {
    await waitForServer(child);

    const known = await post('/api/auth/telegram', { initData: initData(16370894) });
    assert.equal(known.response.status, 200);
    assert.equal(known.data.projectId, null);
    assert.equal(known.data.requiresProjectSelection, true);
    assert.equal(known.data.user.organization.fullName, 'ООО "БМСУ-4"');
    assert.equal(known.data.user.organization.customerOrganizationName, 'bmsu-4');
    assert.deepEqual(known.data.projectChoices.map(item => item.id).sort(), ['main', 'second']);
    assert.equal(known.data.projectChoices.find(item => item.id === 'main').name, projects.find(item => item.id === 'main').name);
    assert.equal(known.data.projectChoices.find(item => item.id === 'main').customerOrganization.fullName, 'ООО "БМСУ-4"');
    assert.equal(known.data.projectChoices.find(item => item.id === 'main').customerOrganization.portalName, 'bmsu-4');
    assert.equal(known.data.projectChoices.find(item => item.id === 'main').customerOrganization.portalPage, 'bmsu-4.php');
    assert.equal(known.data.projectChoices.find(item => item.id === 'second').contractors[0].id, 'contractor-2');

    const selected = await post('/api/auth/telegram/select-project', { initData: initData(16370894), projectId: 'second' });
    assert.equal(selected.response.status, 200);
    assert.equal(selected.data.projectId, 'second');
    assert.equal(selected.data.startRoute, 'planfact');
    assert.equal(selected.data.requiresProjectSelection, false);

    const single = await post('/api/auth/telegram', { initData: initData(777777777) });
    assert.equal(single.response.status, 200);
    assert.equal(single.data.projectId, 'main');
    assert.equal(single.data.startRoute, 'planfact');
    assert.equal(single.data.requiresProjectSelection, false);

    const loginResponse = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: users[0].login, password: '286' }) });
    assert.equal(loginResponse.status, 200);
    const cookie = loginResponse.headers.get('set-cookie').split(';')[0];
    const primaryOrganization = organizations.find(item => item.projectIds.includes('main'));
    const createResponse = await fetch(`${base}/api/admin/users`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ projectId: 'main', name: 'Иванов Иван Иванович', login: 'invited-user', password: 'Invite2026!', role: 'responsible', organizationId: primaryOrganization.id, createTelegramInvite: true }) });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 201);
    assert.match(created.telegramInvite.url, /^https:\/\/t\.me\/OtchetFact_bot\?startapp=invite_/);
    const startParam = new URL(created.telegramInvite.url).searchParams.get('startapp');
    const invited = await post('/api/auth/telegram', { initData: initData(888888888, startParam) });
    assert.equal(invited.response.status, 200);
    assert.equal(invited.data.user.name, 'Иванов Иван Иванович');
    assert.equal(invited.data.user.telegramId, '888888888');
    assert.equal(invited.data.user.telegramInvite, undefined);
    const reusedInvite = await post('/api/auth/telegram', { initData: initData(888888889, startParam) });
    assert.equal(reusedInvite.response.status, 403);

    const forbidden = await post('/api/auth/telegram/select-project', { initData: initData(16370894), projectId: 'missing' });
    assert.equal(forbidden.response.status, 403);

    const unknownId = 999999999;
    const unknown = await post('/api/auth/telegram', { initData: initData(unknownId) });
    assert.equal(unknown.response.status, 403);
    assert.equal(unknown.data.code, 'TELEGRAM_ACCOUNT_NOT_LINKED');

    const linked = await post('/api/auth/telegram/link', { initData: initData(unknownId), login: 'link-user', password: '286', confirmLink: true });
    assert.equal(linked.response.status, 200);
    assert.equal(linked.data.linked, true);
    assert.equal(linked.data.projectId, 'main');
    assert.equal(linked.data.startRoute, 'planfact');
    assert.equal(linked.data.requiresProjectSelection, false);

    const recognized = await post('/api/auth/telegram', { initData: initData(unknownId) });
    assert.equal(recognized.response.status, 200);
    assert.equal(recognized.data.user.id, 'u_link');
    console.log('Telegram-сценарии пройдены: один объект, выбор из нескольких, неизвестный ID и привязка.');
  } catch (error) {
    if (diagnostics.trim()) console.error(diagnostics.trim());
    throw error;
  } finally {
    if (child.exitCode === null) child.kill();
    await new Promise(resolve => child.exitCode === null ? child.once('exit', resolve) : resolve());
    fs.rmSync(testRoot, { recursive: true, force: true });
    try { fs.rmdirSync(testParent); } catch {}
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
