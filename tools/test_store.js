'use strict';

/*
 * test_store.js — подготовка хранилища для проверок.
 *
 * Каталог data/*.json закрыт в .gitignore: файлы создаёт сам сервер при первом
 * запуске. На свежей копии репозитория их ещё нет, поэтому тесты, копировавшие
 * data/ напрямую, падали с ENOENT на projects.json. Здесь недостающие файлы
 * создаются тем же кодом, что и в рабочем режиме: server.js подключается в
 * отдельном процессе с нужным PLAN_FACT_DATA_DIR и завершается сразу после
 * того, как хранилище записано на диск.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

/**
 * Готовит каталог данных для теста: копирует существующие файлы репозитория и
 * досоздаёт недостающие. Возвращает путь к каталогу.
 */
function prepareTestData(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.cpSync(path.join(ROOT, 'data'), dataDir, { recursive: true });

  if (fs.existsSync(path.join(dataDir, 'projects.json'))) {
    return dataDir;
  }

  // PORT=0 — свободный порт: запущенный сервис разработчика мешать не должен.
  const result = spawnSync(process.execPath, ['-e', 'require(process.argv[1]);setTimeout(()=>process.exit(0),0)', path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      PORT: '0',
      HOST: '127.0.0.1',
      PLAN_FACT_DATA_DIR: dataDir,
      TELEGRAM_BOT_DISABLED: '1',
      SESSION_SECRET: 'plan-fakt-test-store-secret'
    }
  });

  if (!fs.existsSync(path.join(dataDir, 'projects.json'))) {
    throw new Error(`Не удалось создать хранилище для проверки: ${result.stderr || result.error || 'файлы не появились'}`);
  }
  return dataDir;
}

module.exports = { prepareTestData };
