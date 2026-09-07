'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'bmsu4.js'), 'utf8');

function locationFor(pathname, search = '') {
  const state = { assigned: '', replaced: '' };
  return {
    state,
    value: {
      pathname,
      search,
      hash: '',
      href: `https://site.example${pathname}${search}`,
      protocol: 'https:',
      hostname: 'site.example',
      port: '',
      assign(url) { state.assigned = url; },
      replace(url) { state.replaced = url; }
    }
  };
}

/**
 * Заглушка страницы bmsu4.php: три блока экрана, как в разметке портала.
 * Скрипт выбирает, какой из них показать, поэтому в тесте достаточно
 * запоминать hidden у каждого.
 */
function gateDocument(options = {}) {
  const blocks = {
    'bmsu4-gate': { hidden: false },
    'bmsu4-denied': { hidden: true },
    'bmsu4-unconfigured': { hidden: true }
  };
  const document = {
    currentScript: { dataset: options.appUrl ? { appUrl: options.appUrl } : {} },
    readyState: 'complete',
    body: {
      dataset: options.dataset || {},
      style: {},
      classList: { contains: value => value === 'bmsu4-page' }
    },
    getElementById: id => blocks[id] || null
  };
  return { blocks, document, visible: () => Object.keys(blocks).filter(id => !blocks[id].hidden) };
}

function runTelegramLegacyRedirect() {
  const location = locationFor('/bmsu4.php');
  const signedInitData = 'query_id=test&user=%7B%22id%22%3A16370894%7D&auth_date=1770000000&hash=signed';
  location.value.hash = `#tgWebAppData=${encodeURIComponent(signedInitData)}&tgWebAppVersion=9.1&tgWebAppPlatform=android`;
  location.value.href += location.value.hash;
  const gate = gateDocument({ appUrl: 'https://plan-fakt.example/app/' });

  vm.runInNewContext(source, {
    window: { location: location.value }, document: gate.document, URL, URLSearchParams
  });

  const target = new URL(location.state.replaced);
  assert.equal(target.origin + target.pathname, 'https://plan-fakt.example/app/');
  assert.equal(target.searchParams.get('source'), 'telegram');
  assert.equal(target.searchParams.get('tgWebAppData'), signedInitData);
  assert.equal(target.searchParams.get('tgWebAppVersion'), '9.1');
  assert.equal(target.searchParams.get('tgWebAppPlatform'), 'android');
}

function runTelegramRedirectAfterPortalRewrite(pathname) {
  const location = locationFor(pathname);
  const signedInitData = 'query_id=test&user=%7B%22id%22%3A16370894%7D&auth_date=1770000000&hash=signed';
  location.value.hash = `#tgWebAppData=${encodeURIComponent(signedInitData)}&tgWebAppVersion=9.1&tgWebAppPlatform=android`;
  location.value.href += location.value.hash;
  const document = {
    currentScript: { dataset: { appUrl: 'https://plan-fakt.example/app/' } },
    readyState: 'complete',
    body: { dataset: {}, style: {}, classList: { contains: () => false } }
  };

  vm.runInNewContext(source, {
    window: { location: location.value }, document, URL, URLSearchParams
  });

  const target = new URL(location.state.replaced);
  assert.equal(target.origin + target.pathname, 'https://plan-fakt.example/app/');
  assert.equal(target.searchParams.get('source'), 'telegram');
  assert.equal(target.searchParams.get('tgWebAppData'), signedInitData);
  assert.equal(document.body.style.display, 'none');
}

function runGateRedirectWithCard() {
  const location = locationFor('/bmsu4.php', '?page=bmsu-4.php&org=bmsu-4');
  // data-card-enabled='1' проставляет bmsu4.php: карточка включена в
  // «Доступе к карточкам» для этой организации.
  const gate = gateDocument({ appUrl: 'https://plan-fakt.example/app/', dataset: { cardEnabled: '1' } });

  vm.runInNewContext(source, {
    window: { location: location.value }, document: gate.document, URL, URLSearchParams
  });

  const target = new URL(location.state.replaced);
  assert.equal(target.origin + target.pathname, 'https://plan-fakt.example/app/');
  assert.equal(target.searchParams.get('source'), 'site');
  assert.equal(target.searchParams.get('page'), 'bmsu-4.php');
  assert.equal(target.searchParams.get('org'), 'bmsu-4');
  assert.ok(!location.state.replaced.includes('bmsu4.php'));
}

