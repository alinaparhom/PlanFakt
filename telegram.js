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

  var user = telegram.initDataUnsafe && telegram.initDataUnsafe.user;
  if (user && user.first_name) {
    var pageTitle = document.getElementById('pageTitle');
    var profileName = document.querySelector('.profile b');
    var profileAvatar = document.querySelector('.profile > span');
    pageTitle.dataset.dashboardTitle = 'Добрый день, ' + user.first_name + '!';
    pageTitle.textContent = pageTitle.dataset.dashboardTitle;
    if (profileName) profileName.textContent = [user.first_name, user.last_name].filter(Boolean).join(' ');
    if (profileAvatar) profileAvatar.textContent = (user.first_name.charAt(0) + (user.last_name || '').charAt(0)).toUpperCase();
  }

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
