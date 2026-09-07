'use strict';

const assert = require('assert');
const { diagnose, render } = require('./telegram_doctor');

const TOKEN = '123456789:AAHvIkLY9LmRi3hPKR8nDfy2Dv11wJWqq1k';

/** Мок сети: Telegram API и /api/health отвечают заранее заданными данными. */
function fakeFetch(routes) {
  return async (url, options = {}) => {
    const address = String(url);
    const telegram = address.match(/^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/);
    if (telegram) {
      const handler = routes.telegram[telegram[1]];
      assert.ok(handler, `Нет мока для метода ${telegram[1]}`);
      assert.equal(options.method, 'POST');
      return { ok: true, json: async () => handler };
    }
    const health = routes.health;
    assert.ok(health, `Неожиданный запрос ${address}`);
    assert.equal(address, health.url);
    if (health.error) throw new Error(health.error);
    return { ok: health.status !== false, json: async () => health.body };
  };
}

function texts(result) {
  return result.checks.map(check => `${check.level}:${check.text}`).join('\n');
}

(async () => {
  // 1. Всё подключено, но включён Main Mini App — открывается портал, а не приложение.
  const working = await diagnose(
    { TELEGRAM_BOT_TOKEN: TOKEN, WEB_APP_URL: 'https://plan-fakt.example/' },
    fakeFetch({
      telegram: {
        getMe: { ok: true, result: { username: 'OtchetFact_bot', has_main_web_app: true } },
        getWebhookInfo: { ok: true, result: { url: '', pending_update_count: 0 } },
        getChatMenuButton: { ok: true, result: { type: 'web_app', web_app: { url: 'https://plan-fakt.example/' } } }
      },
      health: { url: 'https://plan-fakt.example/api/health', body: { ok: true, service: 'plan-fakt' } }
    })
  );
  assert.match(texts(working), /ok:Бот найден: @OtchetFact_bot/);
  assert.match(texts(working), /ok:Приложение отвечает/);
  assert.match(texts(working), /warn:У бота включён Main Mini App/);
  assert.ok(working.actions.some(action => /myapps/.test(action)), 'Нужен шаг с заменой ссылки в BotFather');
  assert.equal(working.ok, true);

  // 2. В настройках указана страница портала — Telegram открывает bimmax.pro.
  const portal = await diagnose(
    { TELEGRAM_BOT_TOKEN: TOKEN, WEB_APP_URL: 'https://bimmax.pro/bmsu4.php' },
    fakeFetch({
      telegram: {
        getMe: { ok: true, result: { username: 'OtchetFact_bot', has_main_web_app: false } },
        getWebhookInfo: { ok: true, result: { url: '', pending_update_count: 0 } },
        getChatMenuButton: { ok: true, result: { type: 'commands' } }
      }
    })
  );
  assert.match(texts(portal), /fail:WEB_APP_URL=https:\/\/bimmax\.pro\/bmsu4\.php/);
  assert.equal(portal.ok, false);

  // 3. Адрес правильный, но приложение не запущено.
  const offline = await diagnose(
    { TELEGRAM_BOT_TOKEN: TOKEN, WEB_APP_URL: 'https://plan-fakt.example/' },
    fakeFetch({
      telegram: {
        getMe: { ok: true, result: { username: 'OtchetFact_bot', has_main_web_app: false } },
        getWebhookInfo: { ok: true, result: { url: 'https://old.example/hook', pending_update_count: 120 } },
        getChatMenuButton: { ok: true, result: { type: 'commands' } }
      },
      health: { url: 'https://plan-fakt.example/api/health', error: 'fetch failed' }
    })
  );
  assert.match(texts(offline), /fail:Приложение недоступно/);
  assert.match(texts(offline), /warn:У бота установлен webhook/);
  assert.equal(offline.ok, false);

  // 4. Отозванный токен.
  const revoked = await diagnose(
    { TELEGRAM_BOT_TOKEN: TOKEN },
    fakeFetch({ telegram: { getMe: { ok: false, error_code: 401, description: 'Unauthorized' } } })
  );
  assert.match(texts(revoked), /fail:Telegram отклонил токен/);
  assert.ok(revoked.actions.some(action => /Revoke current token/.test(action)));

  // 5. Токен не задан вовсе — сервер просто не запускает бота.
  const empty = await diagnose({}, fakeFetch({ telegram: {} }));
  assert.match(texts(empty), /fail:TELEGRAM_BOT_TOKEN не задан/);
  assert.match(render(empty), /Что сделать:/);

  console.log('Диагностика бота распознаёт токен, адрес приложения, webhook и Main Mini App.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
