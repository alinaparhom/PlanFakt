'use strict';

const assert = require('assert');
const { apiUrl, directAppUrl, verifyPlanFactApp } = require('../telegram-web-app');

(async () => {
  assert.equal(directAppUrl('https://plan.example/app/#old'), 'https://plan.example/app/');
  assert.equal(apiUrl('https://plan.example/app/', '/api/health'), 'https://plan.example/app/api/health');
  assert.throws(() => directAppUrl('http://127.0.0.1:4173/'), /HTTPS/);
  assert.throws(() => directAppUrl('https://bimmax.pro/bmsu4.php'), /портала/);
  assert.throws(() => directAppUrl('https://bimmax.pro/bmsu-4.php'), /портала/);
  // Путь к серверному .env, скопированный из переписки, — не адрес приложения.
  assert.throws(() => directAppUrl('https://bimmax.pro/.env'), /служебный файл/);
  assert.throws(() => directAppUrl('https://localhost:4173/'), /локальный адрес/);
  // Размещение в подпапке портала — рабочий вариант и запрещаться не должно.
  assert.equal(directAppUrl('https://bimmax.pro/planfakt/'), 'https://bimmax.pro/planfakt/');
  assert.equal(apiUrl('https://bimmax.pro/planfakt/', 'api/health'), 'https://bimmax.pro/planfakt/api/health');

  const verified = await verifyPlanFactApp('https://plan.example/app/', async url => {
    assert.equal(url, 'https://plan.example/app/api/health');
    return { ok: true, json: async () => ({ ok: true, service: 'plan-fakt' }) };
  });
  assert.equal(verified, 'https://plan.example/app/');

  await assert.rejects(
    verifyPlanFactApp('https://bimmax.pro/', async () => ({ ok: false, json: async () => ({}) })),
    /не ведёт на сервер/
  );
  console.log('Проверка WEB_APP_URL блокирует портал, localhost и неверный API.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
