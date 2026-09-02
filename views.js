(function () {
  'use strict';

  var pages = {
    plan: { title: 'План / Факт', eyebrow: 'Производственный контроль', icon: 'chart', description: 'Сравнивайте объём запланированных и выполненных работ.', action: 'Добавить работу', stats: [['86%', 'Выполнение плана'], ['−170 ед.', 'Текущее отклонение'], ['12', 'Активных работ']], list: ['Монтаж газопровода Ø400', 'Устройство монолитных стен', 'Армирование плиты'] },
    contractors: { title: 'Подрядчики', eyebrow: 'Команда объекта', icon: 'users', description: 'Контролируйте отчётность и загрузку подрядных организаций.', action: 'Добавить подрядчика', stats: [['8', 'Всего компаний'], ['6', 'Сдали отчёт'], ['148', 'Людей на объекте']], list: ['ООО «Альфа»', 'ООО «Бета»', 'СМУ «Гамма»'] },
    reports: { title: 'Ежедневные отчёты', eyebrow: 'Документы', icon: 'document', description: 'Все сменные отчёты собраны в одном понятном журнале.', action: 'Новый отчёт', stats: [['24', 'За сентябрь'], ['6', 'Получено сегодня'], ['2', 'Ожидают проверки']], list: ['Отчёт №024 · 2 сентября', 'Отчёт №023 · 1 сентября', 'Отчёт №022 · 31 августа'] },
    resources: { title: 'Люди и техника', eyebrow: 'Ресурсы', icon: 'helmet', description: 'Следите за численностью команд и техникой на площадке.', action: 'Добавить ресурс', stats: [['148', 'Специалистов'], ['27', 'Единиц техники'], ['91%', 'Средняя загрузка']], list: ['Монтажная бригада', 'Башенные краны', 'Земляная техника'] },
    photos: { title: 'Фотографии', eyebrow: 'Ход строительства', icon: 'image', description: 'Визуальная история объекта с привязкой к работам и датам.', action: 'Загрузить фото', stats: [['284', 'Всего фотографий'], ['18', 'Добавлено сегодня'], ['7', 'Участков']], list: ['Северный участок', 'Главный корпус', 'Инженерные сети'] },
    milestones: { title: 'Контрольные вехи', eyebrow: 'Календарный план', icon: 'flag', description: 'Ключевые события проекта и контроль сроков исполнения.', action: 'Добавить веху', stats: [['18', 'Всего вех'], ['11', 'Выполнено'], ['2', 'Под риском']], list: ['Завершение нулевого цикла', 'Закрытие теплового контура', 'Пусконаладочные работы'] },
    schedules: { title: 'Производственные графики', eyebrow: 'Планирование', icon: 'calendar', description: 'Актуальные графики производства работ по всем участкам.', action: 'Создать график', stats: [['5', 'Активных графиков'], ['42', 'Работы в плане'], ['3', 'Новых версии']], list: ['Генеральный график', 'График инженерных сетей', 'План отделочных работ'] },
    archive: { title: 'Архив графиков', eyebrow: 'История данных', icon: 'archiveIcon', description: 'Сохранённые версии планов и документов доступны в любое время.', action: 'Загрузить документ', stats: [['36', 'Версий'], ['8', 'Документов'], ['2.4 ГБ', 'Объём архива']], list: ['Август 2026', 'Июль 2026', 'II квартал 2026'] }
  };

  function render(pageName) {
    var page = pages[pageName] || pages.plan;
    var root = document.getElementById('genericPage');
    root.innerHTML = '<div class="workspace-hero glass"><div><span class="workspace-eyebrow">' + page.eyebrow + '</span><h2>' + page.title + '</h2><p>' + page.description + '</p></div><button class="primary workspace-action">＋ ' + page.action + '</button></div>' +
      '<div class="workspace-stats">' + page.stats.map(function (item, index) { return '<article class="glass"><span class="stat-icon ' + (index === 1 ? 'green' : index === 2 ? 'orange' : 'purple') + '"><svg><use href="#' + page.icon + '"/></svg></span><strong>' + item[0] + '</strong><small>' + item[1] + '</small></article>'; }).join('') + '</div>' +
      '<article class="workspace-list glass"><div class="card-title"><div><h3>Обзор раздела</h3><p>Демонстрационные данные · обновлено недавно</p></div><button class="more" aria-label="Дополнительные действия">•••</button></div><div>' + page.list.map(function (item, index) { return '<button><span class="list-number">0' + (index + 1) + '</span><span><b>' + item + '</b><small>Данные будут доступны после подключения проекта</small></span><em>' + (index === 1 ? 'В работе' : 'Актуально') + '</em><i>→</i></button>'; }).join('') + '</div><div class="empty-note"><span>✦</span><div><b>Интерфейс раздела уже готов</b><small>Функции и реальные данные появятся на следующем этапе разработки.</small></div></div></article>';
  }

  window.PlanFaktViews = { pages: pages, render: render };
})();
