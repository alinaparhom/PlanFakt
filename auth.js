'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ADMIN_LOGIN = 'Пархоменко';
const ADMIN_SALT = 'planfakt-admin-v1';
const ADMIN_PASSWORD_HASH = 'be97e0e1f2e62c51dbff7c466fd96bef225829c6370054eca68215e6693d528214aaf45e55613097e0b5263d5a09cfb1b529f15565d634282c04b13b7682371a';
const DATA_FILE = path.join(__dirname, '.planfakt-data.json');
const SESSION_LIFETIME = 12 * 60 * 60 * 1000;

function passwordHash(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function initialData() {
  return {
    users: [{ id: crypto.randomUUID(), name: ADMIN_LOGIN, login: ADMIN_LOGIN, role: 'Администратор', salt: ADMIN_SALT, passwordHash: ADMIN_PASSWORD_HASH, status: 'Активен' }],
    objects: [{ id: crypto.randomUUID(), name: 'DEPO', address: 'Минск', status: 'Активный' }]
  };
}

function ensureFirstAdmin(data) {
  let admin = data.users.find((user) => user.login.toLocaleLowerCase('ru') === ADMIN_LOGIN.toLocaleLowerCase('ru'));
  let changed = false;

  if (!admin) {
    admin = initialData().users[0];
    data.users.unshift(admin);
    changed = true;
  }

  // У первого администратора всегда остаются заданные владельцем доступ и роль.
  // Это также чинит уже созданные на сервере файлы данных из старых версий.
  const required = {
    name: ADMIN_LOGIN,
    login: ADMIN_LOGIN,
    role: 'Администратор',
    salt: ADMIN_SALT,
    passwordHash: ADMIN_PASSWORD_HASH,
    status: 'Активен'
  };
  for (const [key, value] of Object.entries(required)) {
    if (admin[key] !== value) {
      admin[key] = value;
      changed = true;
    }
  }
  return changed;
}

function loadData() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (Array.isArray(data.users) && Array.isArray(data.objects)) return data;
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Не удалось прочитать данные:', error.message);
  }
  const data = initialData();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  return data;
}

function saveData(data) {
  const temporary = DATA_FILE + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, DATA_FILE);
}

function publicUser(user) {
  return { id: user.id, name: user.name, login: user.login, role: user.role, status: user.status };
}

function createAuthHandler() {
  const sessions = new Map();
  const data = loadData();
  if (ensureFirstAdmin(data)) saveData(data);

  function getSession(request) {
    const match = (request.headers.cookie || '').match(/(?:^|;\s*)planfakt_session=([^;]+)/);
    const session = match && sessions.get(match[1]);
    if (!session || session.expiresAt < Date.now()) {
      if (match) sessions.delete(match[1]);
      return null;
    }
    return session;
  }

  function send(response, status, body, headers) {
    response.writeHead(status, Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, headers));
    response.end(JSON.stringify(body));
  }

  function readJson(request) {
    return new Promise((resolve, reject) => {
      let body = '';
      request.on('data', (chunk) => {
        body += chunk;
        if (body.length > 10_000) reject(new Error('Слишком большой запрос'));
      });
      request.on('end', () => {
        try { resolve(JSON.parse(body || '{}')); } catch (error) { reject(error); }
      });
      request.on('error', reject);
    });
  }

  function requireAdmin(request, response) {
    const session = getSession(request);
    if (!session) send(response, 401, { error: 'Сначала войдите в систему' });
    else if (session.user.role !== 'Администратор') send(response, 403, { error: 'Доступно только администратору' });
    else return session;
    return null;
  }

  return async function handleAuth(request, response, pathname) {
    if (pathname === '/api/auth/session' && request.method === 'GET') {
      const session = getSession(request);
      send(response, 200, { authenticated: Boolean(session), user: session ? session.user : null });
      return true;
    }

    if (pathname === '/api/auth/login' && request.method === 'POST') {
      try {
        const credentials = await readJson(request);
        const login = String(credentials.login || '').trim().toLocaleLowerCase('ru');
        const found = data.users.find((item) => item.login.toLocaleLowerCase('ru') === login && item.status !== 'Заблокирован');
        const supplied = found && passwordHash(credentials.password || '', found.salt);
        const valid = found && crypto.timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(found.passwordHash, 'hex'));
        if (!valid) {
          send(response, 401, { error: 'Неверный логин или пароль' });
          return true;
        }
        const token = crypto.randomBytes(32).toString('base64url');
        const user = publicUser(found);
        sessions.set(token, { user, expiresAt: Date.now() + SESSION_LIFETIME });
        send(response, 200, { authenticated: true, user }, { 'set-cookie': `planfakt_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_LIFETIME / 1000}` });
      } catch (error) {
        send(response, 400, { error: 'Не удалось прочитать данные' });
      }
      return true;
    }

    if (pathname === '/api/auth/logout' && request.method === 'POST') {
      const match = (request.headers.cookie || '').match(/(?:^|;\s*)planfakt_session=([^;]+)/);
      if (match) sessions.delete(match[1]);
      send(response, 200, { authenticated: false }, { 'set-cookie': 'planfakt_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
      return true;
    }

    if (pathname === '/api/admin/data' && request.method === 'GET') {
      if (!requireAdmin(request, response)) return true;
      send(response, 200, { users: data.users.map(publicUser), objects: data.objects });
      return true;
    }

    if ((pathname === '/api/admin/users' || pathname === '/api/admin/objects') && request.method === 'POST') {
      if (!requireAdmin(request, response)) return true;
      try {
        const body = await readJson(request);
        if (!String(body.name || '').trim() || !String(body.detail || '').trim()) throw new Error('Заполните все поля');
        if (pathname.endsWith('/users')) {
          if (!String(body.password || '').trim()) throw new Error('Укажите пароль');
          if (data.users.some((item) => item.login.toLocaleLowerCase('ru') === String(body.detail).trim().toLocaleLowerCase('ru'))) throw new Error('Такой логин уже есть');
          const salt = crypto.randomBytes(16).toString('hex');
          data.users.push({ id: crypto.randomUUID(), name: String(body.name).trim(), login: String(body.detail).trim(), role: body.role || 'Наблюдатель', salt, passwordHash: passwordHash(body.password, salt), status: 'Активен' });
        } else {
          data.objects.push({ id: crypto.randomUUID(), name: String(body.name).trim(), address: String(body.detail).trim(), status: 'Активный' });
        }
        saveData(data);
        send(response, 201, { ok: true });
      } catch (error) {
        send(response, 400, { error: error.message || 'Не удалось сохранить' });
      }
      return true;
    }
    return false;
  };
}

module.exports = { createAuthHandler };