function runGateRedirectWithoutPage() {
  // Адрес набран руками: страницы организации нет, проверять карточку не по
  // чему — вход спрашивает само приложение.
  const location = locationFor('/bmsu4.php');
  const gate = gateDocument({ appUrl: 'https://plan-fakt.example/app/' });

  vm.runInNewContext(source, {
    window: { location: location.value }, document: gate.document, URL, URLSearchParams
  });

  const target = new URL(location.state.replaced);
  assert.equal(target.origin + target.pathname, 'https://plan-fakt.example/app/');
  assert.equal(target.searchParams.get('source'), 'site');
}

async function runGateDeniedWithoutCard() {
  const location = locationFor('/bmsu4.php', '?page=bmsu-4.php');
  const gate = gateDocument({ appUrl: 'https://plan-fakt.example/app/', dataset: { cardEnabled: '0' } });
  const fetch = async () => ({ ok: true, json: async () => ({ blocks: [] }) });

  vm.runInNewContext(source, {
    window: { location: location.value }, document: gate.document, fetch, URL, URLSearchParams, Date
  });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(gate.visible(), ['bmsu4-denied'], 'Должен остаться только экран «Раздел недоступен»');
  assert.equal(location.state.replaced, '', 'Перехода в приложение быть не должно');
}

function runGateUnconfigured() {
  // Публичная страница без PLAN_FACT_APP_URL: переход по 127.0.0.1 увёл бы
  // пользователя на его собственный телефон, поэтому показываем объяснение.
  const location = locationFor('/bmsu4.php');
  const gate = gateDocument({});

  vm.runInNewContext(source, {
    window: { location: location.value }, document: gate.document, URL, URLSearchParams
  });

  assert.deepEqual(gate.visible(), ['bmsu4-unconfigured'], 'Должен остаться только экран «Раздел ещё не подключён»');
  assert.equal(location.state.replaced, '', 'Без адреса приложения перехода быть не должно');
}

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.listeners = {};
    this.parentNode = null;
    this.style = {};
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { this.children = this.children.filter(item => item !== child); child.parentNode = null; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  setAttribute() {}
  focus() {}
  querySelector(selector) {
    if (selector === '.map-tile__status') return this.findByClass('map-tile__status');
    return null;
  }
  findByClass(className) {
    if (String(this.className || '').split(/\s+/).includes(className)) return this;
    for (const child of this.children) {
      const found = child.findByClass(className);
      if (found) return found;
    }
    return null;
  }
  find(predicate) {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const found = child.find(predicate);
      if (found) return found;
    }
    return null;
  }
}

