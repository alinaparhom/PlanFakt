'use strict';

const TELEGRAM_API = 'https://api.telegram.org';

function createTelegramBot({ token, webAppUrl, logger = console }) {
  let offset = 0;
  let stopped = false;

  async function api(method, payload = {}) {
    const response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(`Telegram API ${method}: ${result.description || response.status}`);
    }
    return result.result;
  }

  async function sendWelcome(chatId, firstName) {
    const greeting = firstName ? `, ${firstName}` : '';
    return api('sendMessage', {
      chat_id: chatId,
      text: `Добро пожаловать${greeting}! Нажмите кнопку, чтобы открыть приложение.`,
      reply_markup: {
        inline_keyboard: [[{
          text: 'Открыть приложение',
          web_app: { url: webAppUrl }
        }]]
      }
    });
  }

  async function handleUpdate(update) {
    const message = update.message;
    if (!message || !message.chat) return;

    if (/^\/(start|app)(?:@\w+)?(?:\s|$)/i.test(message.text || '')) {
      await sendWelcome(message.chat.id, message.from && message.from.first_name);
    }
  }

  async function configure() {
    await api('setMyCommands', {
      commands: [
        { command: 'start', description: 'Запустить бота' },
        { command: 'app', description: 'Открыть приложение' }
      ]
    });
    await api('setChatMenuButton', {
      menu_button: {
        type: 'web_app',
        text: 'Открыть',
        web_app: { url: webAppUrl }
      }
    });
  }

  async function poll() {
    while (!stopped) {
      try {
        const updates = await api('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
        for (const update of updates) {
          offset = update.update_id + 1;
          try {
            await handleUpdate(update);
          } catch (error) {
            logger.error('Не удалось обработать сообщение:', error.message);
          }
        }
      } catch (error) {
        if (!stopped) {
          logger.error('Ошибка Telegram:', error.message);
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }
    }
  }

  return {
    async start() {
      await api('deleteWebhook', { drop_pending_updates: false });
      await configure();
      logger.log('Telegram-бот подключён');
      return poll();
    },
    stop() { stopped = true; }
  };
}

module.exports = { createTelegramBot };
