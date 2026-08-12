"use strict";

/* Данные демонстрации: вымышленный бизнес-центр 5 000 кв. м.
 *
 * Всё в этом файле выдумано. Названия компаний, БИН, телефоны, номера
 * договоров и любые суммы не относятся к реальным организациям и не взяты
 * из чьей-либо учётной системы. Ставки заданы как модельные: они правдоподобны
 * по порядку величины, но источника под ними нет и ссылаться на них нельзя.
 * Правило: AGENTS.md, "ни одной цифры без источника".
 *
 * Генерация детерминированная: одно зерно даёт одну и ту же картину на любой
 * машине и в любом браузере. Это важно для показа: демонстрация не должна
 * меняться между репетицией и встречей.
 */

var DATA = (function () {

  /* Генератор псевдослучайных чисел с зерном. Обычный Math.random() дал бы
     новую картину при каждом открытии страницы. */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  var OBJECT = {
    name: 'Бизнес-центр «Меридиан»',
    note: 'демонстрационный объект',
    city: 'Шымкент',
    floorsCount: 6,
    totalArea: 5000
  };

  /* Этажи: назначение и базовая ставка за кв. м в месяц. Модельные величины. */
  var FLOORS = [
    { n: 1, note: 'вход, витрины, кафе',      rate: 10500, rooms: [[101,120],[102,86],[103,64],[104,52],[105,48],[106,150]] },
    { n: 2, note: 'услуги для посетителей',   rate: 7400,  rooms: [[201,96],[202,74],[203,56],[204,56],[205,42],[206,38],[207,88],[208,120]] },
    { n: 3, note: 'офисный блок',             rate: 6900,  rooms: [[301,86],[302,60],[303,60],[304,86],[305,48],[306,72],[307,54],[308,64]] },
    { n: 4, note: 'офисный блок',             rate: 6400,  rooms: [[401,110],[402,64],[403,48],[404,48],[405,72],[406,90],[407,56],[408,60]] },
    { n: 5, note: 'офисный блок',             rate: 6100,  rooms: [[501,130],[502,70],[503,52],[504,52],[505,66],[506,78],[507,44],[508,58]] },
    { n: 6, note: 'верхний этаж, вид',        rate: 6800,  rooms: [[601,160],[602,92],[603,74],[604,60],[605,88],[606,120]] }
  ];

  var MONTHS = [
    ['Мар','26'],['Апр','26'],['Май','26'],['Июн','26'],['Июл','26'],['Авг','26'],
    ['Сен','26'],['Окт','26'],['Ноя','26'],['Дек','26'],['Янв','27'],['Фев','27']
  ];

  /* Текущий месяц демонстрации: август 2026. */
  var NOW = 5;
  var TODAY = '12 августа 2026';

  var MONTH_FULL = ['марте','апреле','мае','июне','июле','августе',
                    'сентябре','октябре','ноябре','декабре','январе','феврале'];

  var TENANTS = [
    'ТОО «Алтын Курылыс»','ИП Сапарбаев, нотариус','ТОО «Sapa Consulting»','Юрфирма «Ак Ниет»',
    'Медцентр «Береке»','ТОО «Кодек Софт»','Турагентство «Жол»','ТОО «Шым Логистик»',
    'Учебный центр «Билим плюс»','ИП Ким, бухуслуги','ТОО «Оптима Трейд»','Стоматология «Дент Сити»',
    'ТОО «Каспий Строй»','Салон «Аружан»','ТОО «Агро Инвест Юг»','ИП Досжанов, страхование',
    'ТОО «Нур Медиа»','Языковой центр «Lingua»','ТОО «Темир Пласт»','ИП Абдуллаева, фотостудия',
    'ТОО «Эко Клин Сервис»','Банк, дополнительный офис','ТОО «Мега Дистрибьюшн»','ИП Тлеубаев, IT-услуги',
    'ТОО «Сункар Секьюрити»','Кофейня «Мезгил»','ТОО «Восток Фарм»','Рекламное «Пиксель»',
    'ТОО «Шымкент Аудит»','ИП Ералиева, швейный цех','ТОО «Гранд Мебель»','Кадровое «Профи»',
    'ТОО «Айсберг Климат»','ИП Нурланов, автозапчасти','ТОО «Юг Энерго»','Клиника «Сеним»',
    'ТОО «Дала Фуд»','ИП Оспанов, юруслуги','ТОО «Стандарт Пак»','Курсы «Мастер»'
  ];

  /* Контактные лица арендаторов. Тоже вымышленные. */
  var CONTACTS = [
    'Асель Нурланова','Ерлан Сапаров','Дмитрий Ким','Гульмира Абдуллаева','Тимур Досжанов',
    'Айгуль Сериккызы','Максат Жумабеков','Ольга Пак','Нурлан Ералиев','Динара Оспанова',
    'Руслан Тлеубаев','Жанна Каримова','Бекзат Алимов','Светлана Ли','Арман Бектуров'
  ];

  var RESPONSIBLE = ['Айгерим, управляющая','Марат, коммерческий','Салтанат, бухгалтерия'];

  /* Статусы ячейки шахматки. */
  var ST = {
    paid: { t: 'оплачено',        c: 'c-paid' },
    plan: { t: 'по договору',     c: 'c-plan' },
    due:  { t: 'счёт выставлен',  c: 'c-due'  },
    debt: { t: 'просрочка',       c: 'c-debt' },
    free: { t: 'свободно',        c: 'c-free' },
    book: { t: 'бронь',           c: 'c-book' },
    fix:  { t: 'ремонт',          c: 'c-fix'  }
  };

  /* Тарифы на коммунальные ресурсы и допуслуги. Модельные. */
  var TARIFF = {
    power: 28,      // за кВт*ч
    water: 240,     // за куб. м
    heat: 3100,     // за Гкал, считается от площади
    parking: 25000, // за место в месяц
    cleaning: 180,  // за кв. м в месяц
    internet: 15000 // за подключение в месяц
  };

  function buildRooms() {
    var rnd = mulberry32(20260812);
    var rooms = [];
    var tIdx = 0;

    FLOORS.forEach(function (f) {
      f.rooms.forEach(function (pair) {
        var id = pair[0], area = pair[1];

        var rate = Math.round(f.rate * (0.90 + rnd() * 0.22) / 100) * 100;
        var monthly = Math.round(area * rate / 1000) * 1000;

        var r = rnd();
        var mode, end, book = -1, fixTo = -1;

        if (r < 0.76)      { mode = 'long';   end = 12 + Math.floor(rnd() * 10); }
        else if (r < 0.88) { mode = 'ending'; end = NOW + Math.floor(rnd() * 4); }
        else if (r < 0.93) { mode = 'left';   end = Math.floor(rnd() * 5); }
        else if (r < 0.97) { mode = 'empty';  end = -1; }
        else               { mode = 'fix';    end = -1; fixTo = 1 + Math.floor(rnd() * 3); }

        if (mode === 'left'  && rnd() < 0.45) book = end + 2 + Math.floor(rnd() * 4);
        if (mode === 'empty' && rnd() < 0.40) book = 7 + Math.floor(rnd() * 3);
        if (mode === 'fix')                   book = fixTo + 1 + Math.floor(rnd() * 2);

        var hasTenant = (mode === 'long' || mode === 'ending' || mode === 'left');
        var tenantName = hasTenant ? TENANTS[tIdx++ % TENANTS.length] : null;

        /* Платёжная дисциплина, это свойство арендатора, а не случайность
           месяца. Иначе просрочки рассыпаются по шахматке шумом и не читаются
           как поведение конкретной компании. */
        var disc = rnd();
        var late = {};
        if (disc >= 0.80 && disc < 0.94) {
          late[Math.floor(rnd() * NOW)] = 1;
        } else if (disc >= 0.94) {
          var k = 2 + Math.floor(rnd() * 2);
          for (var j = 0; j < k; j++) late[NOW - j] = 1;
        }

        var cells = [];
        for (var m = 0; m < 12; m++) {
          if (hasTenant && m <= end) {
            var s;
            if (m < NOW)        s = late[m] ? 'debt' : 'paid';
            else if (m === NOW) s = late[m] ? 'debt' : (rnd() < 0.62 ? 'paid' : 'due');
            else                s = 'plan';
            cells.push({ s: s, sum: monthly });
          } else if (m <= fixTo) {
            cells.push({ s: 'fix', sum: 0 });
          } else if (book >= 0 && m >= book && m < book + 2) {
            cells.push({ s: 'book', sum: monthly });
          } else {
            cells.push({ s: 'free', sum: 0 });
          }
        }

        var debtMonths = [];
        cells.forEach(function (c, i) { if (c.s === 'debt') debtMonths.push(i); });
        var debt = debtMonths.length * monthly;

        var idle = cells.filter(function (c, i) {
          return i <= NOW && (c.s === 'free' || c.s === 'fix');
        }).length;

        var room = {
          id: id,
          floor: f.n,
          area: area,
          rate: rate,
          baseRate: rate,
          monthly: monthly,
          cells: cells,
          debt: debt,
          debtMonths: debtMonths,
          idle: idle,
          mode: mode,
          tenant: null
        };

        if (hasTenant) {
          /* Индексация: раз в год, месяц и процент закреплены в договоре.
             Часть договоров намеренно оставлена с пропущенной индексацией,
             это то, что находит аудит на экране разбора договоров. */
          var indexMonth = Math.floor(rnd() * 12);
          var indexPct = 5 + Math.floor(rnd() * 6);
          var forgotten = indexMonth <= NOW && rnd() < 0.42;

          /* Арендные каникулы на въезде, встречаются примерно у каждого
             седьмого договора. */
          var holidays = rnd() < 0.14 ? (1 + Math.floor(rnd() * 2)) : 0;

          /* Расход задан из расчёта офисного потребления на квадратный метр в
             месяц: электричество порядка 10-16 кВт*ч, вода порядка 0,15-0,3
             куб. м. Величины модельные, но соотношение с арендой должно быть
             правдоподобным, иначе коммуналка выглядит копейками рядом со
             ставкой и экран перестаёт быть похожим на настоящий счёт. */
          var powerPrev = 1200 + Math.floor(area * (14 + rnd() * 10));
          var powerUse = Math.round(area * (10 + rnd() * 6));
          var waterPrev = 40 + Math.floor(area * (0.5 + rnd() * 0.6));
          var waterUse = Math.round(area * (0.15 + rnd() * 0.15) * 10) / 10;

          var parking = rnd() < 0.55 ? 1 + Math.floor(rnd() * 3) : 0;
          var cleaning = rnd() < 0.45;
          var internet = rnd() < 0.7;

          room.tenant = {
            name: tenantName,
            contact: CONTACTS[(id + tIdx) % CONTACTS.length],
            phone: '+7 700 000 ' + String(10 + (id % 89)) + ' ' + String(10 + (tIdx % 89)),
            bin: String(200000000000 + id * 7919 + tIdx * 131),
            since: ['март 2023','ноябрь 2021','июль 2024','февраль 2020','сентябрь 2025'][id % 5],
            contractNo: (1200 + id) + '/' + (24 + (id % 3)),
            contractEnd: end,
            responsible: RESPONSIBLE[id % RESPONSIBLE.length],
            indexMonth: indexMonth,
            indexPct: indexPct,
            indexForgotten: forgotten,
            indexApplied: false,
            holidays: holidays,
            reminderStage: 0,
            log: [],
            meters: {
              powerPrev: powerPrev,
              powerCur: powerPrev + powerUse,
              waterPrev: waterPrev,
              waterCur: Math.round((waterPrev + waterUse) * 10) / 10
            },
            extras: {
              parking: parking,
              cleaning: cleaning,
              internet: internet
            }
          };
        }

        rooms.push(room);
      });
    });

    return rooms;
  }

  /* Переговорные и коворкинг: почасовая аренда, вторая вкладка шахматки. */
  var HALLS = [
    { n: 'Переговорная 1',   cap: '6 мест',    price: 6000  },
    { n: 'Переговорная 2',   cap: '10 мест',   price: 9000  },
    { n: 'Конференц-зал',    cap: '60 мест',   price: 25000 },
    { n: 'Тихая комната',    cap: '2 места',   price: 3500  },
    { n: 'Коворкинг, стол',  cap: '12 столов', price: 1500  }
  ];

  var HOURS = ['09','10','11','12','13','14','15','16','17','18','19','20'];

  var HALL_CLIENTS = [
    'ТОО «Кодек Софт»','Внешний, «Дала Фуд»','Медцентр «Береке»','Внешний, тренинг',
    'Юрфирма «Ак Ниет»','Внешний, собеседования','ТОО «Нур Медиа»','Внешний, презентация'
  ];

  function buildHalls() {
    var rnd = mulberry32(778899);
    return HALLS.map(function (h, hi) {
      var cells = HOURS.map(function () { return null; });
      var m = 0;
      while (m < HOURS.length) {
        var chance = hi === 4 ? 0.62 : hi === 2 ? 0.30 : 0.45;
        if (rnd() < chance) {
          var len = 1 + Math.floor(rnd() * (hi === 2 ? 4 : 3));
          var ci = Math.floor(rnd() * HALL_CLIENTS.length);
          var ext = HALL_CLIENTS[ci].indexOf('Внешний') === 0;
          for (var k = 0; k < len && m + k < HOURS.length; k++) {
            cells[m + k] = {
              who: HALL_CLIENTS[ci], ext: ext, first: k === 0, len: len,
              sum: h.price * (ext ? 1 : 0.5)
            };
          }
          m += len + 1;
        } else {
          m += 1;
        }
      }
      var copy = {};
      for (var key in h) if (Object.prototype.hasOwnProperty.call(h, key)) copy[key] = h[key];
      copy.cells = cells;
      return copy;
    });
  }

  var ROOMS = buildRooms();
  var HALL_ROWS = buildHalls();
  var RENT_AREA = ROOMS.reduce(function (s, r) { return s + r.area; }, 0);

  return {
    OBJECT: OBJECT,
    FLOORS: FLOORS,
    MONTHS: MONTHS,
    MONTH_FULL: MONTH_FULL,
    NOW: NOW,
    TODAY: TODAY,
    ST: ST,
    TARIFF: TARIFF,
    ROOMS: ROOMS,
    RENT_AREA: RENT_AREA,
    HALL_ROWS: HALL_ROWS,
    HOURS: HOURS,
    RESPONSIBLE: RESPONSIBLE
  };

})();
