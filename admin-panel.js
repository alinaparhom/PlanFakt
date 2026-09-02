(function () {
  'use strict';

  var STORAGE_KEY = 'planFaktAdminData';
  var initial = { objects: [{ name: 'DEPO', address: 'Минск', status: 'Активный' }], users: [{ name: 'Пархоменко', login: 'Пархоменко', role: 'Администратор' }] };

  function read() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || initial; } catch (error) { return initial; }
  }

  function write(data) { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }

  function render(kind) {
    var users = kind === 'usersAdmin';
    var data = read();
    var items = users ? data.users : data.objects;
    var root = document.getElementById('genericPage');
    root.innerHTML = '<div class="admin-head glass"><div><span>Панель администратора</span><h2>' + (users ? 'Пользователи' : 'Объекты') + '</h2><p>' + (users ? 'Добавляйте сотрудников и назначайте им роли.' : 'Создавайте и настраивайте строительные объекты.') + '</p></div><button class="primary" id="adminAdd">＋ Добавить</button></div><div class="admin-grid" id="adminGrid"></div>';
    var grid = document.getElementById('adminGrid');
    grid.innerHTML = items.map(function (item) {
      return '<article class="admin-item glass"><span class="admin-avatar">' + item.name.charAt(0) + '</span><div><b>' + item.name + '</b><small>' + (users ? item.role + ' · ' + item.login : item.address) + '</small></div><em>' + (item.status || 'Активен') + '</em></article>';
    }).join('') || '<div class="admin-empty glass">Пока ничего нет. Нажмите «Добавить».</div>';
    document.getElementById('adminAdd').onclick = function () { showForm(kind); };
  }

  function showForm(kind) {
    var users = kind === 'usersAdmin';
    var root = document.getElementById('genericPage');
    root.insertAdjacentHTML('beforeend', '<div class="admin-dialog" id="adminDialog"><button class="admin-dialog__backdrop" aria-label="Закрыть"></button><form class="admin-form glass"><button type="button" class="admin-form__close" aria-label="Закрыть">×</button><span>Новая запись</span><h3>' + (users ? 'Добавить пользователя' : 'Добавить объект') + '</h3><label>Название / имя<input name="name" required placeholder="' + (users ? 'Иван Иванов' : 'Название объекта') + '"></label><label>' + (users ? 'Логин' : 'Адрес') + '<input name="detail" required placeholder="Введите данные"></label>' + (users ? '<label>Роль<select name="role"><option>Руководитель</option><option>Заказчик</option><option>Подрядчик</option><option>Наблюдатель</option></select></label>' : '') + '<button class="primary" type="submit">Сохранить</button></form></div>');
    var dialog = document.getElementById('adminDialog');
    function close() { dialog.remove(); }
    dialog.querySelector('.admin-dialog__backdrop').onclick = close;
    dialog.querySelector('.admin-form__close').onclick = close;
    dialog.querySelector('input').focus();
    dialog.querySelector('form').onsubmit = function (event) {
      event.preventDefault();
      var values = new FormData(event.currentTarget);
      var data = read();
      if (users) data.users.push({ name: values.get('name'), login: values.get('detail'), role: values.get('role') });
      else data.objects.push({ name: values.get('name'), address: values.get('detail'), status: 'Активный' });
      write(data); render(kind);
    };
  }

  window.PlanFaktAdmin = { render: render };
})();
