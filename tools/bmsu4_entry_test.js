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

function runTelegramLegacyRedirect() {
  const location = locationFor('/bmsu4.php');
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

function runLegacyRedirect() {
  const location = locationFor('/bmsu4.php', '?page=bmsu-4.php&org=bmsu-4');
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
  assert.equal(target.searchParams.get('source'), 'site');
  assert.equal(target.searchParams.get('page'), 'bmsu-4.php');
  assert.equal(target.searchParams.get('org'), 'bmsu-4');
  assert.ok(!location.state.replaced.includes('bmsu4.php'));
  assert.equal(document.body.style.display, 'none');
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
  const document = {
    currentScript: { dataset: {} },
    readyState: 'complete',
    body: { dataset: {}, style: {}, classList: { contains: value => value === 'bmsu4-page' } }
  };

  vm.runInNewContext(source, {
    window: { location: location.value }, document, URL, URLSearchParams
  });

  const target = new URL(location.state.replaced);
  assert.equal(target.origin + target.pathname, 'http://127.0.0.1:4173/');
}

async function runPublicFallback() {
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
  assert.ok(body.findByClass('pf-login-overlay'), 'На публичной странице должно открыться окно входа');
  assert.equal(location.state.assigned, '', 'Переход не должен происходить до входа');
}

(async () => {
  runLegacyRedirect();
  runTelegramLegacyRedirect();
  runTelegramRedirectAfterPortalRewrite('/start/');
  runTelegramRedirectAfterPortalRewrite('/');
  runTelegramRedirectAfterPortalRewrite('/bmsu-4.php');
  await runTileRedirect();
  runLocalFallback();
  await runPublicFallback();
  console.log('Модальный вход План/Факт и переход по одноразовому билету работают.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
