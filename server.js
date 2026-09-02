'use strict';

const path = require('node:path');
const express = require('express');
const { createStore } = require('./src/store');
const { authRouter, requireAuth } = require('./src/auth');
const { apiRouter } = require('./src/api');
const { createTelegramBot } = require('./bot/telegram-bot');

const app = express();
const port = Number(process.env.PORT || 3000);
const store = createStore(path.join(__dirname, 'data'));

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));
app.use('/api/auth', authRouter(store));
app.use('/api', requireAuth(store), apiRouter(store));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/*splat', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

if (require.main === module) {
  app.listen(port, () => console.log(`План / Факт: http://localhost:${port}`));
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.PUBLIC_URL) {
    createTelegramBot({ token: process.env.TELEGRAM_BOT_TOKEN, webAppUrl: process.env.PUBLIC_URL })
      .start().catch((error) => console.error('Telegram-бот остановлен:', error.message));
  }
}

module.exports = { app, store };
