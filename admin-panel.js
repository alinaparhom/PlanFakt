(function () {
  'use strict';
  function request(url, options) { return fetch(url, options).then(function (response) { return response.json().then(function (body) { if (!response.ok) throw new Error(body.error || 'Ошибка запроса'); return body; }); }); }
  function escapeHtml(value) { var element = document.createElement('span'); element.textContent = value; return element.innerHTML; }
  function render(kind) {
    var users = kind === 'usersAdmin'; var root = document.getElementById('genericPage');
    root.innerHTML = '<div class="admin-head glass"><div><span>Панель администратора</span><h2>' + (users ? 'Пользователи' : 'Объекты') + '</h2><p>' + (users ? 'Добавляйте сотрудников и назначайте им роли.' : 'Создавайте и настраивайте строительные объекты.') + '</p></div><button class="primary" id="adminAdd">＋ Добавить</button></div><div class="admin-grid" id="adminGrid"><div class="admin-empty glass">Загружаем…</div></div>';
    request('/api/admin/data').then(function (data) {
      var items = users ? data.users : data.objects;
      document.getElementById('adminGrid').innerHTML = items.map(function (item) { return '<article class="admin-item glass"><span class="admin-avatar">' + escapeHtml(item.name.charAt(0)) + '</span><div><b>' + escapeHtml(item.name) + '</b><small>' + escapeHtml(users ? item.role + ' · ' + item.login : item.address) + '</small></div><em>' + escapeHtml(item.status || 'Активен') + '</em></article>'; }).join('') || '<div class="admin-empty glass">Пока ничего нет. Нажмите «Добавить».</div>';
    }).catch(function (error) { document.getElementById('adminGrid').innerHTML = '<div class="admin-empty glass">' + escapeHtml(error.message) + '</div>'; });
    document.getElementById('adminAdd').onclick = function () { showForm(kind); };
  }
  function showForm(kind) {
    var users = kind === 'usersAdmin'; var root = document.getElementById('genericPage');
    root.insertAdjacentHTML('beforeend', '<div class="admin-dialog" id="adminDialog"><button class="admin-dialog__backdrop" aria-label="Закрыть"></button><form class="admin-form glass"><button type="button" class="admin-form__close" aria-label="Закрыть">×</button><span>Новая запись</span><h3>' + (users ? 'Добавить пользователя' : 'Добавить объект') + '</h3><label>' + (users ? 'Имя' : 'Название') + '<input name="name" required placeholder="' + (users ? 'Иван Иванов' : 'Название объекта') + '"></label><label>' + (users ? 'Логин' : 'Адрес') + '<input name="detail" required placeholder="Введите данные"></label>' + (users ? '<label>Пароль<input name="password" type="password" autocomplete="new-password" required minlength="3" placeholder="Не менее 3 символов"></label><label>Роль<select name="role"><option>Руководитель</option><option>Заказчик</option><option>Подрядчик</option><option>Наблюдатель</option><option>Администратор</option></select></label>' : '') + '<div class="admin-form__error" role="alert"></div><button class="primary" type="submit">Сохранить</button></form></div>');
    var dialog = document.getElementById('adminDialog'); function close() { dialog.remove(); }
    dialog.querySelector('.admin-dialog__backdrop').onclick = close; dialog.querySelector('.admin-form__close').onclick = close; dialog.querySelector('input').focus();
    dialog.querySelector('form').onsubmit = function (event) {
      event.preventDefault(); var form = event.currentTarget; var button = form.querySelector('[type="submit"]'); var values = new FormData(form); button.disabled = true; form.querySelector('.admin-form__error').textContent = '';
      request('/api/admin/' + (users ? 'users' : 'objects'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: values.get('name'), detail: values.get('detail'), password: values.get('password'), role: values.get('role') }) }).then(function () { close(); render(kind); }).catch(function (error) { form.querySelector('.admin-form__error').textContent = error.message; button.disabled = false; });
    };
  }
  window.PlanFaktAdmin = { render: render };
})();
