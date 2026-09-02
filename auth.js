'use strict';

const crypto = require('node:crypto');

const ADMIN_LOGIN = 'Пархоменко';
const PASSWORD_SALT = 'planfakt-admin-v1';
const ADMIN_PASSWORD_HASH = 'be97e0e1f2e62c51dbff7c466fd96bef225829c6370054eca68215e6693d528214aaf45e55613097e0b5263d5a09cfb1b529f15565d634282c04b13b7682371a';
const SESSION_LIFETIME = 12 * 60 * 60 * 1000;

function createAuthHandler() {
  const sessions = new Map();

  function getSession(request) {
    const cookie = request.headers.cookie || '';
    const match = cookie.match(/(?:^|;\s*)planfakt_session=([^;]+)/);
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
        if (body.length > 10_000) request.destroy();
      });
      request.on('end', () => {
        try { resolve(JSON.parse(body || '{}')); } catch (error) { reject(error); }
      });
      request.on('error', reject);
    });
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
        const suppliedHash = crypto.scryptSync(String(credentials.password || ''), PASSWORD_SALT, 64);
        const expectedHash = Buffer.from(ADMIN_PASSWORD_HASH, 'hex');
        const validPassword = crypto.timingSafeEqual(suppliedHash, expectedHash);
        if (String(credentials.login || '').trim().toLocaleLowerCase('ru') !== ADMIN_LOGIN.toLocaleLowerCase('ru') || !validPassword) {
          send(response, 401, { error: 'Неверный логин или пароль' });
          return true;
        }
        const token = crypto.randomBytes(32).toString('base64url');
        const user = { login: ADMIN_LOGIN, name: 'Пархоменко', role: 'Администратор' };
        sessions.set(token, { user, expiresAt: Date.now() + SESSION_LIFETIME });
        send(response, 200, { authenticated: true, user }, { 'set-cookie': `planfakt_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_LIFETIME / 1000}` });
      } catch (error) {
        send(response, 400, { error: 'Не удалось прочитать данные' });
      }
      return true;
    }

    if (pathname === '/api/auth/logout' && request.method === 'POST') {
      const cookie = request.headers.cookie || '';
      const match = cookie.match(/(?:^|;\s*)planfakt_session=([^;]+)/);
      if (match) sessions.delete(match[1]);
      send(response, 200, { authenticated: false }, { 'set-cookie': 'planfakt_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
      return true;
    }
    return false;
  };
}

module.exports = { createAuthHandler };
