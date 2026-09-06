'use strict';

function directAppUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new Error('WEB_APP_URL должен быть корректным публичным HTTPS-адресом'); }
  if (url.protocol !== 'https:') throw new Error('Telegram Mini App требует HTTPS-адрес');
  if (/\/bmsu-?4\.php\/?$/i.test(url.pathname)) throw new Error('Нельзя указывать страницу портала bmsu4.php/bmsu-4.php вместо приложения «План / Факт»');
  url.hash = '';
  return url.toString();
}

function apiUrl(webAppUrl, route) {
  const base = new URL(webAppUrl);
  base.search = '';
  base.hash = '';
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return new URL(String(route || '').replace(/^\/+/, ''), base).toString();
}

function sameWebAppUrl(left, right) {
  try {
    const a = new URL(String(left || '').trim());
    const b = new URL(String(right || '').trim());
    a.hash = '';
    b.hash = '';
    if (a.pathname === '/') a.pathname = '';
    if (b.pathname === '/') b.pathname = '';
    return a.toString() === b.toString();
  } catch {
    return false;
  }
}

async function verifyPlanFactApp(webAppUrl, fetchImpl = fetch) {
  const normalized = directAppUrl(webAppUrl);
  const healthUrl = apiUrl(normalized, 'api/health');
  let response;
  try {
    response = await fetchImpl(healthUrl, { headers: { Accept: 'application/json' }, redirect: 'follow' });
  } catch (error) {
    throw new Error(`Приложение «План / Факт» недоступно по адресу ${normalized}: ${error.message}`);
  }
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok || data.ok !== true || data.service !== 'plan-fakt') {
    throw new Error(`WEB_APP_URL=${normalized} не ведёт на сервер «План / Факт»: ${healthUrl} не вернул { ok: true, service: "plan-fakt" }`);
  }
  return normalized;
}

module.exports = { apiUrl, directAppUrl, sameWebAppUrl, verifyPlanFactApp };
