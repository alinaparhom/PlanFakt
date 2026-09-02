'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createTelegramBot } = require('./bot/telegram-bot');
const { createAuthHandler } = require('./auth');

const root = __dirname;
const port = Number(process.env.PORT) || 3000;
const publicFiles = new Set(['/index.html', '/app.js', '/auth-modal.js', '/admin-panel.js', '/views.js', '/role-access.js', '/telegram.js', '/bmsu4.js', '/styles.css']);
const handleAuth = createAuthHandler();
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8'
};

function loadLocalEnv() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

loadLocalEnv();

const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname.startsWith('/api/auth/') && await handleAuth(request, response, pathname)) return;
  if (pathname === '/health') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  const requestedFile = pathname === '/' ? '/index.html' : pathname;
  if (!publicFiles.has(requestedFile)) {
    response.writeHead(404).end('Not found');
    return;
  }

  const filePath = path.join(root, requestedFile);
  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(500).end('Server error');
      return;
    }
    response.writeHead(200, {
      'content-type': contentTypes[path.extname(filePath)] || 'application/octet-stream',
      'x-content-type-options': 'nosniff'
    });
    response.end(content);
  });
});

server.listen(port, () => {
  console.log(`Приложение запущено: http://localhost:${port}`);
});

const token = process.env.TELEGRAM_BOT_TOKEN;
const webAppUrl = process.env.BOT_WEB_APP_URL;
let bot;

if (!token || !webAppUrl) {
  console.warn('Бот не запущен: задайте TELEGRAM_BOT_TOKEN и BOT_WEB_APP_URL в .env');
} else {
  try {
    const url = new URL(webAppUrl);
    if (url.protocol !== 'https:') throw new Error('BOT_WEB_APP_URL должен использовать HTTPS');
    bot = createTelegramBot({ token, webAppUrl: url.toString() });
    bot.start().catch((error) => console.error('Бот остановлен:', error.message));
  } catch (error) {
    console.error('Некорректная настройка бота:', error.message);
  }
}

function shutdown() {
  if (bot) bot.stop();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
