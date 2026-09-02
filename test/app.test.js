'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { dayFromHeader } = require('../src/excel');
const { verifyTelegram } = require('../src/auth');

test('распознаёт дневные заголовки Excel только нужного месяца', () => {
  assert.equal(dayFromHeader('План 10.09', 2026, 9), '2026-09-10');
  assert.equal(dayFromHeader('Факт 5', 2026, 9), '2026-09-05');
  assert.equal(dayFromHeader('План 10.08', 2026, 9), null);
});

test('проверяет подпись Telegram Mini App', () => {
  const token = 'test-token';
  const values = { auth_date: '1788300000', query_id: 'AAEAAAE', user: '{"id":286,"first_name":"Алина"}' };
  const check = Object.entries(values).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = crypto.createHmac('sha256', secret).update(check).digest('hex');
  const initData = new URLSearchParams({ ...values, hash }).toString();
  assert.equal(verifyTelegram(initData, token), true);
  assert.equal(verifyTelegram(initData.replace('286', '287'), token), false);
});
