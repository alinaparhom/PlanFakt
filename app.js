(function(){
  'use strict';
  const contractors=[
    {name:'ООО «Альфа»',letter:'А',className:'alpha',plan:1000,fact:920,delta:-80},
    {name:'ООО «БетонСтрой»',letter:'Б',className:'beta',plan:800,fact:640,delta:-160},
    {name:'СМУ «Гамма»',letter:'Г',className:'gamma',plan:600,fact:650,delta:50}
  ];
  const issues=[['01','Армирование плиты П1','ООО «БетонСтрой»','−120 м³','76%'],['02','Монтаж газопровода Ø400','ООО «Альфа»','−85 м','81%'],['03','Устройство колонн К2','СМУ «Гамма»','−42 м³','88%']];
  const qs=(s,p=document)=>p.querySelector(s); const qsa=(s,p=document)=>[...p.querySelectorAll(s)];
  const format=n=>new Intl.NumberFormat('ru-RU').format(n);
  function renderDashboard(){
    qs('#contractorRows').innerHTML=contractors.map(c=>{const percent=Math.round(c.fact/c.plan*100);return `<tr><td><div class="company-cell"><span class="company-logo ${c.className}">${c.letter}</span>${c.name}</div></td><td>${format(c.plan)} м³</td><td><b>${format(c.fact)} м³</b></td><td><div class="percent-cell"><span>${percent}%</span><span class="mini-progress ${percent<85?'warn':''}"><i style="width:${Math.min(percent,100)}%"></i></span></div></td><td class="${c.delta<0?'negative-cell':'positive'}">${c.delta>0?'+':''}${c.delta} м³</td><td>›</td></tr>`}).join('');
    qs('#issueList').innerHTML=issues.map(i=>`<div class="issue"><span class="issue-number">${i[0]}</span><p><strong>${i[1]}</strong><small>${i[2]}</small></p><span><b>${i[3]}</b><em>${i[4]} плана</em></span></div>`).join('');
  }
  function renderPages(){
    qs('#analyticsContent').innerHTML=`<div class="analytics-toolbar"><div class="segmented"><button class="active">Сегодня</button><button>3 дня</button><button>7 дней</button><button>Месяц</button></div><button class="secondary">⚙ Только отставания</button></div><article class="panel analytics-table"><div class="panel-head"><div><h2>Выполнение по работам</h2><p>Отсортировано по отклонению</p></div><button class="filter-button">Все подрядчики⌄</button></div><div class="table-wrap"><table><thead><tr><th>Работа</th><th>Подрядчик</th><th>План</th><th>Факт</th><th>Результат</th></tr></thead><tbody>${issues.map((i,n)=>`<tr><td><b>${i[1]}</b></td><td>${i[2]}</td><td>${[500,420,350][n]}</td><td>${[380,335,308][n]}</td><td><span class="badge red">${i[3]}</span></td></tr>`).join('')}<tr><td><b>Монтаж металлоконструкций</b></td><td>СМУ «Гамма»</td><td>300</td><td>330</td><td><span class="badge green">+30 м³</span></td></tr></tbody></table></div></article>`;
    qs('#contractorCards').innerHTML=contractors.map(c=>`<article class="content-card"><span class="company-logo ${c.className}">${c.letter}</span><h3>${c.name}</h3><p>Работ на объекте: ${Math.floor(c.plan/100)}</p><div class="big">${Math.round(c.fact/c.plan*100)}%</div><div class="progress"><i style="width:${Math.min(100,c.fact/c.plan*100)}%"></i></div></article>`).join('');
    qs('#reportsContent').innerHTML=['Сегодня, 2 сентября','1 сентября','31 августа'].map((d,n)=>`<div class="report-day"><span class="date-box">${n===0?'02':'0'+(1-n)}</span><p><b>${d}</b><small>${13-n} подрядчиков · ${128-n*7} человек · ${24+n} единиц техники</small></p><span class="status success">${n===0?'10 из 13':'Завершён'}</span><button class="secondary">Открыть</button></div>`).join('');
    const bars=()=>`<div class="bar-chart">${[55,58,61,57,66,72,68].map((v,i)=>`<div class="bar-group"><i style="height:${v*.7}%"></i><i style="height:${v}%"></i><span>${i+1} сен</span></div>`).join('')}</div>`;
    qs('#resourcesContent').innerHTML=`<div class="resource-grid"><article class="panel"><div class="panel-head"><div><h2>Люди на объекте</h2><p>Всего по всем подрядчикам</p></div><b>128</b></div>${bars()}</article><article class="panel"><div class="panel-head"><div><h2>Техника</h2><p>Активные единицы по дням</p></div><b>24</b></div>${bars()}</article></div>`;
    qs('#photoGrid').innerHTML=['Монолитные стены','Газопровод Ø400','Армирование плиты','Монтаж колонн'].map((x,i)=>`<article class="photo-card"><div><span><b>${x}</b><br><small>${contractors[i%3].name}</small></span><small>02.09</small></div></article>`).join('');
    qs('#milestoneCards').innerHTML=[['10 сентября','83,3%','−250 м³'],['20 сентября','—','Ожидается'],['30 сентября','—','Финальная']].map((m,i)=>`<article class="content-card"><span class="badge ${i?'green':'red'}">${i?'Предстоящая':'Активная'}</span><h3>Срез на ${m[0]}</h3><p>Накопительное выполнение по объекту</p><div class="big">${m[1]}</div><small class="${i?'':'negative-cell'}">${m[2]}</small></article>`).join('');
    qs('#schedulesContent').innerHTML=[['График_производства_DEPO.xlsx','Сентябрь 2026 · Версия 2','Активный'],['График_производства_DEPO_v1.xlsx','Сентябрь 2026 · Версия 1','История']].map((f,i)=>`<div class="file-row"><span class="file-icon">XLS</span><p><b>${f[0]}</b><small>${f[1]} · 328 работ · загружен Алексеем Котовым</small></p><span class="badge ${i?'':'green'}">${f[2]}</span><button class="secondary">Скачать</button></div>`).join('');
    qs('#archiveCards').innerHTML=['Август','Июль','Июнь'].map((m,i)=>`<article class="content-card"><span class="badge green">Завершён</span><h3>${m} 2026</h3><p>${312-i*8} работ · 15 подрядчиков</p><div class="big">${[94,89,97][i]}%</div><button class="secondary full">Открыть архив →</button></article>`).join('');
    qs('#usersContent').innerHTML=['Алексей Котов|Руководитель|DEPO, Динамо','Иван Иванов|Ответственный · ООО «Альфа»|DEPO','Мария Орлова|Администратор|Все объекты'].map((u,i)=>{const a=u.split('|');return `<div class="user-row"><span class="avatar">${a[0].split(' ').map(x=>x[0]).join('')}</span><p><b>${a[0]}</b><small>${a[1]}</small></p><span class="badge green">${a[2]}</span><button class="secondary">Настроить</button></div>`}).join('');
    qs('#settingsContent').innerHTML=[['Пороговые значения','Зелёный ≥ 100% · Жёлтый ≥ 85%'],['Справочники','Профессии, техника, единицы измерения'],['Журнал действий','Все критические операции пользователей']].map(x=>`<article class="content-card"><span class="file-icon">⚙</span><h3>${x[0]}</h3><p>${x[1]}</p><button class="secondary full">Настроить →</button></article>`).join('');
  }
  function navigate(id){id=id||'dashboard';qsa('.page').forEach(x=>x.classList.toggle('active',x.id===id));qsa('[data-page]').forEach(x=>x.classList.toggle('active',x.dataset.page===id));qs('#sidebar').classList.remove('open');window.scrollTo(0,0)}
  function toast(title,text){const t=qs('#toast');qs('b',t).textContent=title;qs('small',t).textContent=text;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600)}
  renderDashboard();renderPages();navigate(location.hash.slice(1));
  addEventListener('hashchange',()=>navigate(location.hash.slice(1)));
  qs('#menuToggle').onclick=()=>qs('#sidebar').classList.toggle('open');
  qs('#projectSwitch').onclick=e=>{e.stopPropagation();const p=qs('#projectPopover');p.hidden=!p.hidden};
  qsa('[data-project]').forEach(b=>b.onclick=()=>{qsa('[data-project]').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');qs('#projectName').textContent=b.dataset.project;qs('#projectPopover').hidden=true;toast('Объект изменён',`Открыт ${b.dataset.project}`)});
  document.addEventListener('click',e=>{if(!e.target.closest('.project-popover')&&!e.target.closest('#projectSwitch'))qs('#projectPopover').hidden=true});
  qsa('[data-open-report]').concat([qs('#newReportButton')]).forEach(b=>b&&b.addEventListener('click',()=>qs('#reportModal').showModal()));
  qs('#reportForm').addEventListener('submit',e=>{if(e.submitter&&e.submitter.value==='next'){e.preventDefault();qs('#reportModal').close();toast('Черновик сохранён','Можно продолжить заполнение позже')}});
  qsa('.segmented button').forEach(b=>b.onclick=()=>{qsa('.segmented button').forEach(x=>x.classList.remove('active'));b.classList.add('active')});
  qs('#uploadSchedule').onclick=()=>toast('Импорт Excel','Выберите файл .xlsx для предварительной проверки');
  qs('#notificationsButton').onclick=()=>toast('Уведомления','3 подрядчика ещё не отправили отчёт');
  let date=2; qs('#prevDate').onclick=()=>{date=Math.max(1,date-1);qs('#displayDate').textContent=`${date} сентября`};qs('#nextDate').onclick=()=>{date=Math.min(30,date+1);qs('#displayDate').textContent=`${date} сентября`};
  addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();qs('#globalSearch').focus()}if(e.key==='Escape')qs('#sidebar').classList.remove('open')});
})();
