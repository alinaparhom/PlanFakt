'use strict';

const express = require('express');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const COOKIE = 'pf_session';
const DAY = 86400000;

function cookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter((part) => part.length === 2));
}

function safeUser(user) {
  const { passwordHash, ...result } = user;
  return result;
}

function authRouter(store) {
  const router = express.Router();
  router.post('/login', (req, res) => {
    const user = store.data.users.find((item) => item.login.toLocaleLowerCase('ru') === String(req.body.login || '').trim().toLocaleLowerCase('ru'));
    if (!user || !bcrypt.compareSync(String(req.body.password || ''), user.passwordHash)) return res.status(401).json({ error: 'Неверный логин или пароль' });
    const token = crypto.randomBytes(32).toString('hex');
    store.data.sessions = store.data.sessions.filter((item) => item.expiresAt > Date.now());
    store.data.sessions.push({ token, userId: user.id, expiresAt: Date.now() + 30 * DAY });
    store.persist();
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${req.secure ? '; Secure' : ''}`);
    res.json({ user: safeUser(user) });
  });
  router.post('/telegram', (req, res) => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken || !verifyTelegram(req.body.initData, botToken)) return res.status(401).json({ error: 'Telegram-авторизация не подтверждена' });
    const params = new URLSearchParams(req.body.initData);
    const tg = JSON.parse(params.get('user') || '{}');
    const user = store.data.users.find((item) => String(item.telegramId) === String(tg.id));
    if (!user) return res.status(403).json({ error: 'Попросите администратора добавить ваш Telegram ID' });
    const token = crypto.randomBytes(32).toString('hex');
    store.data.sessions.push({ token, userId: user.id, expiresAt: Date.now() + 30 * DAY }); store.persist();
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${30 * 86400}`);
    res.json({ user: safeUser(user) });
  });
  router.post('/logout', requireAuth(store), (req, res) => {
    store.data.sessions = store.data.sessions.filter((item) => item.token !== req.session.token); store.persist();
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`); res.json({ ok: true });
  });
  return router;
}

function verifyTelegram(initData, token) {
  if (!initData) return false;
  const params = new URLSearchParams(initData); const hash = params.get('hash'); params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = crypto.createHmac('sha256', secret).update(check).digest('hex');
  if (!hash || !/^[a-f\d]{64}$/i.test(hash)) return false;
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expected, 'hex'));
}

function requireAuth(store) {
  return (req, res, next) => {
    const token = cookies(req.headers.cookie)[COOKIE];
    const session = store.data.sessions.find((item) => item.token === token && item.expiresAt > Date.now());
    const user = session && store.findUser(session.userId);
    if (!user) return res.status(401).json({ error: 'Необходим вход' });
    req.user = user; req.session = session; next();
  };
}

module.exports = { authRouter, requireAuth, safeUser, verifyTelegram };
