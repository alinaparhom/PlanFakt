/*
 * bmsu4.js — раздел «План/факт» заказчика.
 *
 * Копия файла портала: на bimmax.pro он лежит по пути
 * public_html/js/other/bmsu4.js. Здесь он хранится рядом с приложением,
 * чтобы правки проверялись тестом tools/bmsu4_entry_test.js. Меняя файл,
 * обновляйте обе копии.
 *
 * Сам раздел работает отдельным приложением «План / Факт» (репозиторий
 * alinaparhom/PlanFakt). Его публичный адрес портал берёт из .env
 * (PLAN_FACT_APP_URL): странице-переходу он приходит атрибутом
 * body[data-plan-fakt-url], а главной странице организации — коротким ответом
 * bmsu4.php?config=1.
 *
 * Один файл работает в двух режимах и сам определяет нужный:
 *
 * 1. Главная страница организации (su-21.php и подобные).
 *    Модуль подключается из js/startmain/startmain.js и рисует плитку
 *    «План/факт» в секции «Доступные разделы».
 *    Плитка появляется ТОЛЬКО если администратор включил карточку
 *    «План/факт» в разделе «Доступ к карточкам» (service.php →
 *    lg/dostupcard.json) для текущей страницы организации. По умолчанию
 *    карточка выключена и на главной не отображается совсем — ни рабочей
 *    плиткой, ни закрытой «под замочком». Так раздел остаётся личным для
 *    организации заказчика.
 *    По клику открывается компактное окно входа поверх страницы: сервер
 *    приложения проверяет логин и выдаёт одноразовый билет на 60 секунд.
 *
 * 2. Страница-переход bmsu4.php (body.bmsu4-page).
 *    Показывает «Открываем раздел…» и уводит в приложение. Именно сюда
 *    попадает Telegram Mini App, если в BotFather указан адрес портала:
 *    параметры запуска Telegram приходят во фрагменте адреса, сервер их не
 *    видит, поэтому решение принимается здесь, в браузере.
 *
 * Настройки доступа читаются всегда свежими: cache: 'no-store', заголовок
 * Cache-Control и метка времени в адресе запроса.
 */
