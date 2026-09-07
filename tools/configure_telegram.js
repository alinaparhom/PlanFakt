'use strict';

const fs = require('fs');
const path = require('path');
const { directAppUrl, verifyPlanFactApp } = require('../telegram-web-app');

function readEnv() {
  const result = {};
  const file = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(file)) return result;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[match[1]] = value;
  }
  return result;
}

async function call(token, method, payload = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!data.ok) throw new Error(data.description || `Telegram API: ${method}`);
  return data.result;
}

(async () => {
  const env = { ...readEnv(), ...process.env };
  const token = String(env.TELEGRAM_BOT_TOKEN || '').trim();
  const webAppUrl = directAppUrl(String(env.WEB_APP_URL || '').trim());
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN не задан');

  await verifyPlanFactApp(webAppUrl);
  const bot = await call(token, 'getMe');
  await call(token, 'setChatMenuButton', {
    menu_button: { type: 'web_app', text: 'Открыть', web_app: { url: webAppUrl } }
  });
  const actual = await call(token, 'getChatMenuButton');
  if (actual.type !== 'web_app' || actual.web_app?.url !== webAppUrl) throw new Error('Telegram не подтвердил новый адрес кнопки Mini App');

  console.log(`Кнопка бота @${bot.username} открывает ${webAppUrl}`);
  if (bot.has_main_web_app) console.log('У бота также включён Main Mini App. Его ссылку нужно заменить через @BotFather → /myapps → Edit link.');
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
