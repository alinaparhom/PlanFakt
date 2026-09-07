'use strict';

/*
 * Самодиагностика подключения бота: npm run telegram:doctor
 *
 * Одна команда проверяет всю цепочку — токен, доступ к Telegram API, адрес
 * приложения, кнопку Mini App и Main Mini App — и печатает готовый список
 * действий. Ничего не меняет: настройку выполняет telegram:configure.
 */

const fs = require('fs');
const path = require('path');
const { directAppUrl, apiUrl } = require('../telegram-web-app');

const TOKEN_PATTERN = /^\d{6,}:[A-Za-z0-9_-]{30,}$/;

function readEnvFile(file) {
  const result = {};
  if (!fs.existsSync(file)) return result;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[match[1]] = value;
  }
  return result;
}

/**
 * Проверки возвращают строки отчёта и список шагов для администратора.
 * fetchImpl вынесен параметром, чтобы тест не ходил в сеть.
 */
async function diagnose(env = {}, fetchImpl = fetch) {
  const checks = [];
  const actions = [];
  const add = (level, text) => checks.push({ level, text });

  const call = async (token, method) => {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(`ответ не похож на Telegram API (HTTP ${response.status}) — запрос, вероятно, перехватил прокси или firewall`);
    }
    if (!data.ok) throw Object.assign(new Error(data.description || method), { telegramCode: data.error_code });
    return data.result;
  };

  // 1. Токен бота
  const token = String(env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) {
    add('fail', 'TELEGRAM_BOT_TOKEN не задан');
    actions.push('Запишите TELEGRAM_BOT_TOKEN в файл .env рядом с server.js (образец — .env.example).');
    return { checks, actions, ok: false };
  }
  if (!TOKEN_PATTERN.test(token)) {
    add('fail', 'TELEGRAM_BOT_TOKEN записан не в формате 123456789:AA...');
    actions.push('Скопируйте токен целиком из @BotFather → /mybots → API Token, без кавычек и пробелов.');
    return { checks, actions, ok: false };
  }
  add('ok', 'TELEGRAM_BOT_TOKEN задан');

  if (String(env.TELEGRAM_BOT_DISABLED || '') === '1') {
    add('warn', 'TELEGRAM_BOT_DISABLED=1 — сервер не запускает бота');
    actions.push('Уберите TELEGRAM_BOT_DISABLED=1 из .env, иначе бот не отвечает на /start.');
  }

  // 2. Связь с Telegram и сам бот
  let bot;
  try {
    bot = await call(token, 'getMe');
    add('ok', `Бот найден: @${bot.username}`);
  } catch (error) {
    if (error.telegramCode === 401 || error.telegramCode === 404) {
      add('fail', 'Telegram отклонил токен (401/404)');
      actions.push('Токен недействителен или отозван. Возьмите новый: @BotFather → /mybots → API Token → Revoke current token.');
    } else {
      add('fail', `Нет связи с api.telegram.org: ${error.message}`);
      actions.push('Проверьте доступ сервера к api.telegram.org (интернет, firewall, прокси).');
    }
    return { checks, actions, ok: false };
  }

  // 3. Webhook перехватывает сообщения раньше long polling
  try {
    const hook = await call(token, 'getWebhookInfo');
    if (hook && hook.url) {
      add('warn', `У бота установлен webhook: ${hook.url}`);
      actions.push('Webhook забирает сообщения себе. Сервер снимает его при старте; если адрес возвращается — отключите стороннюю интеграцию.');
    } else {
      add('ok', 'Webhook не установлен, long polling свободен');
    }
    if (hook && hook.pending_update_count > 50) {
      add('warn', `В очереди ${hook.pending_update_count} необработанных сообщений — бот, вероятно, не запущен`);
    }
  } catch (error) {
    add('warn', `Не удалось прочитать webhook: ${error.message}`);
  }

  // 4. Адрес приложения
  const rawUrl = String(env.WEB_APP_URL || '').trim();
  let webAppUrl = '';
  if (!rawUrl) {
    add('fail', 'WEB_APP_URL не задан');
    actions.push('Опубликуйте приложение на публичном HTTPS-адресе и запишите его в WEB_APP_URL. Адрес портала bimmax.pro и 127.0.0.1 не подходят.');
  } else {
    try {
      webAppUrl = directAppUrl(rawUrl);
      add('ok', `WEB_APP_URL корректен: ${webAppUrl}`);
    } catch (error) {
      add('fail', `WEB_APP_URL=${rawUrl} — ${error.message}`);
      actions.push('Укажите в WEB_APP_URL прямой HTTPS-адрес приложения «План / Факт», а не страницу портала.');
    }
  }

  // 5. Приложение действительно отвечает
  if (webAppUrl) {
    const healthUrl = apiUrl(webAppUrl, 'api/health');
    try {
      const response = await fetchImpl(healthUrl, { headers: { Accept: 'application/json' }, redirect: 'follow' });
      let data = {};
      try { data = await response.json(); } catch { data = {}; }
      if (response.ok && data.ok === true && data.service === 'plan-fakt') {
        add('ok', `Приложение отвечает: ${healthUrl}`);
      } else {
        webAppUrl = '';
        add('fail', `${healthUrl} отвечает, но это не сервер «План / Факт»`);
        actions.push('По этому адресу открыт другой сайт (чаще всего портал). Направьте домен на запущенный server.js.');
      }
    } catch (error) {
      webAppUrl = '';
      add('fail', `Приложение недоступно: ${error.message}`);
      actions.push('Запустите server.js и откройте к нему HTTPS-доступ через reverse proxy, затем повторите проверку.');
    }
  }

  // 6. Кнопка меню бота
  try {
    const menu = await call(token, 'getChatMenuButton');
    if (menu.type === 'web_app' && menu.web_app && menu.web_app.url) {
      const matches = !webAppUrl || menu.web_app.url === webAppUrl;
      add(matches ? 'ok' : 'warn', `Кнопка меню открывает ${menu.web_app.url}`);
      if (!matches) actions.push('Кнопка меню ведёт на старый адрес. Выполните npm run telegram:configure.');
    } else {
      add('warn', 'Кнопка меню бота не открывает Mini App');
      if (webAppUrl) actions.push('Выполните npm run telegram:configure — команда запишет кнопку Mini App.');
    }
  } catch (error) {
    add('warn', `Не удалось прочитать кнопку меню: ${error.message}`);
  }

  // 7. Main Mini App — самая частая причина «открывается портал»
  if (bot.has_main_web_app) {
    add('warn', 'У бота включён Main Mini App');
    actions.push('Кнопку «Открыть приложение» и ссылки t.me/…?startapp= Telegram берёт из Main Mini App, а не из кнопки меню. Его адрес меняют только вручную: @BotFather → /myapps → выберите приложение → Edit Web App → Edit Link → вставьте адрес приложения «План / Факт».');
  } else if (webAppUrl) {
    add('warn', 'Main Mini App не настроен');
    actions.push('Ссылки-приглашения t.me/…?startapp= работают только через Main Mini App. Создайте его: @BotFather → /newapp → выберите бота → укажите адрес приложения «План / Факт».');
  }

  return { checks, actions, ok: checks.every(item => item.level !== 'fail') };
}

const ICONS = { ok: '✓', warn: '!', fail: '✗' };

function render(result) {
  const lines = ['Диагностика подключения бота «План / Факт»', ''];
  for (const check of result.checks) lines.push(`  ${ICONS[check.level]} ${check.text}`);
  lines.push('');
  if (result.actions.length) {
    lines.push('Что сделать:');
    result.actions.forEach((action, index) => lines.push(`  ${index + 1}. ${action}`));
  } else {
    lines.push('Замечаний нет: бот подключён и открывает приложение.');
  }
  return lines.join('\n');
}

module.exports = { diagnose, render, readEnvFile };

if (require.main === module) {
  const env = { ...readEnvFile(path.join(__dirname, '..', '.env')), ...process.env };
  diagnose(env)
    .then(result => {
      console.log(render(result));
      process.exit(result.ok ? 0 : 1);
    })
    .catch(error => {
      console.error(error.message);
      process.exit(1);
    });
}
