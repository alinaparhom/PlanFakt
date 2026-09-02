(function () {
  'use strict';

  var modal = document.getElementById('authModal');
  var form = document.getElementById('authForm');
  var error = document.getElementById('authError');
  var password = document.getElementById('authPassword');
  var submit = form.querySelector('.auth-submit');
  var user = null;
  var afterLogin = null;

  function updateProfile() {
    if (!user) return;
    document.querySelector('.profile > span').textContent = 'П';
    document.querySelector('.profile b').textContent = user.name;
    document.getElementById('profileRole').textContent = user.role;
    document.getElementById('pageTitle').dataset.dashboardTitle = 'Добрый день, ' + user.name + '!';
    document.querySelectorAll('.admin-navigation').forEach(function (item) { item.hidden = user.role !== 'Администратор'; });
  }

  function open(callback) {
    afterLogin = callback || null;
    error.textContent = '';
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(function () { document.getElementById('authLogin').focus(); }, 80);
  }

  function close() {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
  }

  function requireLogin(callback) {
    if (user) callback(); else open(callback);
  }

  fetch('/api/auth/session').then(function (response) { return response.json(); }).then(function (data) {
    user = data.authenticated ? data.user : null;
    updateProfile();
  }).catch(function () {});

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    error.textContent = '';
    submit.disabled = true;
    submit.innerHTML = 'Проверяем…';
    fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: form.login.value, password: form.password.value }) })
      .then(function (response) { return response.json().then(function (data) { if (!response.ok) throw new Error(data.error); return data; }); })
      .then(function (data) {
        user = data.user;
        updateProfile();
        close();
        form.reset();
        if (afterLogin) afterLogin();
        afterLogin = null;
      })
      .catch(function (requestError) { error.textContent = requestError.message || 'Не удалось войти. Попробуйте ещё раз.'; })
      .finally(function () { submit.disabled = false; submit.innerHTML = 'Войти <span>→</span>'; });
  });

  document.getElementById('passwordToggle').addEventListener('click', function () {
    password.type = password.type === 'password' ? 'text' : 'password';
    this.setAttribute('aria-label', password.type === 'password' ? 'Показать пароль' : 'Скрыть пароль');
  });
  modal.querySelectorAll('[data-auth-close]').forEach(function (button) { button.addEventListener('click', close); });
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape') close(); });

  window.PlanFaktAuth = { requireLogin: requireLogin, isAuthenticated: function () { return Boolean(user); } };
})();
