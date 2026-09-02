(function(){
  'use strict';
  var modal=document.getElementById('reportModal');
  var sidebar=document.querySelector('.sidebar');
  var titles={plan:'План / Факт',contractors:'Подрядчики',reports:'Ежедневные отчёты',resources:'Люди и техника',photos:'Фотографии',milestones:'Контрольные вехи',schedules:'Производственные графики',archive:'Архив графиков'};
  function closeModal(){modal.classList.remove('open');modal.setAttribute('aria-hidden','true')}
  document.getElementById('reportButton').addEventListener('click',function(){modal.classList.add('open');modal.setAttribute('aria-hidden','false')});
  modal.querySelectorAll('[data-close]').forEach(function(el){el.addEventListener('click',closeModal)});
  document.addEventListener('keydown',function(e){if(e.key==='Escape')closeModal()});
  document.getElementById('menuButton').addEventListener('click',function(){sidebar.classList.toggle('open')});
  document.querySelectorAll('.period button').forEach(function(button){button.addEventListener('click',function(){document.querySelectorAll('.period button').forEach(function(x){x.classList.remove('active')});button.classList.add('active')})});
  document.querySelectorAll('#navigation a').forEach(function(link){link.addEventListener('click',function(){var page=link.dataset.page;var pageTitle=document.getElementById('pageTitle');document.querySelectorAll('#navigation a').forEach(function(x){x.classList.remove('active')});link.classList.add('active');if(page==='dashboard'){document.getElementById('dashboard').classList.add('active-page');document.getElementById('genericPage').classList.remove('active-page');pageTitle.textContent=pageTitle.dataset.dashboardTitle||'Добрый день, Андрей!'}else{document.getElementById('dashboard').classList.remove('active-page');document.getElementById('genericPage').classList.add('active-page');window.PlanFaktViews.render(page);pageTitle.textContent=titles[page]}sidebar.classList.remove('open')})});
  document.querySelectorAll('[data-open-plan]').forEach(function(button){button.addEventListener('click',function(){document.querySelector('[data-page="dashboard"]').click()})});
  document.getElementById('nextStep').addEventListener('click',function(){this.textContent='Сохранено ✓';this.style.background='#20b582';setTimeout(closeModal,700)});
})();
