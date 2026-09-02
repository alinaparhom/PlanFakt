(function () {
  'use strict';

  var telegram = window.Telegram && window.Telegram.WebApp;
  if (!telegram) return;

  telegram.ready();
  telegram.expand();
})();
