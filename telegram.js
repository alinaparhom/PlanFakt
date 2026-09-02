(function () {
  'use strict';

  var telegram = window.Telegram && window.Telegram.WebApp;

  // В обычном браузере приложение продолжает работать без Telegram SDK.
  if (!telegram || !telegram.initData) {
    return;
  }

  document.documentElement.classList.add('is-telegram');
  telegram.ready();
  telegram.expand();

  if (typeof telegram.setHeaderColor === 'function') {
    telegram.setHeaderColor('#f4f7fb');
  }
  if (typeof telegram.setBackgroundColor === 'function') {
    telegram.setBackgroundColor('#f4f7fb');
  }

  var openButton = telegram.MainButton || telegram.BottomButton;
  if (!openButton) {
    return;
  }

  function openApplication() {
    var dashboardLink = document.querySelector('[data-page="dashboard"]');
    if (dashboardLink) {
      dashboardLink.click();
    }

    if (typeof telegram.requestFullscreen === 'function') {
      telegram.requestFullscreen();
    }
  }

  openButton.setParams({
    text: 'Открыть приложение',
    color: '#665cf4',
    text_color: '#ffffff',
    is_active: true,
    is_visible: true
  });
  openButton.onClick(openApplication);
  openButton.show();
})();