async function runTileRedirect() {
  const location = locationFor('/bmsu-4.php');
  const grid = new Element();
  const body = new Element('body');
  body.dataset = {};
  body.classList = { contains: () => false };
  body.contains = () => true;
  const document = {
    currentScript: { dataset: { appUrl: 'https://plan-fakt.example/' } },
    readyState: 'complete',
    body,
    head: new Element('head'),
    getElementById: () => null,
    createElement: tag => new Element(tag),
    querySelector: selector => selector === '.su21-tiles-group--active .su21-tiles-group__grid' ? grid : null,
    addEventListener() {},
    removeEventListener() {}
  };
  const fetch = async url => String(url).includes('/api/auth/launch')
    ? { ok: true, json: async () => ({ ticket: 'one-time-ticket' }) }
    : { ok: true, json: async () => ({ blocks: [{ page: 'bmsu-4.php', cards: ['bmsu4-tile'] }] }) };

  vm.runInNewContext(source, {
    window: { location: location.value }, document, fetch, URL, URLSearchParams,
    Date, Object, Array, String, setTimeout, clearTimeout,
    setInterval: () => 1, clearInterval, MutationObserver: undefined
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(grid.children.length, 1, 'Плитка План/факт не добавлена');
  grid.children[0].listeners.click({ preventDefault() {} });
  const overlay = body.findByClass('pf-login-overlay');
  assert.ok(overlay, 'Модальное окно входа не открылось');
  assert.equal(location.state.assigned, '', 'Переход произошёл до ввода логина');
  const login = overlay.find(node => node.name === 'login');
  const password = overlay.find(node => node.name === 'password');
  const form = overlay.findByClass('pf-login-form');
  login.value = 'Пархоменко';
  password.value = '286';
  form.listeners.submit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  const target = new URL(location.state.assigned);
  assert.equal(target.origin + target.pathname, 'https://plan-fakt.example/');
  assert.equal(target.searchParams.get('page'), 'bmsu-4.php');
  assert.equal(target.searchParams.get('org'), 'bmsu-4');
  assert.equal(target.searchParams.get('ticket'), 'one-time-ticket');
  assert.ok(!location.state.assigned.includes('bmsu4.php'));
}

function runLocalFallback() {
  const location = locationFor('/bmsu-4.php');
  location.value.href = 'http://127.0.0.1/bmsu-4.php';
  location.value.protocol = 'http:';
  location.value.hostname = '127.0.0.1';
  const gate = gateDocument({});

  vm.runInNewContext(source, {
    window: { location: location.value }, document: gate.document, URL, URLSearchParams
  });

  const target = new URL(location.state.replaced);
  assert.equal(target.origin + target.pathname, 'http://127.0.0.1:4173/');
}

async function runTileWithoutAppUrl() {
  const location = locationFor('/bmsu-4.php');
  const grid = new Element();
  const body = new Element('body');
  body.dataset = {};
  body.classList = { contains: () => false };
  body.contains = () => true;
  const document = {
    currentScript: { dataset: {} },
    readyState: 'complete',
    body,
    head: new Element('head'),
    getElementById: () => null,
    createElement: tag => new Element(tag),
    querySelector: selector => selector === '.su21-tiles-group--active .su21-tiles-group__grid' ? grid : null,
    addEventListener() {},
    removeEventListener() {}
  };
  const fetch = async () => ({ ok: true, json: async () => ({ blocks: [{ page: 'bmsu-4.php', cards: ['bmsu4-tile'] }] }) });

  vm.runInNewContext(source, {
    window: { location: location.value }, document, fetch, URL, URLSearchParams,
    Date, Object, Array, String, setTimeout, clearTimeout,
    setInterval: () => 1, clearInterval, MutationObserver: undefined
  });
  await new Promise(resolve => setImmediate(resolve));
  grid.children[0].listeners.click({ preventDefault() {} });
  // Адрес приложения плитка спрашивает у портала (bmsu4.php?config=1), поэтому
  // решение принимается не сразу — ждём ответа.
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  // Адреса нет и в настройках: окно входа отправляло бы логин в никуда,
  // поэтому плитка ведёт на bmsu4.php — там написано, что настроить.
  assert.ok(!body.findByClass('pf-login-overlay'), 'Без адреса приложения окно входа открываться не должно');
  assert.ok(location.state.assigned.startsWith('bmsu4.php?page='), `Ожидался переход на bmsu4.php, получено: ${location.state.assigned}`);
}

async function runTileAppUrlFromPortal() {
  // Плитку подключает startmain.js без атрибутов: адрес приложения приходит
  // ответом bmsu4.php?config=1, и окно входа открывается уже с ним.
  const location = locationFor('/bmsu-4.php');
  const grid = new Element();
  const body = new Element('body');
  body.dataset = {};
  body.classList = { contains: () => false };
  body.contains = () => true;
  const document = {
    currentScript: { dataset: {} },
    readyState: 'complete',
    body,
    head: new Element('head'),
    getElementById: () => null,
    createElement: tag => new Element(tag),
    querySelector: selector => selector === '.su21-tiles-group--active .su21-tiles-group__grid' ? grid : null,
    addEventListener() {},
    removeEventListener() {}
  };
  const requested = [];
  const fetch = async url => {
    requested.push(String(url));
    if (String(url).includes('config=1')) {
      return { ok: true, json: async () => ({ appUrl: 'https://bimmax.pro/planfakt/' }) };
    }
    return { ok: true, json: async () => ({ blocks: [{ page: 'bmsu-4.php', cards: ['bmsu4-tile'] }] }) };
  };
  const windowStub = { location: location.value };

  vm.runInNewContext(source, {
    window: windowStub, document, fetch, URL, URLSearchParams,
    Date, Object, Array, String, setTimeout, clearTimeout,
    setInterval: () => 1, clearInterval, MutationObserver: undefined
  });
  await new Promise(resolve => setImmediate(resolve));
  grid.children[0].listeners.click({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.ok(requested.some(url => url.includes('bmsu4.php?config=1')), 'Адрес приложения у портала не запрошен');
  assert.equal(windowStub.PLAN_FACT_APP_URL, 'https://bimmax.pro/planfakt/');
  assert.ok(body.findByClass('pf-login-overlay'), 'Окно входа должно открыться с полученным адресом');
  assert.equal(location.state.assigned, '', 'Переход не должен происходить до входа');
}

(async () => {
  runGateRedirectWithCard();
  runGateRedirectWithoutPage();
  await runGateDeniedWithoutCard();
  runGateUnconfigured();
  runTelegramLegacyRedirect();
  runTelegramRedirectAfterPortalRewrite('/start/');
  runTelegramRedirectAfterPortalRewrite('/');
  runTelegramRedirectAfterPortalRewrite('/bmsu-4.php');
  await runTileRedirect();
  runLocalFallback();
  await runTileWithoutAppUrl();
  await runTileAppUrlFromPortal();
  console.log('Страница-переход, модальный вход и одноразовый билет План/Факт работают.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