(function () {
  'use strict';

  var TILE_ID = 'bmsu4-tile';                 // идентификатор карточки в «Доступе к карточкам»
  var TILE_TITLE = 'План/факт';
  var TILE_TEXT = 'Плановые и фактические показатели организации';
  var GATE_PAGE = 'bmsu4.php';                // страница-переход
  var CONFIG_URL = 'bmsu4.php';               // она же отдаёт адрес приложения по ?config=1
  var LOCAL_APP_URL = 'http://127.0.0.1:4173/'; // только для локальной разработки
  var ACCESS_URL = 'lg/dostupcard.json';      // настройки доступа к карточкам
  var STYLE_ID = 'bmsu4-style';
  var LOGIN_STYLE_ID = 'bmsu4-login-style';
  var REFRESH_MS = 60000;                     // период проверки доступа, как в startmain.js
  var MOUNT_RETRY_MS = 400;                   // пауза между попытками найти сетку плиток
  var MOUNT_RETRY_LIMIT = 30;                 // ~12 секунд ожидания разметки главной страницы
  var SCRIPT_NODE = document.currentScript;   // currentScript недоступен после загрузки файла
  var loginModal = null;
  var appUrlRequest = null;                   // адрес приложения спрашивается у портала один раз

  // Иконка карточки: оси графика, столбцы «план» и «факт», пунктир целевого уровня.
  var TILE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"' +
    ' stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">' +
      '<path d="M4 3v18h17"/>' +
      '<rect x="7.5" y="13" width="4" height="8" rx="1"/>' +
      '<rect x="14.5" y="9" width="4" height="12" rx="1"/>' +
      '<path d="M6.5 7.5h13" stroke-dasharray="3 2.5"/>' +
    '</svg>';

  /* ======================================================================
   *  Общие помощники
   * ==================================================================== */

  /** Имя текущей страницы, например «su-21.php». */
  function currentPageName() {
    var path = (window.location && window.location.pathname) || '';
    var parts = String(path).split('/');
    var last = parts.pop() || '';
    if (!last && parts.length) {
      last = parts.pop() || '';
    }
    return last.trim();
  }

  /** Организация: атрибут body или имя страницы без расширения. */
  function currentOrganization() {
    var explicit = document.body && document.body.dataset
      ? String(document.body.dataset.organization || '').trim()
      : '';
    if (explicit) {
      return explicit;
    }
    var page = currentPageName();
    var match = page.match(/^(.+)\.php$/i);
    if (!match) {
      return '';
    }
    try {
      return decodeURIComponent(match[1]);
    } catch (error) {
      return match[1];
    }
  }

  /** Портал открыт на локальном стенде разработчика? */
  function isLocalHost() {
    var host = String(window.location.hostname || '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '';
  }

  /**
   * Telegram может открыть исходную ссылку через один или несколько HTTP-
   * редиректов портала. В результате pathname уже бывает /start/ или /, но
   * параметры Mini App остаются в query/fragment. Они надёжнее имени страницы.
   */
  function hasTelegramLaunchData() {
    var sourceParams = new URLSearchParams(window.location.search || '');
    var hashParams = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
    return Boolean(hashParams.get('tgWebAppData') || sourceParams.get('tgWebAppData'));
  }

  /**
   * Адрес отдельного приложения «План / Факт». Порядок источников:
   *   window.PLAN_FACT_APP_URL = 'https://bimmax.pro/planfakt/';
   *   <script src="bmsu4.js" data-app-url="https://...">
   *   <body data-plan-fakt-url="https://..."> — так его подставляет bmsu4.php
   *                                             из PLAN_FACT_APP_URL в .env
   *
   * Возвращает null, если адрес не задан: на телефоне переход по 127.0.0.1
   * уводил бы пользователя на его собственное устройство, поэтому локальный
   * запасной адрес работает только на самом стенде разработчика.
   */
  function applicationUrl() {
    var configured = typeof window.PLAN_FACT_APP_URL === 'string'
      ? window.PLAN_FACT_APP_URL.trim()
      : '';
    var scriptUrl = SCRIPT_NODE && SCRIPT_NODE.dataset
      ? String(SCRIPT_NODE.dataset.appUrl || '').trim()
      : '';
    var bodyUrl = document.body && document.body.dataset
      ? String(document.body.dataset.planFaktUrl || '').trim()
      : '';
    var target = configured || scriptUrl || bodyUrl;

    if (!target && isLocalHost()) {
      target = LOCAL_APP_URL;
    }
    if (!target) {
      return null;
    }

    try {
      return new URL(target, window.location.href);
    } catch (error) {
      return null;
    }
  }

  /** Переход прямо к форме входа приложения с контекстом исходной страницы. */
  function openApplication(replaceHistory, ticket) {
    var target = applicationUrl();
    if (!target) {
      return false;
    }
    var sourceParams = new URLSearchParams(window.location.search || '');
    var hashParams = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
    var currentPage = currentPageName();
    var onGatePage = currentPage.toLowerCase() === GATE_PAGE;
    var page = onGatePage
      ? String(sourceParams.get('page') || '').trim()
      : currentPage;
    var organization = onGatePage
      ? String(sourceParams.get('org') || '').trim()
      : currentOrganization();

    // Telegram обычно добавляет initData и служебные параметры во fragment
    // исходного URL. При переходе со страницы bmsu4.php fragment браузером на
    // новый адрес не переносится, поэтому раньше приложение теряло Telegram ID
    // и показывало обычный web-вход. Переносим только известные параметры; их
    // подпись всё равно обязательно проверяется сервером перед авторизацией.
    var telegramParameterNames = [
      'tgWebAppData',
      'tgWebAppVersion',
      'tgWebAppPlatform',
      'tgWebAppThemeParams',
      'tgWebAppStartParam'
    ];
    var telegramLaunch = false;
    for (var i = 0; i < telegramParameterNames.length; i += 1) {
      var parameterName = telegramParameterNames[i];
      var parameterValue = hashParams.get(parameterName) || sourceParams.get(parameterName);
      if (!parameterValue) continue;
      target.searchParams.set(parameterName, parameterValue);
      if (parameterName === 'tgWebAppData') telegramLaunch = true;
    }

    target.searchParams.set('source', telegramLaunch ? 'telegram' : 'site');
    if (ticket) {
      target.searchParams.set('ticket', ticket);
    }
    if (page) {
      target.searchParams.set('page', page);
    }
    if (organization) {
      target.searchParams.set('org', organization);
    }

    if (replaceHistory) {
      window.location.replace(target.toString());
    } else {
      window.location.assign(target.toString());
    }
    return true;
  }

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function ensureLoginStyles() {
    if (document.getElementById(LOGIN_STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = LOGIN_STYLE_ID;
    style.textContent =
      '.pf-login-overlay{position:fixed;z-index:2147483000;inset:0;display:grid;place-items:center;padding:20px;background:rgba(13,29,55,.82);backdrop-filter:blur(7px);font-family:Inter,"Segoe UI",Arial,sans-serif}' +
      '.pf-login-card{position:relative;width:min(390px,100%);padding:30px 28px 26px;border:1px solid rgba(226,232,240,.9);border-radius:17px;background:#fff;box-shadow:0 28px 80px rgba(2,12,32,.34);color:#172235}' +
      '.pf-login-close{position:absolute;top:11px;right:11px;width:34px;height:34px;border:1px solid #e3e9f1;border-radius:9px;background:#fff;color:#68778a;font-size:22px;line-height:1;cursor:pointer}' +
      '.pf-login-logo{display:grid;place-items:center;width:44px;height:44px;margin:0 auto 15px;border-radius:12px;background:#17243f;color:#fff;font-size:12px;font-weight:900;letter-spacing:.03em}' +
      '.pf-login-title{margin:0;text-align:center;font-size:24px;font-weight:800;letter-spacing:-.025em}' +
      '.pf-login-subtitle{margin:7px 0 22px;text-align:center;color:#8591a3;font-size:12px;line-height:1.45}' +
      '.pf-login-form{display:flex;flex-direction:column;gap:14px}' +
      '.pf-login-label{display:flex;flex-direction:column;gap:7px;color:#26354a;font-size:12px;font-weight:750}' +
      '.pf-login-field{position:relative}' +
      '.pf-login-field input{box-sizing:border-box;width:100%;height:47px;padding:0 43px 0 14px;border:1px solid #d9e1ec;border-radius:10px;outline:0;background:#fff;color:#172235;font:14px Inter,"Segoe UI",Arial,sans-serif}' +
      '.pf-login-field input:focus{border-color:#4562f4;box-shadow:0 0 0 3px rgba(69,98,244,.13)}' +
      '.pf-login-eye{position:absolute;right:7px;top:6px;width:35px;height:35px;border:0;background:transparent;color:#8b98aa;cursor:pointer}' +
      '.pf-login-submit{height:46px;margin-top:2px;border:0;border-radius:10px;background:#4562f4;color:#fff;font-size:13px;font-weight:800;cursor:pointer;box-shadow:0 10px 24px rgba(69,98,244,.24)}' +
      '.pf-login-submit:disabled{cursor:wait;opacity:.65}' +
      '.pf-login-error{min-height:17px;margin:0;text-align:center;color:#c13d35;font-size:11px;font-weight:650}' +
      '@media(max-width:480px){.pf-login-overlay{padding:14px}.pf-login-card{padding:28px 20px 22px}}';
    document.head.appendChild(style);
  }

  function closeLoginModal() {
    if (!loginModal) return;
    document.removeEventListener('keydown', loginModal.keyHandler);
    if (loginModal.overlay.parentNode) loginModal.overlay.parentNode.removeChild(loginModal.overlay);
    loginModal = null;
  }

  function loginEndpoint() {
    var base = applicationUrl();
    if (!base) return '';
    base.search = '';
    base.hash = '';
    if (base.pathname.slice(-1) !== '/') base.pathname += '/';
    return new URL('api/auth/launch', base.toString()).toString();
  }

  function showLoginModal() {
    if (loginModal) {
      loginModal.login.focus();
      return;
    }
    ensureLoginStyles();

    var overlay = element('div', 'pf-login-overlay');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'pf-login-title');
    var card = element('section', 'pf-login-card');
    var close = element('button', 'pf-login-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Закрыть окно входа');
    var logo = element('div', 'pf-login-logo', 'П/Ф');
    var title = element('h2', 'pf-login-title', 'План / Факт');
    title.id = 'pf-login-title';
    var subtitle = element('p', 'pf-login-subtitle', 'Введите логин и пароль для входа в блок');
    var form = element('form', 'pf-login-form');
    var loginLabel = element('label', 'pf-login-label', 'Логин');
    var loginField = element('div', 'pf-login-field');
    var login = element('input');
    login.name = 'login'; login.autocomplete = 'username'; login.required = true;
    login.placeholder = 'Ваш логин';
    var passwordLabel = element('label', 'pf-login-label', 'Пароль');
    var passwordField = element('div', 'pf-login-field');
    var password = element('input');
    password.name = 'password'; password.type = 'password'; password.autocomplete = 'current-password'; password.required = true;
    password.placeholder = 'Введите пароль';
    var eye = element('button', 'pf-login-eye', '◉');
    eye.type = 'button'; eye.setAttribute('aria-label', 'Показать пароль');
    var submit = element('button', 'pf-login-submit', 'Войти');
    submit.type = 'submit';
    var error = element('p', 'pf-login-error');
    error.setAttribute('role', 'alert');

    loginField.appendChild(login); loginLabel.appendChild(loginField);
    passwordField.appendChild(password); passwordField.appendChild(eye); passwordLabel.appendChild(passwordField);
    form.appendChild(loginLabel); form.appendChild(passwordLabel); form.appendChild(submit); form.appendChild(error);
    card.appendChild(close); card.appendChild(logo); card.appendChild(title); card.appendChild(subtitle); card.appendChild(form);
    overlay.appendChild(card); document.body.appendChild(overlay);

    var keyHandler = function (event) { if (event.key === 'Escape' || event.keyCode === 27) closeLoginModal(); };
    loginModal = { overlay: overlay, login: login, password: password, submit: submit, error: error, keyHandler: keyHandler };
    document.addEventListener('keydown', keyHandler);
    close.addEventListener('click', closeLoginModal);
    overlay.addEventListener('click', function (event) { if (event.target === overlay) closeLoginModal(); });
    eye.addEventListener('click', function () {
      password.type = password.type === 'password' ? 'text' : 'password';
      eye.setAttribute('aria-label', password.type === 'password' ? 'Показать пароль' : 'Скрыть пароль');
    });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      error.textContent = '';
      var endpoint = loginEndpoint();
      if (!endpoint) {
        error.textContent = 'Адрес приложения не настроен администратором портала';
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Проверяем…';
      fetch(endpoint, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: login.value, password: password.value })
      })
        .then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (data) {
            if (!response.ok) throw new Error(data.error || 'Не удалось выполнить вход');
            return data;
          });
        })
        .then(function (data) {
          if (!data.ticket) throw new Error('Сервер не подтвердил вход');
          openApplication(false, data.ticket);
        })
        .catch(function (requestError) {
          error.textContent = requestError && requestError.message === 'Failed to fetch'
            ? 'Сервис План / Факт недоступен'
            : (requestError.message || 'Не удалось выполнить вход');
          submit.disabled = false;
          submit.textContent = 'Войти';
        });
    });
    setTimeout(function () { login.focus(); }, 0);
  }

  /* ======================================================================
   *  Режим 1. Плитка «План/факт» на главной странице организации
   * ==================================================================== */

  function initTileMode() {
    var tile = null;              // плитка создаётся один раз
    var allowed = false;          // карточка включена для текущей страницы
    var mountAttempts = 0;
    var mountTimer = null;
    var refreshTimer = null;
    var observer = null;

    /** Подключаем стили карточки один раз, без кеша браузера. */
    function ensureStyles() {
      if (document.getElementById(STYLE_ID)) {
        return;
      }
      var link = document.createElement('link');
      link.id = STYLE_ID;
      link.rel = 'stylesheet';
      link.href = 'css/bmsu4.css?v=' + Date.now();
      document.head.appendChild(link);
    }

    /** Сетка активных разделов главной страницы. */
    function findActiveGrid() {
      return document.querySelector('.su21-tiles-group--active .su21-tiles-group__grid')
        || document.querySelector('.su21-interface__tiles');
    }

    /** Показываем вход поверх текущей страницы, не покидая сайт. */
    function openCard(event) {
      if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
      }
      if (applicationUrl()) {
        showLoginModal();
        return;
      }
      // Адрес ещё не спросили у портала либо его там нет. Спрашиваем и решаем:
      // окно входа с готовым адресом или страница bmsu4.php с объяснением,
      // что администратору нужно задать PLAN_FACT_APP_URL в .env.
      loadConfiguredAppUrl().then(function () {
        if (applicationUrl()) {
          showLoginModal();
          return;
        }
        window.location.assign(GATE_PAGE + '?page=' + encodeURIComponent(currentPageName()));
      });
    }

    /** Разметка плитки в стиле остальных разделов главной страницы. */
    function buildTile() {
      var node = document.createElement('div');
      node.className = 'map-tile map-tile--bmsu4';
      node.id = TILE_ID;
      node.setAttribute('role', 'button');
      node.setAttribute('tabindex', '0');
      node.setAttribute('aria-label', 'Открыть «' + TILE_TITLE + '»');

      var header = document.createElement('div');
      header.className = 'map-tile__header map-tile__header--stacked';

      var title = document.createElement('span');
      title.textContent = TILE_TITLE;

      // Подпись статуса задаёт администратор в «Доступе к карточкам».
      var status = document.createElement('span');
      status.className = 'map-tile__status';
      status.hidden = true;
      status.style.display = 'none';

      header.appendChild(title);
      header.appendChild(status);

      var body = document.createElement('div');
      body.className = 'map-tile__body map-tile__body--bmsu4';

      var content = document.createElement('div');
      content.className = 'map-tile__bmsu4-content';

      var icon = document.createElement('span');
      icon.className = 'map-tile__bmsu4-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = TILE_ICON;

      var text = document.createElement('span');
      text.className = 'map-tile__bmsu4-text';
      text.textContent = TILE_TEXT;

      content.appendChild(icon);
      content.appendChild(text);
      body.appendChild(content);

      node.appendChild(header);
      node.appendChild(body);

      node.addEventListener('click', openCard);
      node.addEventListener('keydown', function (event) {
        var key = event.key || event.keyCode;
        if (key === 'Enter' || key === ' ' || key === 13 || key === 32) {
          openCard(event);
        }
      });

      return node;
    }

    /** Подпись статуса рядом с названием карточки. */
    function applyStatus(text) {
      if (!tile) {
        return;
      }
      var status = tile.querySelector('.map-tile__status');
      if (!status) {
        return;
      }
      var value = typeof text === 'string' ? text.trim() : '';
      if (!value) {
        status.textContent = '';
        status.hidden = true;
        status.style.display = 'none';
        return;
      }
      status.textContent = value;
      status.hidden = false;
      status.style.display = '';
    }

    /**
     * startmain.js пересобирает группы плиток на лету. Наблюдатель возвращает
     * карточку на место, если она выпала из разметки при перестроении.
     */
    function watchTiles(grid) {
      if (observer || !grid || typeof MutationObserver !== 'function') {
        return;
      }
      var host = (typeof grid.closest === 'function' ? grid.closest('.su21-interface__tiles') : null)
        || grid.parentNode;
      if (!host) {
        return;
      }
      observer = new MutationObserver(function () {
        if (!allowed || !tile) {
          return;
        }
        if (!document.body.contains(tile)) {
          mount();
        }
      });
      observer.observe(host, { childList: true, subtree: true });
    }

    /** Ставим плитку в раздел «Доступные разделы». */
    function mount() {
      if (mountTimer) {
        clearTimeout(mountTimer);
        mountTimer = null;
      }
      var grid = findActiveGrid();
      if (!grid) {
        // Разметку главной страницы собирает startmain.js — ждём её появления.
        if (mountAttempts < MOUNT_RETRY_LIMIT) {
          mountAttempts += 1;
          mountTimer = setTimeout(mount, MOUNT_RETRY_MS);
        }
        return;
      }
      mountAttempts = 0;
      if (!tile) {
        tile = buildTile();
      }
      if (tile.parentNode !== grid) {
        grid.appendChild(tile);
      }
      watchTiles(grid);
    }

    /** Убираем плитку, если доступ выключили. */
    function unmount() {
      if (mountTimer) {
        clearTimeout(mountTimer);
        mountTimer = null;
      }
      if (tile && tile.parentNode) {
        tile.parentNode.removeChild(tile);
      }
    }

    /** Читаем настройки доступа и показываем либо прячем карточку. */
    function refresh() {
      var page = currentPageName();
      if (!page) {
        allowed = false;
        unmount();
        return;
      }

      readCardAccess(page)
        .then(function (result) {
          allowed = result.allowed;
          if (!allowed) {
            unmount();
            return;
          }
          ensureStyles();
          mount();
          applyStatus(result.status);
        })
        .catch(function () {
          // Настройки недоступны — карточка остаётся выключенной.
          allowed = false;
          unmount();
        });
    }

    refresh();
    if (refreshTimer) {
      clearInterval(refreshTimer);
    }
    refreshTimer = setInterval(refresh, REFRESH_MS);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        refresh();
      }
    });
  }

  /**
   * Адрес приложения из настроек портала (bmsu4.php?config=1 читает
   * PLAN_FACT_APP_URL из .env). Нужен главной странице организации: плитку
   * подключает startmain.js, и передать адрес разметкой там негде.
   * Запрашивается один раз за загрузку страницы.
   */
  function loadConfiguredAppUrl() {
    if (appUrlRequest) {
      return appUrlRequest;
    }
    appUrlRequest = fetch(CONFIG_URL + '?config=1&ts=' + Date.now(), {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Cache-Control': 'no-cache, no-store' }
    })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('bmsu4-config-unavailable');
        }
        return response.json();
      })
      .then(function (data) {
        var url = data && typeof data.appUrl === 'string' ? data.appUrl.trim() : '';
        if (url) {
          window.PLAN_FACT_APP_URL = url;
        }
        return url;
      })
      .catch(function () {
        return '';
      });
    return appUrlRequest;
  }

  /** Настройка «Доступ к карточкам» для страницы организации. */
  function readCardAccess(page) {
    return fetch(ACCESS_URL + '?ts=' + Date.now(), {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Cache-Control': 'no-cache, no-store' }
    })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('bmsu4-access-unavailable');
        }
        return response.json();
      })
      .then(function (data) {
        var blocks = data && Array.isArray(data.blocks) ? data.blocks : [];
        var matched = null;
        for (var i = 0; i < blocks.length; i += 1) {
          if (blocks[i] && blocks[i].page === page) {
            matched = blocks[i];
            break;
          }
        }
        var cards = matched && Array.isArray(matched.cards) ? matched.cards : [];
        var statuses = matched && matched.statuses && typeof matched.statuses === 'object'
          ? matched.statuses
          : {};
        return {
          allowed: cards.indexOf(TILE_ID) !== -1,
          status: typeof statuses[TILE_ID] === 'string' ? statuses[TILE_ID] : ''
        };
      });
  }

  /* ======================================================================
   *  Режим 2. Страница-переход bmsu4.php
   * ==================================================================== */

  function initGateMode() {
    var gate = document.getElementById('bmsu4-gate');
    var denied = document.getElementById('bmsu4-denied');
    var unconfigured = document.getElementById('bmsu4-unconfigured');

    function showOnly(node) {
      if (gate && gate !== node) gate.hidden = true;
      if (denied && denied !== node) denied.hidden = true;
      if (unconfigured && unconfigured !== node) unconfigured.hidden = true;
      if (node) node.hidden = false;
    }

    if (!applicationUrl()) {
      showOnly(unconfigured);
      return;
    }

    // Запуск из Telegram: у пользователя нет ни сессии портала, ни страницы
    // организации — вход проверит само приложение по подписи Init Data.
    if (hasTelegramLaunchData()) {
      openApplication(true);
      return;
    }

    // Адрес набран руками или открыт по прямой ссылке, без страницы
    // организации: проверять карточку не по чему, вход спросит приложение.
    var params = new URLSearchParams(window.location.search || '');
    var page = String(params.get('page') || '').trim();
    if (!page) {
      openApplication(true);
      return;
    }

    // Карточку для страницы организации включает администратор портала.
    // На сервере это уже посчитано, а fetch остаётся запасным путём, если
    // страницу отдал кеш браузера или прокси.
    var serverAnswer = document.body && document.body.dataset
      ? String(document.body.dataset.cardEnabled || '')
      : '';
    if (serverAnswer === '1') {
      openApplication(true);
      return;
    }
    readCardAccess(page)
      .then(function (result) {
        if (result.allowed) {
          openApplication(true);
          return;
        }
        showOnly(denied);
      })
      .catch(function () {
        showOnly(denied);
      });
  }

  /* ======================================================================
   *  Запуск нужного режима
   * ==================================================================== */

  function start() {
    var isGatePage = currentPageName().toLowerCase() === GATE_PAGE;
    var hasGateClass = document.body && document.body.classList.contains('bmsu4-page');
    if (isGatePage || hasGateClass) {
      initGateMode();
      return;
    }
    // Telegram открыл страницу организации напрямую: параметры запуска
    // остаются в адресе, и приложение должно получить их без лишнего клика.
    if (hasTelegramLaunchData() && applicationUrl()) {
      document.body.style.display = 'none';
      openApplication(true);
      return;
    }
    initTileMode();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
