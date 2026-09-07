'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const base = process.env.APP_URL || 'http://127.0.0.1:4173';

function envValue(name) {
  const line = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/).find(row => row.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1) : '';
}

function telegramInitData(userId) {
  const token = envValue('TELEGRAM_BOT_TOKEN');
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: `smoke-${userId}`, user: JSON.stringify({ id: userId, first_name: 'Smoke' }) });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}

async function login(login, password) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login, password })
  });
  if (!response.ok) throw new Error(`Вход ${login}: HTTP ${response.status}`);
  return response.headers.get('set-cookie').split(';')[0];
}

async function request(path, cookie, options = {}) {
  return fetch(`${base}${path}`, { ...options, headers: { cookie, 'content-type': 'application/json', ...(options.headers || {}) } });
}

(async () => {
  const dataDir = path.join(__dirname, '..', 'data');
  const splitFiles = ['meta.json', 'projects.json', 'organizations.json', 'users.json', 'telegram-links.json', 'works.json', 'reports.json', 'schedules.json', 'milestones.json', 'dictionaries.json', 'audit.json'];
  for (const file of splitFiles) {
    if (!fs.existsSync(path.join(dataDir, file))) throw new Error(`Раздельное хранилище не создано: ${file}`);
  }
  const storedUsers = JSON.parse(fs.readFileSync(path.join(dataDir, 'users.json'), 'utf8'));
  const storedProjects = JSON.parse(fs.readFileSync(path.join(dataDir, 'projects.json'), 'utf8'));
  const storedLinks = JSON.parse(fs.readFileSync(path.join(dataDir, 'telegram-links.json'), 'utf8'));
  const storedAdmin = storedUsers.find(user => user.id === 'u_admin');
  const storedMainProject = storedProjects.find(project => project.id === 'main');
  if (storedAdmin?.telegramId !== '16370894') throw new Error('Telegram ID не сохранён в едином файле пользователей');
  if (storedAdmin?.organization?.fullName !== 'ООО "БМСУ-4"' || storedAdmin?.organization?.customerOrganizationName !== 'bmsu-4') throw new Error('Организация первоначального администратора сохранена неверно');
  if (storedMainProject?.customerOrganization?.fullName !== 'ООО "БМСУ-4"' || storedMainProject?.customerOrganization?.portalName !== 'bmsu-4' || storedMainProject?.customerOrganization?.portalPage !== 'bmsu-4.php') throw new Error('Организация-заказчик первоначального объекта сохранена неверно');
  if (!Array.isArray(storedMainProject?.contractorIds)) throw new Error('У объекта отсутствует собственный список подрядчиков');
  if (!storedLinks.some(link => link.userId === 'u_admin' && link.telegramId === '16370894')) throw new Error('Совместимый индекс Telegram ID не синхронизирован');

  const health = await fetch(`${base}/api/health`);
  if (!health.ok) throw new Error('Healthcheck не пройден');

  const admin = await login('Пархоменко', '286');
  const bootstrap = await request('/api/bootstrap', admin);
  const data = await bootstrap.json();
  if (!bootstrap.ok || data.user.name !== 'Пархоменко Алина Андреевна') throw new Error('Первоначальный администратор не найден');
  if (data.user.assignments[0]?.role !== 'admin') throw new Error('Первоначальному пользователю не назначена роль администратора');
  const analytics = await request(`/api/analytics?projectId=${data.projects[0].id}&period=month&end=2026-09-03`, admin);
  if (!analytics.ok) throw new Error('Администратору недоступна аналитика');
  const analyticsBody = await analytics.json();
  if (analyticsBody.from !== '2026-09-01' || analyticsBody.to !== '2026-09-03') throw new Error('Неверно рассчитаны границы периода План / Факт');
  if (!Array.isArray(analyticsBody.rows) || !Array.isArray(analyticsBody.unitTotals) || !analyticsBody.summary) throw new Error('API План / Факт вернул неполный контракт');
  const invalidPeriod = await request(`/api/analytics?projectId=${data.projects[0].id}&period=year&end=2026-09-03`, admin);
  if (invalidPeriod.status !== 400) throw new Error('API План / Факт принял неизвестный период');
  const invalidDate = await request(`/api/analytics?projectId=${data.projects[0].id}&period=7days&end=2026-02-30`, admin);
  if (invalidDate.status !== 400) throw new Error('API План / Факт принял несуществующую дату');
  const telegramKnown = await fetch(`${base}/api/auth/telegram`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ initData: telegramInitData(16370894) }) });
  const knownBody = await telegramKnown.json();
  if (!telegramKnown.ok || knownBody.user?.id !== 'u_admin') throw new Error('Известный Telegram ID открыл неверный аккаунт');
  if (knownBody.projectId !== data.projects[0].id) throw new Error('Telegram-вход не вернул объект связанного пользователя');
  if (knownBody.startRoute !== 'planfact') throw new Error('Telegram-вход администратора не открыл стартовую страницу его объекта');
  const telegramUnknown = await fetch(`${base}/api/auth/telegram`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ initData: telegramInitData(999999999) }) });
  const unknownBody = await telegramUnknown.json();
  if (telegramUnknown.status !== 403 || unknownBody.code !== 'TELEGRAM_ACCOUNT_NOT_LINKED' || unknownBody.telegramId !== '999999999') throw new Error('Сценарий привязки неизвестного Telegram ID не сработал');
  const linkWithoutConfirmation = await fetch(`${base}/api/auth/telegram/link`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ initData: telegramInitData(999999999), login: 'Пархоменко', password: '286' }) });
  const confirmationBody = await linkWithoutConfirmation.json();
  if (linkWithoutConfirmation.status !== 400 || confirmationBody.code !== 'TELEGRAM_LINK_CONFIRMATION_REQUIRED') throw new Error('Привязка Telegram ID прошла без явного подтверждения');
  const invalidTelegram = await fetch(`${base}/api/auth/telegram`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ initData: 'user=%7B%22id%22%3A16370894%7D&auth_date=1&hash=invalid' }) });
  if (invalidTelegram.status !== 401) throw new Error('Сервер принял неподписанные данные Telegram');
  console.log('Smoke-тест пройден: web-вход, План / Факт, раздельные JSON, Telegram ID, подтверждение привязки и права работают.');
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
