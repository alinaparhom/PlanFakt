/*
 * bmsu4.js — раздел «План/факт» заказчика.
 *
 * Один файл работает в двух режимах и сам определяет нужный:
 *
 * 1. Главная страница организации есть (su-21.php и подобные).
 *    Модуль подключается из js/startmain/startmain.js и рисует плитку
 *    «План/факт» в секции «Доступные разделы».
 *    Плитка появляется ТОЛЬКО если администратор включил карточку
 *    «План/факт» в разделе «Доступ к карточкам» (service.php →
 *    lg/dostupcard.json) для текущей страницы организации. По умолчанию
 *    карточка выключена и на главной не отображается совсем — ни рабочей
 *    плиткой, ни закрытой «под замочком». Так раздел остаётся личным для
 *    организации заказчика.
 *
 * 2. Страница карточки bmsu4.php (body.bmsu4-page).
 *    Модуль оживляет шапку (назад, обновить) и даёт точку расширения
 *    window.BMSU4.registerBlock() — через неё в раздел добавляется любой
 *    новый код отдельными блоками, без правок каркаса страницы.
 *
 * Настройки доступа читаются всегда свежими: cache: 'no-store', заголовок
 * Cache-Control и метка времени в адресе запроса.
 */
(function () {
  'use strict';

  var TILE_ID = 'bmsu4-tile';                 // идентификатор карточки в «Доступе к карточкам»
  var TILE_TITLE = 'План/факт';
  var TILE_TEXT = 'Плановые и фактические показатели организации';
  var TARGET_PAGE = 'bmsu4.php';              // страница, которую открывает карточка
  var ACCESS_URL = 'lg/dostupcard.json';      // настройки доступа к карточкам
  var STYLE_ID = 'bmsu4-style';
  var REFRESH_MS = 60000;                     // период проверки доступа, как в startmain.js
  var MOUNT_RETRY_MS = 400;                   // пауза между попытками найти сетку плиток
  var MOUNT_RETRY_LIMIT = 30;                 // ~12 секунд ожидания разметки главной страницы

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

    /** Переход на страницу карточки с сохранением контекста организации. */
    function openCard(event) {
      if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
      }
      var params = 'page=' + encodeURIComponent(currentPageName());
      var organization = currentOrganization();
      if (organization) {
        params += '&org=' + encodeURIComponent(organization);
      }
      // Метка времени — страница карточки всегда открывается свежей, без кеша.
      params += '&ts=' + Date.now();
      window.location.assign(TARGET_PAGE + '?' + params);
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

      fetch(ACCESS_URL + '?ts=' + Date.now(), {
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
          allowed = cards.indexOf(TILE_ID) !== -1;
          if (!allowed) {
            unmount();
            return;
          }
          ensureStyles();
          mount();
          var statuses = matched && matched.statuses && typeof matched.statuses === 'object'
            ? matched.statuses
            : {};
          applyStatus(typeof statuses[TILE_ID] === 'string' ? statuses[TILE_ID] : '');
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

  /* ======================================================================
   *  Режим 2. Страница раздела bmsu4.php
   * ==================================================================== */

  function initPageMode() {
    var body = document.body;
    var blocksHost = document.getElementById('bmsu4-blocks');
    var emptyNode = document.getElementById('bmsu4-empty');
    var toastNode = document.getElementById('bmsu4-toast');
    var backButton = document.getElementById('bmsu4-back');
    var reloadButton = document.getElementById('bmsu4-reload');
    var toastTimer = null;
    var blocks = {};

    var context = {
      page: String(body.dataset.page || ''),
      org: String(body.dataset.org || ''),
      returnUrl: String(body.dataset.return || 'index.html'),
      title: String(body.dataset.title || TILE_TITLE)
    };

    /** Адрес текущей страницы со свежей меткой времени — открывается без кеша. */
    function freshUrl() {
      var params = [];
      if (context.page) {
        params.push('page=' + encodeURIComponent(context.page));
      }
      if (context.org) {
        params.push('org=' + encodeURIComponent(context.org));
      }
      params.push('ts=' + Date.now());
      return TARGET_PAGE + '?' + params.join('&');
    }

    /** Короткое сообщение внизу экрана. */
    function toast(message) {
      var text = typeof message === 'string' ? message.trim() : '';
      if (!toastNode || !text) {
        return;
      }
      toastNode.textContent = text;
      toastNode.classList.add('is-visible');
      if (toastTimer) {
        clearTimeout(toastTimer);
      }
      toastTimer = setTimeout(function () {
        toastNode.classList.remove('is-visible');
      }, 3000);
    }

    /** Показываем заглушку «пока пусто», пока в разделе нет ни одного блока. */
    function updateEmptyState() {
      if (!emptyNode) {
        return;
      }
      var hasBlocks = Object.keys(blocks).length > 0;
      emptyNode.classList.toggle('is-hidden', hasBlocks);
    }

    /**
     * Добавляет блок в раздел.
     * block = { id, title, subtitle, icon (SVG-разметка), render(container) }
     * Повторная регистрация с тем же id заменяет прежний блок.
     */
    function registerBlock(block) {
      if (!blocksHost || !block || typeof block !== 'object') {
        return null;
      }
      var id = String(block.id || '').trim();
      if (!id) {
        return null;
      }

      removeBlock(id);

      var panel = document.createElement('section');
      panel.className = 'bmsu4-panel';
      panel.dataset.blockId = id;

      var title = String(block.title || '').trim();
      var subtitle = String(block.subtitle || '').trim();
      if (title || subtitle || block.icon) {
        var head = document.createElement('div');
        head.className = 'bmsu4-panel__head';

        if (block.icon) {
          var icon = document.createElement('span');
          icon.className = 'bmsu4-panel__icon';
          icon.setAttribute('aria-hidden', 'true');
          icon.innerHTML = String(block.icon);
          head.appendChild(icon);
        }

        var titles = document.createElement('div');
        titles.className = 'bmsu4-panel__titles';
        if (title) {
          var titleNode = document.createElement('h2');
          titleNode.className = 'bmsu4-panel__title';
          titleNode.textContent = title;
          titles.appendChild(titleNode);
        }
        if (subtitle) {
          var subtitleNode = document.createElement('p');
          subtitleNode.className = 'bmsu4-panel__subtitle';
          subtitleNode.textContent = subtitle;
          titles.appendChild(subtitleNode);
        }
        head.appendChild(titles);
        panel.appendChild(head);
      }

      var content = document.createElement('div');
      content.className = 'bmsu4-panel__body';
      panel.appendChild(content);

      blocksHost.appendChild(panel);
      blocks[id] = panel;
      updateEmptyState();

      if (typeof block.render === 'function') {
        try {
          block.render(content, context);
        } catch (error) {
          content.textContent = 'Блок не удалось построить.';
        }
      }

      return content;
    }

    /** Убирает блок раздела по идентификатору. */
    function removeBlock(id) {
      var key = String(id || '').trim();
      var panel = blocks[key];
      if (!panel) {
        return false;
      }
      if (panel.parentNode) {
        panel.parentNode.removeChild(panel);
      }
      delete blocks[key];
      updateEmptyState();
      return true;
    }

    if (backButton) {
      backButton.addEventListener('click', function () {
        window.location.assign(context.returnUrl || 'index.html');
      });
    }

    if (reloadButton) {
      reloadButton.addEventListener('click', function () {
        window.location.replace(freshUrl());
      });
    }

    updateEmptyState();

    // Точка расширения: новый код раздела добавляется отдельными блоками.
    window.BMSU4 = {
      context: context,
      registerBlock: registerBlock,
      removeBlock: removeBlock,
      toast: toast,
      reload: function () {
        window.location.replace(freshUrl());
      }
    };

    document.dispatchEvent(new CustomEvent('bmsu4:ready', { detail: context }));
  }

  /* ======================================================================
   *  Запуск нужного режима
   * ==================================================================== */

  function start() {
    if (document.body && document.body.classList.contains('bmsu4-page')) {
      initPageMode();
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
