(function () {
  'use strict';

  var roles = {
    manager: { name: 'Руководитель', hint: 'Полный контроль проекта', icon: 'Р', pages: ['dashboard', 'plan', 'contractors', 'reports', 'resources', 'photos', 'milestones', 'schedules', 'archive'], actions: ['createReport'] },
    customer: { name: 'Заказчик', hint: 'Контроль сроков и результата', icon: 'З', pages: ['dashboard', 'plan', 'contractors', 'reports', 'photos', 'milestones', 'schedules'], actions: [] },
    contractor: { name: 'Подрядчик', hint: 'Работы, ресурсы и отчёты', icon: 'П', pages: ['dashboard', 'plan', 'reports', 'resources', 'photos'], actions: ['createReport'] },
    observer: { name: 'Наблюдатель', hint: 'Просмотр отчётов и фото', icon: 'Н', pages: ['dashboard', 'reports', 'photos'], actions: [] }
  };
  var currentRole = localStorage.getItem('planFaktRole');
  if (!roles[currentRole]) currentRole = 'manager';
  var sheet = document.getElementById('roleSheet');
  var toast = document.getElementById('accessToast');
  var toastTimer;

  function can(permission) {
    var authenticatedUser = window.PlanFaktAuth && window.PlanFaktAuth.getUser();
    if (authenticatedUser && authenticatedUser.role === 'Администратор') return true;
    var role = roles[currentRole];
    return role.pages.indexOf(permission) !== -1 || role.actions.indexOf(permission) !== -1;
  }

  function deny() {
    clearTimeout(toastTimer);
    toast.classList.add('is-visible');
    toastTimer = setTimeout(function () { toast.classList.remove('is-visible'); }, 2800);
  }

  function render() {
    var role = roles[currentRole];
    document.getElementById('profileRole').textContent = role.name;
    document.querySelectorAll('#navigation a').forEach(function (link) {
      var allowed = can(link.dataset.page);
      link.classList.toggle('is-locked', !allowed);
      link.setAttribute('aria-disabled', String(!allowed));
      link.title = allowed ? '' : 'У вас нет доступа';
    });
    document.getElementById('reportButton').classList.toggle('is-restricted', !can('createReport'));
    document.getElementById('roleList').innerHTML = Object.keys(roles).map(function (key) {
      var item = roles[key];
      return '<button class="role-option' + (key === currentRole ? ' is-active' : '') + '" data-role="' + key + '"><span>' + item.icon + '</span><div><b>' + item.name + '</b><small>' + item.hint + '</small></div><i>' + (key === currentRole ? '✓' : '→') + '</i></button>';
    }).join('');
  }

  function closeSheet() {
    sheet.classList.remove('is-open');
    sheet.setAttribute('aria-hidden', 'true');
    document.getElementById('roleButton').setAttribute('aria-expanded', 'false');
  }

  document.getElementById('roleButton').addEventListener('click', function () {
    sheet.classList.add('is-open');
    sheet.setAttribute('aria-hidden', 'false');
    this.setAttribute('aria-expanded', 'true');
  });
  sheet.querySelectorAll('[data-role-close]').forEach(function (button) { button.addEventListener('click', closeSheet); });
  document.getElementById('roleList').addEventListener('click', function (event) {
    var button = event.target.closest('[data-role]');
    if (!button) return;
    currentRole = button.dataset.role;
    localStorage.setItem('planFaktRole', currentRole);
    render();
    closeSheet();
    var activePage = document.querySelector('#navigation a.active');
    if (activePage && !can(activePage.dataset.page)) document.querySelector('[data-page="dashboard"]').click();
  });
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape') closeSheet(); });

  render();
  window.PlanFaktRoles = { can: can, deny: deny, roles: roles, refresh: render };
})();
