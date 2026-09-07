'use strict';

function directAppUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new Error('WEB_APP_URL должен быть корректным публичным HTTPS-адресом'); }
  if (url.protocol !== 'https:') throw new Error('Telegram Mini App требует HTTPS-адрес');
  const fileName = url.pathname.split('/').filter(Boolean).pop() || '';
  // Путь к серверному файлу настроек — частая ошибка при копировании из чата:
  // «/var/www/.../bimmax.pro/.env» это не адрес приложения. По HTTP такой файл
  // закрыт, и Telegram показывает вместо приложения главную страницу портала.
  if (fileName.startsWith('.')) throw new Error('WEB_APP_URL указывает на служебный файл сервера (например .env), а не на приложение «План / Факт». Нужен адрес запущенного приложения, например https://bimmax.pro/planfakt/');
  if (/\.php$/i.test(fileName)) throw new Error(`Нельзя указывать страницу портала ${fileName} вместо приложения «План / Факт»`);
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(url.hostname)) throw new Error('Telegram не может открыть локальный адрес. Разместите приложение на публичном HTTPS-адресе');
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

module.exports = { apiUrl, directAppUrl, verifyPlanFactApp };
