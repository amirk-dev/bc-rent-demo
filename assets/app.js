"use strict";

/* Демонстрация системы управления коммерческой арендой.
 *
 * Девять экранов, но одно состояние на всех. Это главное свойство этой
 * демонстрации: действие на одном экране видно на остальных. Выставили счета,
 * ячейки сентября в шахматке пожелтели. Отметили оплату, долг погас и в
 * карточке, и в сводке собственнику. Применили забытую индексацию из аудита,
 * ставка выросла в реестре договоров и в начислениях.
 *
 * Без этого демонстрация распадается на девять несвязанных картинок, и любой
 * внимательный человек это замечает за минуту.
 */

(function () {

  var D = DATA;
  var NOW = D.NOW;
  var NEXT = NOW + 1;               // сентябрь, месяц, за который выставляются счета

  /* ─── мелкая помощь ───────────────────────────────────── */

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  /* Названия арендаторов содержат кавычки, поэтому всё, что уходит в разметку
     или в атрибут, обязано проходить через это. */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* Кликабельный элемент, который не является кнопкой. Без этого строки
     шахматки и таблиц открываются мышью, но недостижимы с клавиатуры, а
     фокус на них не виден вовсе. */
  function clickable(node, fn, label) {
    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
    if (label) node.setAttribute('aria-label', label);
    node.onclick = fn;
    node.onkeydown = function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        fn();
      }
    };
    return node;
  }

  /* aria-current="false" разметку не украшает и читалкам не помогает:
     признак либо стоит, либо его нет. */
  function markCurrent(node, on) {
    if (on) node.setAttribute('aria-current', 'true');
    else node.removeAttribute('aria-current');
  }

  function fmt(n) { return Math.round(n).toLocaleString('ru-RU'); }
  /* Ноль в миллионах выглядит как сломанный счётчик, поэтому показывается цифрой. */
  function mln(n) { return n < 1e5 ? fmt(n) : (n / 1e6).toFixed(2).replace('.', ',') + ' млн'; }
  function money(n) { return fmt(n) + ' ₸'; }
  function icon(name, size) {
    var s = size || 20;
    return '<svg class="ic" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" aria-hidden="true"><use href="#' + name + '"/></svg>';
  }
  function monthName(i) { return D.MONTHS[i][0] + ' 20' + D.MONTHS[i][1]; }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 4200);
  }

  /* ─── подготовка состояния ────────────────────────────── */

  D.ROOMS.forEach(function (r) {
    if (!r.tenant) return;
    r.tenant.esf = false;
    r.tenant.log = [];
    r.tenant.reminderStage = 0;
  });

  var state = {
    screen: 'grid',
    gridView: 'rent',      // rent или hours
    filter: 'all',
    query: '',
    selected: null,
    panelOpen: false,
    debtor: null,
    planFloor: 3,
    lead: { name: '', phone: '', area: '' },
    auditState: 'idle',    // idle, run, done
    auditFiles: [],
    invoicesIssued: false
  };

  /* ─── производные величины ────────────────────────────── */

  function statusOf(r) { return r.cells[NOW].s; }

  /* Занято ли помещение прямо сейчас. Наличие арендатора этого не означает:
     у съехавшего договор в реестре остаётся, а помещение уже свободно или
     забронировано под следующего. Пока экраны смотрели на r.tenant, шахматка
     подписывала бронь именем прежней компании, а карточка предлагала выставить
     ей счёт за сентябрь. */
  function isOccupied(r) {
    return ['paid', 'due', 'debt', 'plan'].indexOf(statusOf(r)) >= 0;
  }

  /* Долг считается по суммам, которые реально стояли в счетах тех месяцев,
     а не по текущей ставке. Иначе применение индексации задним числом
     раздувает старый долг, хотя счета за те месяцы выставлялись по старой
     ставке и арендатор должен ровно их. */
  function recalc(r) {
    var months = [], sum = 0;
    r.cells.forEach(function (c, i) {
      if (c.s === 'debt') { months.push(i); sum += c.sum; }
    });
    r.debtMonths = months;
    r.debt = sum;
  }

  function utilities(r) {
    var m = r.tenant.meters;
    var power = Math.round((m.powerCur - m.powerPrev) * D.TARIFF.power);
    var water = Math.round((m.waterCur - m.waterPrev) * D.TARIFF.water);
    var heat = Math.round(r.area * 0.03 * D.TARIFF.heat);
    return { power: power, water: water, heat: heat, total: power + water + heat };
  }

  function extras(r) {
    var e = r.tenant.extras;
    var parking = e.parking * D.TARIFF.parking;
    var cleaning = e.cleaning ? Math.round(r.area * D.TARIFF.cleaning) : 0;
    var internet = e.internet ? D.TARIFF.internet : 0;
    return { parking: parking, cleaning: cleaning, internet: internet,
             total: parking + cleaning + internet };
  }

  function invoiceOf(r) {
    var u = utilities(r), x = extras(r);
    return { rent: r.monthly, util: u.total, extra: x.total,
             total: r.monthly + u.total + x.total, u: u, x: x };
  }

  function occupied() {
    return D.ROOMS.filter(function (r) {
      return ['paid', 'due', 'debt', 'plan'].indexOf(statusOf(r)) >= 0;
    });
  }
  function freeRooms() {
    return D.ROOMS.filter(function (r) { return statusOf(r) === 'free'; });
  }
  function debtors() {
    return D.ROOMS.filter(function (r) { return r.debt > 0; })
      .sort(function (a, b) { return b.debt - a.debt; });
  }
  function ending() {
    return D.ROOMS.filter(function (r) {
      return r.tenant && r.tenant.contractEnd >= NOW && r.tenant.contractEnd < 12;
    }).sort(function (a, b) { return a.tenant.contractEnd - b.tenant.contractEnd; });
  }
  /* Только действующие договоры. Индексировать ставку арендатору, который
     съехал весной, бессмысленно, а в сумме недоначисления он даёт цифру,
     которую невозможно взыскать. */
  function forgottenIndex() {
    return D.ROOMS.filter(function (r) {
      return r.tenant && r.tenant.indexForgotten && !r.tenant.indexApplied &&
        r.tenant.contractEnd >= NOW;
    });
  }
  function tenants() {
    return D.ROOMS.filter(function (r) { return r.tenant; });
  }
  /* Арендаторы с действующим договором. Отличается от tenants() тем, что
     съехавшие в реестре остаются, а в знаменателях считаться не должны. */
  function activeTenants() {
    return D.ROOMS.filter(function (r) {
      return r.tenant && ['paid', 'due', 'debt', 'plan'].indexOf(statusOf(r)) >= 0;
    });
  }

  /* Просрочка в днях, модельная: срок оплаты, это 5 число месяца. */
  function overdueDays(r) {
    if (!r.debtMonths.length) return 0;
    var first = r.debtMonths[0];
    return (NOW - first) * 30 + 7;
  }

  function totalDebt() {
    return D.ROOMS.reduce(function (s, r) { return s + r.debt; }, 0);
  }

  /* Начислено и собрано за текущий месяц берутся из сумм тех самых ячеек, а не
     из текущей ставки: август уже закрыт, и индексация, применённая сегодня,
     не имеет права его переписывать. */
  function billedAt(month) {
    return D.ROOMS.reduce(function (s, r) {
      var c = r.cells[month];
      return s + (['paid', 'due', 'debt', 'plan'].indexOf(c.s) >= 0 ? c.sum : 0);
    }, 0);
  }
  function collectedAt(month) {
    return D.ROOMS.reduce(function (s, r) {
      return s + (r.cells[month].s === 'paid' ? r.cells[month].sum : 0);
    }, 0);
  }

  /* ─── действия, меняющие состояние ────────────────────── */

  function issueInvoices() {
    var n = 0;
    tenants().forEach(function (r) {
      if (r.tenant.contractEnd >= NEXT && r.cells[NEXT].s === 'plan') {
        r.cells[NEXT].s = 'due';
        r.cells[NEXT].sum = invoiceOf(r).total;
        n++;
      }
    });
    render();
    toast(n
      ? 'Демонстрация: ' + n + ' счетов за сентябрь сформировано и отправлено в WhatsApp одним действием. В шахматке сентябрь стал жёлтым.'
      : 'Все счета за сентябрь уже выставлены, выставлять нечего.');
  }

  function markPaid(r, monthIdx) {
    var m = monthIdx === undefined ? NOW : monthIdx;
    if (r.cells[m].s === 'due' || r.cells[m].s === 'debt') {
      r.cells[m].s = 'paid';
      recalc(r);
      r.tenant.reminderStage = 0;
      render();
      toast('Демонстрация: оплата за ' + monthName(m) + ' отмечена по помещению ' + r.id + '. Долг пересчитан во всех разделах.');
    }
  }

  function payAllDebt(r) {
    r.debtMonths.slice().forEach(function (m) { r.cells[m].s = 'paid'; });
    recalc(r);
    r.tenant.reminderStage = 0;
    render();
    toast('Демонстрация: долг по помещению ' + r.id + ' погашен полностью. Проверьте сводку собственнику, там его больше нет.');
  }

  function applyIndexation(r) {
    var t = r.tenant;
    if (t.indexApplied) return;
    var oldRate = r.rate;
    r.rate = Math.round(r.rate * (1 + t.indexPct / 100));
    r.monthly = Math.round(r.area * r.rate / 1000) * 1000;
    /* Пересчёт касается только будущих месяцев: прошлое уже начислено. */
    for (var m = NEXT; m < 12; m++) {
      if (r.cells[m].s === 'plan' || r.cells[m].s === 'due') r.cells[m].sum = r.monthly;
    }
    t.indexApplied = true;
    t.indexForgotten = false;
    recalc(r);
    render();
    toast('Демонстрация: ставка по помещению ' + r.id + ' поднята с ' + fmt(oldRate) +
          ' до ' + fmt(r.rate) + ' ₸ за кв. м. Изменение видно в реестре договоров и в начислениях.');
  }

  function sendNextReminder(r) {
    var t = r.tenant;
    if (t.reminderStage >= CHAIN.length) return;
    var step = CHAIN[t.reminderStage];
    t.log.push({ text: step.text(r), when: step.when, out: true, title: step.title });
    t.reminderStage++;
    render();
    toast('Демонстрация: "' + step.title + '" отправлено на номер из карточки. Ничего никуда не ушло.');
  }

  function bookRoom(r) {
    if (statusOf(r) !== 'free') return;
    for (var m = NOW; m < Math.min(NOW + 2, 12); m++) {
      r.cells[m].s = 'book';
      r.cells[m].sum = r.monthly;
    }
    render();
    toast('Демонстрация: помещение ' + r.id + ' забронировано на 3 дня и снято с публичной витрины. В шахматке оно стало сиреневым.');
  }

  function issueEsf(r) {
    r.tenant.esf = true;
    render();
    toast('Демонстрация: ЭСФ по помещению ' + r.id + ' выписана и ушла в ИС ЭСФ. Срок по закону, 15 календарных дней с даты оборота.');
  }

  /* ЭСФ выписывается по обороту, то есть по выставленному или оплаченному
     счёту. Проверять «не plan» нельзя: у съехавшего арендатора в сентябре
     стоит «свободно», и он тоже прошёл бы это условие. */
  function issueEsfAll() {
    var n = 0;
    tenants().forEach(function (r) {
      var s = r.cells[NEXT].s;
      if ((s === 'due' || s === 'paid') && !r.tenant.esf) { r.tenant.esf = true; n++; }
    });
    render();
    toast(n ? 'Демонстрация: ' + n + ' ЭСФ выписано пакетом и отправлено в ИС ЭСФ.'
            : 'Выписывать нечего: ЭСФ идёт по обороту, значит сначала счета за сентябрь.');
  }

  /* ─── цепочка напоминаний ─────────────────────────────── */

  var CHAIN = [
    {
      title: 'Счёт',
      when: '1 сентября, 09:00',
      text: function (r) {
        var inv = invoiceOf(r);
        return 'Здравствуйте, ' + r.tenant.contact + '.\n' +
          'Счёт за сентябрь по договору № ' + r.tenant.contractNo + ', помещение ' + r.id + '.\n' +
          'Аренда ' + money(inv.rent) + ', коммунальные ' + money(inv.util) +
          ', услуги ' + money(inv.extra) + '.\n' +
          'Итого к оплате ' + money(inv.total) + ', срок до 5 сентября.\n' +
          'Оплата по ссылке Kaspi, счёт и ЭСФ во вложении.';
      }
    },
    {
      title: 'Напоминание за день',
      when: '4 сентября, 10:00',
      text: function (r) {
        return 'Напоминаем: завтра последний день оплаты счёта за сентябрь, ' +
          money(invoiceOf(r).total) + '.\nЕсли оплата уже прошла, это сообщение можно не читать.';
      }
    },
    {
      title: 'Уведомление о просрочке',
      when: '8 сентября, 10:00',
      text: function (r) {
        return r.tenant.name + ', по счёту за сентябрь оплата не поступила.\n' +
          'Просрочка ' + overdueDays(r) + ' дней, сумма ' + money(r.debt || invoiceOf(r).total) + '.\n' +
          'По договору № ' + r.tenant.contractNo + ' с шестого дня начисляется пеня.\n' +
          'Просим оплатить или написать дату оплаты.';
      }
    },
    {
      title: 'Претензия',
      when: '15 сентября, 11:00',
      text: function (r) {
        return 'Претензия по договору аренды № ' + r.tenant.contractNo + '.\n' +
          'Задолженность ' + money(r.debt || invoiceOf(r).total) + ', помещение ' + r.id +
          ', ' + r.area + ' кв. м.\n' +
          'Просим погасить в течение 10 рабочих дней с даты получения.\n' +
          'Документ с расчётом пени во вложении. Ответственный: ' + r.tenant.responsible + '.';
      }
    }
  ];

  /* ─── разделы ─────────────────────────────────────────── */

  var SCREENS = [
    { id: 'grid',      name: 'Шахматка',      ic: 'i-grid',  tz: 3, panel: true,  tab: true },
    { id: 'tenants',   name: 'Арендаторы',    ic: 'i-user',  tz: 3, panel: true,  tab: true },
    { id: 'bills',     name: 'Начисления',    ic: 'i-bill',  tz: 6, panel: false, tab: true },
    { id: 'remind',    name: 'Напоминания',   ic: 'i-chat',  tz: 4, panel: false, tab: true },
    { id: 'contracts', name: 'Договоры',      ic: 'i-cal',   tz: 5, panel: false, tab: false },
    { id: 'audit',     name: 'Аудит ИИ',      ic: 'i-ai',    tz: 1, panel: false, tab: false },
    { id: 'market',    name: 'Витрина',       ic: 'i-shop',  tz: 2, panel: false, tab: false },
    { id: 'report',    name: 'Сводка',        ic: 'i-chart', tz: 7, panel: false, tab: false },
    { id: 'scope',     name: 'Состав',        ic: 'i-list',  tz: 0, panel: false, tab: false }
  ];

  function badgeOf(id) {
    if (id === 'remind')    return debtors().length;
    if (id === 'contracts') return ending().length;
    /* Значок гаснет, когда индексации применены, а не когда разбор закончен:
       пока ставка не поднята, деньги всё ещё лежат на столе. */
    if (id === 'audit')     return forgottenIndex().length;
    if (id === 'market')    return freeRooms().length;
    return 0;
  }

  function screenById(id) {
    for (var i = 0; i < SCREENS.length; i++) if (SCREENS[i].id === id) return SCREENS[i];
    return SCREENS[0];
  }

  /* ─── навигация ───────────────────────────────────────── */

  function go(id) {
    if (!screenById(id)) return;
    state.screen = id;
    closeSheet();
    if (location.hash !== '#/' + id) location.hash = '#/' + id;
    else render();
  }

  function renderRail() {
    var rail = $('rail');
    rail.innerHTML = '';
    rail.append(el('div', 'rail-t', 'Объект'));
    SCREENS.forEach(function (s) {
      var b = el('button', 'nav');
      var n = badgeOf(s.id);
      b.innerHTML = icon(s.ic) + '<span>' + s.name + '</span>' +
        (n ? '<span class="n">' + n + '</span>' : '');
      markCurrent(b, state.screen === s.id);
      b.onclick = function () { go(s.id); };
      rail.append(b);
    });
    rail.append(el('div', 'rail-foot',
      'Демонстрация. Компании, договоры и суммы вымышлены, ' +
      'ни одно действие ничего никуда не отправляет.'));
  }

  function renderTabbar() {
    var bar = $('tabbar');
    bar.innerHTML = '';
    var tabs = SCREENS.filter(function (s) { return s.tab; });
    tabs.forEach(function (s) {
      var b = el('button', 'tab');
      var n = badgeOf(s.id);
      b.innerHTML = icon(s.ic, 22) + '<span>' + s.name + '</span>' +
        (n ? '<span class="n">' + n + '</span>' : '');
      markCurrent(b, state.screen === s.id);
      b.onclick = function () { go(s.id); };
      bar.append(b);
    });
    var more = el('button', 'tab');
    var rest = SCREENS.filter(function (s) { return !s.tab; });
    var restActive = rest.some(function (s) { return s.id === state.screen; });
    more.innerHTML = icon('i-more', 22) + '<span>Ещё</span>';
    markCurrent(more, restActive);
    more.onclick = openSheet;
    bar.append(more);
  }

  function openSheet() {
    var sheet = $('sheet');
    sheet.innerHTML = '<div class="grab"></div>';
    SCREENS.filter(function (s) { return !s.tab; }).forEach(function (s) {
      var b = el('button', 'nav');
      var n = badgeOf(s.id);
      b.innerHTML = icon(s.ic) + '<span>' + s.name + '</span>' +
        (n ? '<span class="n">' + n + '</span>' : '');
      markCurrent(b, state.screen === s.id);
      b.onclick = function () { go(s.id); };
      sheet.append(b);
    });
    sheet.classList.add('on');
    $('sheetBg').classList.add('on');
  }
  function closeSheet() {
    $('sheet').classList.remove('on');
    $('sheetBg').classList.remove('on');
  }

  /* ─── карточка арендатора ─────────────────────────────── */

  function closePanel() {
    state.selected = null;
    state.panelOpen = false;
    render();
  }

  /* Открытость карточки, это состояние, а не класс на элементе. Класс сбивался
     любой следующей перерисовкой, и на телефоне переход из витрины в шахматку
     оставлял карточку за краем экрана. */
  function selectRoom(r, screen) {
    state.selected = r.id;
    state.panelOpen = true;
    if (screen && screen !== state.screen) go(screen);
    else render();
  }

  function renderPanel() {
    var p = $('panel');
    var sc = screenById(state.screen);
    p.hidden = !sc.panel;
    if (!sc.panel) { p.classList.remove('open'); return; }

    var r = null;
    D.ROOMS.forEach(function (x) { if (x.id === state.selected) r = x; });

    if (!r) {
      p.className = 'panel blank';
      p.innerHTML = 'Выберите помещение, чтобы увидеть арендатора, договор и платежи';
      return;
    }
    p.className = 'panel' + (state.panelOpen ? ' open' : '');

    var st = statusOf(r);
    var badge = {
      paid: ['Оплачено', 'b-paid'], due: ['Ждём оплату', 'b-due'],
      debt: ['Проблемный', 'b-debt'], free: ['Свободно', 'b-free'],
      book: ['Бронь', 'b-book'], fix: ['Ремонт', 'b-fix'], plan: ['По договору', 'b-paid']
    }[st];

    /* Карточка показывает состояние помещения, а не наличие записи в реестре.
       Прежний арендатор, если он был, идёт отдельной строкой и без действий. */
    var t = isOccupied(r) ? r.tenant : null;
    var past = !t && r.tenant ? r.tenant : null;
    var rows;

    if (t) {
      var inv = invoiceOf(r);
      rows = [
        ['Арендатор', esc(t.name)],
        ['Контакт', esc(t.contact) + ', ' + esc(t.phone)],
        ['БИН', esc(t.bin)],
        ['Договор', '№ ' + esc(t.contractNo)],
        ['Арендует с', esc(t.since)],
        ['Срок договора', t.contractEnd < 12 ? monthName(t.contractEnd) : 'дальше горизонта'],
        ['Ставка', fmt(r.rate) + ' ₸ за кв. м' + (t.indexApplied ? ' (проиндексирована)' : '')],
        ['Аренда в месяц', money(r.monthly)],
        ['Коммунальные', money(inv.util)],
        ['Допуслуги', money(inv.extra)],
        ['Счёт за сентябрь', '<b>' + money(inv.total) + '</b>'],
        ['Долг', r.debt ? '<span style="color:var(--coral)">' + money(r.debt) + '</span>' : 'нет']
      ];
    } else {
      rows = [
        ['Статус', st === 'book' ? 'бронь, договор готовится' : st === 'fix' ? 'ремонт' : 'свободно'],
        ['Пустует', r.idle + ' мес. из 6 прошедших'],
        ['Ставка по прайсу', fmt(r.rate) + ' ₸ за кв. м'],
        ['Потенциал', money(r.monthly) + ' в месяц'],
        ['Недополучено', '<span style="color:var(--coral)">' + money(r.monthly * r.idle) + '</span>']
      ];
      if (past) {
        rows.push(['Прежний арендатор', esc(past.name)]);
        rows.push(['Договор закончился', past.contractEnd >= 0 && past.contractEnd < 12
          ? monthName(past.contractEnd) : 'до начала периода']);
      }
    }

    var pay = r.cells.map(function (c, i) {
      var bg = {
        paid: 'rgba(59,57,196,.13);color:var(--indigo)',
        plan: 'rgba(110,107,230,.07);color:#6B6B93',
        due: 'rgba(224,179,60,.22);color:#8A5F00',
        debt: 'rgba(238,79,73,.17);color:var(--coral)',
        free: '#F2F2F7;color:#B6B6C6',
        book: 'rgba(169,167,244,.34);color:#4B48A8',
        fix: '#E7E7EE;color:#8B8B9E'
      }[c.s];
      return '<i style="background:' + bg + (i === NOW ? ';outline:1.5px solid var(--indigo)' : '') + '">' +
        D.MONTHS[i][0] + '<b>' + (c.sum ? Math.round(c.sum / 1000) : '0') + '</b></i>';
    }).join('');

    p.innerHTML =
      '<div class="p-head">' +
        '<button class="p-close" id="pClose" aria-label="Закрыть">&times;</button>' +
        '<div class="n">Помещение ' + r.id + '</div>' +
        '<div class="s">Этаж ' + r.floor + ', ' + r.area + ' кв. м</div>' +
        '<span class="badge ' + badge[1] + '">' + badge[0] + '</span>' +
      '</div>' +
      '<div class="p-body">' +
        rows.map(function (kv) {
          return '<div class="kv"><span>' + kv[0] + '</span><b>' + kv[1] + '</b></div>';
        }).join('') +
        '<div class="h2">Платежи по месяцам, тыс ₸</div><div class="pay">' + pay + '</div>' +
        '<div class="acts" id="acts"></div>' +
        '<div class="note">Суммы модельные. Все действия показываются сообщением ' +
        'и ничего никуда не отправляют.</div>' +
      '</div>';

    var close = $('pClose');
    if (close) close.onclick = closePanel;

    var acts = $('acts');
    function add(cls, label, fn) {
      var b = el('button', 'btn ' + cls, label);
      b.onclick = fn;
      acts.append(b);
    }

    if (t) {
      if (r.debt) {
        /* Должника выбираем до перехода: go() может отрисовать экран сразу,
           и тогда на нём открылся бы не тот арендатор. */
        add('wa', 'Напомнить о долге в WhatsApp', function () {
          state.debtor = r.id;
          go('remind');
        });
        add('sec', 'Отметить оплату долга', function () { payAllDebt(r); });
      }
      if (r.cells[NEXT].s === 'plan') {
        add('pri', 'Выставить счёт за сентябрь', function () {
          r.cells[NEXT].s = 'due';
          r.cells[NEXT].sum = invoiceOf(r).total;
          render();
          toast('Демонстрация: счёт на ' + money(invoiceOf(r).total) + ' сформирован, ссылка на оплату Kaspi отправлена.');
        });
      } else if (r.cells[NEXT].s === 'due') {
        add('sec', 'Отметить оплату за сентябрь', function () { markPaid(r, NEXT); });
      }
      /* ЭСФ идёт по обороту: пока счёт за сентябрь не выставлен, выписывать нечего. */
      if (!t.esf && (r.cells[NEXT].s === 'due' || r.cells[NEXT].s === 'paid')) {
        add('gho', 'Выписать ЭСФ', function () { issueEsf(r); });
      }
      if (t.indexForgotten && !t.indexApplied) {
        add('danger', 'Применить забытую индексацию, ' + t.indexPct + '%', function () { applyIndexation(r); });
      }
      add('gho', 'Открыть договор', function () {
        toast('Демонстрация: договор № ' + t.contractNo + ', скан и карточка сделки. Здесь открылся бы файл.');
      });
    } else {
      add('pri', 'Показать помещение клиенту', function () {
        toast('Демонстрация: ссылка с фотографиями, планировкой и ценой на помещение ' + r.id + ' отправлена в WhatsApp.');
      });
      if (statusOf(r) === 'free') add('sec', 'Забронировать', function () { bookRoom(r); });
      add('gho', 'Открыть в витрине', function () { state.planFloor = r.floor; go('market'); });
    }
  }

  /* ─── экран: шахматка ─────────────────────────────────── */

  function matches(r) {
    var q = state.query.trim().toLowerCase();
    if (q) {
      var byId = String(r.id).indexOf(q) === 0;
      var byName = r.tenant && r.tenant.name.toLowerCase().indexOf(q) >= 0;
      if (!byId && !byName) return false;
    }
    var s = statusOf(r);
    if (state.filter === 'free')   return s === 'free';
    if (state.filter === 'debt')   return r.debt > 0;
    if (state.filter === 'ending') return r.tenant && r.tenant.contractEnd >= NOW && r.tenant.contractEnd < 12;
    if (state.filter === 'fix')    return r.cells.some(function (c) { return c.s === 'fix'; });
    return true;
  }

  function barGrid(bar) {
    var chips = el('div', 'chips');
    [['rent', 'Аренда, 12 месяцев'], ['hours', 'Переговорные, по часам']].forEach(function (p) {
      var b = el('button', 'chip', p[1]);
      b.setAttribute('aria-pressed', state.gridView === p[0]);
      b.onclick = function () { state.gridView = p[0]; state.filter = 'all'; state.query = ''; render(); };
      chips.append(b);
    });

    if (state.gridView === 'hours') {
      bar.append(chips, el('div', 'sep'));
      var pr = el('button', 'btn gho', 'Правила и цены');
      pr.onclick = function () {
        toast('Демонстрация: арендаторам объекта 50% от прайса, внешним клиентам полная ставка. Оплата картой или Kaspi при бронировании.');
      };
      bar.append(pr);
      return;
    }

    var counts = {
      all: D.ROOMS.length,
      free: freeRooms().length,
      debt: debtors().length,
      ending: ending().length,
      fix: D.ROOMS.filter(function (r) { return r.cells.some(function (c) { return c.s === 'fix'; }); }).length
    };
    [['all', 'Все'], ['free', 'Свободные'], ['debt', 'С долгом'],
     ['ending', 'Договор истекает'], ['fix', 'Ремонт']].forEach(function (p) {
      if (!counts[p[0]] && p[0] !== 'all' && state.filter !== p[0]) return;
      var b = el('button', 'chip', p[1] + '<span class="n">' + counts[p[0]] + '</span>');
      b.setAttribute('aria-pressed', state.filter === p[0]);
      b.onclick = function () { state.filter = p[0]; render(); };
      chips.append(b);
    });
    bar.append(chips);

    var s = el('input', 'search');
    s.type = 'search';
    s.placeholder = 'Номер или арендатор';
    s.value = state.query;
    s.oninput = function (e) { state.query = e.target.value; renderView(); };
    bar.append(s, el('div', 'sep'));

    var acts = el('div', 'bar-acts');
    var inv = el('button', 'btn pri', 'Выставить счета за сентябрь');
    inv.onclick = issueInvoices;
    var csv = el('button', 'btn gho', 'Скачать CSV');
    csv.onclick = exportCsv;
    acts.append(inv, csv);
    bar.append(acts);
  }

  function viewGrid(v) {
    var g = el('div', 'grid');
    if (state.gridView === 'hours') { viewHalls(g); v.append(g); return; }

    g.style.gridTemplateColumns = 'var(--side-w) repeat(12, minmax(var(--col-w),1fr))';
    g.append(el('div', 'hd side', 'Помещение'));
    D.MONTHS.forEach(function (m, i) {
      g.append(el('div', 'hd' + (i === NOW ? ' now' : ''),
        m[0] + '<small>' + (i === NOW ? 'сейчас' : '20' + m[1]) + '</small>'));
    });

    var shown = 0;
    D.FLOORS.forEach(function (f) {
      var list = D.ROOMS.filter(function (r) { return r.floor === f.n && matches(r); });
      if (!list.length) return;
      shown += list.length;
      var area = list.reduce(function (s, r) { return s + r.area; }, 0);
      g.append(el('div', 'fl', 'Этаж ' + f.n + ' <em>' + f.note + ', ' + list.length +
        ' помещений, ' + fmt(area) + ' кв. м</em>'));

      list.forEach(function (r) {
        var st = statusOf(r);
        var col = st === 'free' || st === 'debt' ? 'var(--coral)' :
                  st === 'due' ? 'var(--amber)' :
                  st === 'book' ? 'var(--violet-2)' :
                  st === 'fix' ? '#B0B0BE' : 'var(--indigo-2)';
        var side = el('div', 'side' + (state.selected === r.id ? ' sel' : ''));
        side.innerHTML =
          '<div class="r1"><span class="dot" style="background:' + col + '"></span>' +
          '<b>' + r.id + '</b><span class="a">' + r.area + ' кв. м, ' + fmt(r.rate) + '</span></div>' +
          '<div class="t' + (isOccupied(r) ? '' : ' free') + '">' +
            (isOccupied(r) ? esc(r.tenant.name)
              : st === 'book' ? 'бронь, договор готовится'
              : st === 'fix' ? 'ремонт' : 'свободно') +
          '</div>';
        clickable(side, function () { selectRoom(r); },
          'Помещение ' + r.id + (r.tenant ? ', ' + r.tenant.name : ', свободно'));
        g.append(side);

        r.cells.forEach(function (c, i) {
          var d = el('div', 'c ' + D.ST[c.s].c + (i === NOW ? ' now' : '') +
            (r.tenant && i === r.tenant.contractEnd ? ' c-end' : ''));
          if (c.s === 'free')      d.innerHTML = '';
          else if (c.s === 'fix')  d.innerHTML = '<span class="m">ремонт</span>';
          else if (c.s === 'book') d.innerHTML = '<span class="m">бронь</span>';
          else {
            d.innerHTML = '<span class="n">' + Math.round(c.sum / 1000) + '</span>' +
              (c.s === 'debt' ? '<span class="m">долг</span>' :
               c.s === 'due' ? '<span class="m">счёт</span>' : '');
          }
          d.title = 'Помещение ' + r.id + ', ' + monthName(i) + '\n' + D.ST[c.s].t +
            (c.sum ? ', ' + money(c.sum) : '') +
            (r.tenant && i === r.tenant.contractEnd ? '\nконец договора' : '');
          d.onclick = function () { selectRoom(r); };
          g.append(d);
        });
      });
    });

    if (!shown) g.append(el('div', 'fl', 'Ничего не найдено, снимите фильтр или очистите поиск'));
    v.append(g);
  }

  function viewHalls(g) {
    g.style.gridTemplateColumns = 'var(--side-w) repeat(' + D.HOURS.length + ', minmax(var(--col-w),1fr))';
    g.append(el('div', 'hd side', 'Ресурс'));
    D.HOURS.forEach(function (h) {
      g.append(el('div', 'hd', h + ':00<small>до ' + (+h + 1) + ':00</small>'));
    });
    D.HALL_ROWS.forEach(function (h) {
      var side = el('div', 'side');
      side.innerHTML = '<div class="r1"><b>' + esc(h.n) + '</b><span class="a">' + h.cap + '</span></div>' +
        '<div class="t">' + fmt(h.price) + ' ₸ в час, арендаторам ' + fmt(h.price / 2) + '</div>';
      g.append(side);
      h.cells.forEach(function (c, i) {
        var d = el('div', 'c ' + (c ? (c.ext ? 'c-book' : 'c-paid') : 'c-free'));
        if (c) {
          d.innerHTML = c.first
            ? '<span class="m" style="text-transform:none;font-size:10.5px;white-space:nowrap">' +
              esc(c.who.replace('Внешний, ', '')) + '</span>'
            : '<span class="m">.</span>';
        } else {
          d.innerHTML = '';
        }
        d.title = c ? h.n + ', ' + D.HOURS[i] + ':00, ' + c.who + ', ' + money(c.sum)
                    : h.n + ', ' + D.HOURS[i] + ':00, свободно, ' + money(h.price);
        d.onclick = function () {
          toast(c ? 'Демонстрация: бронь "' + c.who + '", ' + h.n + ' в ' + D.HOURS[i] + ':00, ' + money(c.sum) + ', оплачена онлайн.'
                  : 'Демонстрация: слот ' + D.HOURS[i] + ':00 свободен. Бронирование и оплата по ссылке, без звонка управляющему.');
        };
        g.append(d);
      });
    });
  }

  function exportCsv() {
    var head = ['Этаж', 'Помещение', 'Площадь кв.м', 'Ставка тг/кв.м', 'Арендатор',
                'Платёж в месяц', 'Долг'].concat(D.MONTHS.map(function (m) {
      return m[0] + ' 20' + m[1];
    }));
    var lines = [head.join(';')];
    D.ROOMS.filter(matches).forEach(function (r) {
      lines.push([r.floor, r.id, r.area, r.rate, r.tenant ? r.tenant.name : 'свободно',
        r.monthly, r.debt].concat(r.cells.map(function (c) { return D.ST[c.s].t; })).join(';'));
    });
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'shahmatka-demo.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    toast('Выгружено ' + D.ROOMS.filter(matches).length + ' строк в CSV, тот же файл открывается в Excel.');
  }

  /* ─── экран: арендаторы ───────────────────────────────── */

  function barTenants(bar) {
    var chips = el('div', 'chips');
    [['all', 'Все'], ['debt', 'С долгом'], ['ending', 'Договор истекает']].forEach(function (p) {
      var b = el('button', 'chip', p[1]);
      b.setAttribute('aria-pressed', state.filter === p[0]);
      b.onclick = function () { state.filter = p[0]; render(); };
      chips.append(b);
    });
    bar.append(chips);
    var s = el('input', 'search');
    s.type = 'search';
    s.placeholder = 'Арендатор или помещение';
    s.value = state.query;
    s.oninput = function (e) { state.query = e.target.value; renderView(); };
    bar.append(s);
  }

  function viewTenants(v) {
    var pad = el('div', 'pad wrap');
    pad.append(el('h1', 'h1', 'Арендаторы'));
    pad.append(el('p', 'sub',
      'Всё по арендатору в одной карточке: договор, долг, оплаты, статус и помещение. ' +
      'Нажмите на строку.'));

    var list = tenants().filter(function (r) {
      var q = state.query.trim().toLowerCase();
      if (q && String(r.id).indexOf(q) !== 0 && r.tenant.name.toLowerCase().indexOf(q) < 0) return false;
      if (state.filter === 'debt') return r.debt > 0;
      if (state.filter === 'ending') return r.tenant.contractEnd >= NOW && r.tenant.contractEnd < 12;
      return true;
    });

    if (!list.length) {
      pad.append(el('div', 'empty', 'Ничего не найдено'));
      v.append(pad);
      return;
    }

    var wrap = el('div', 'tbl-wrap cards');
    var t = el('table', 'tbl cards');
    t.innerHTML = '<thead><tr><th>Арендатор</th><th>Помещение</th><th>Договор</th>' +
      '<th class="num">Платёж</th><th class="num">Долг</th><th>Статус</th></tr></thead>';
    var tb = el('tbody');
    list.forEach(function (r) {
      var st = statusOf(r);
      var badge = { paid: ['Оплачено', 'b-paid'], due: ['Ждём оплату', 'b-due'],
        debt: ['Проблемный', 'b-debt'], plan: ['По договору', 'b-paid'],
        free: ['Съехал', 'b-fix'], book: ['Бронь', 'b-book'], fix: ['Ремонт', 'b-fix'] }[st];
      var tr = el('tr', 'rowbtn');
      tr.innerHTML =
        '<td class="wide" data-l="Арендатор">' + esc(r.tenant.name) + '</td>' +
        '<td data-l="Помещение">' + r.id + ', ' + r.area + ' кв. м</td>' +
        '<td data-l="Договор">№ ' + esc(r.tenant.contractNo) + '</td>' +
        '<td class="num" data-l="Платёж">' + (isOccupied(r) ? money(r.monthly) : 'нет') + '</td>' +
        '<td class="num" data-l="Долг">' + (r.debt
          ? '<span style="color:var(--coral);font-weight:700">' + money(r.debt) + '</span>' : 'нет') + '</td>' +
        '<td data-l="Статус"><span class="badge ' + badge[1] + '">' + badge[0] + '</span></td>';
      clickable(tr, function () { selectRoom(r); }, 'Карточка: ' + r.tenant.name);
      tb.append(tr);
    });
    t.append(tb);
    wrap.append(t);
    pad.append(wrap);
    pad.append(el('div', 'note', 'Показано ' + list.length + ' из ' + tenants().length +
      ' арендаторов. Суммы модельные.'));
    v.append(pad);
  }

  /* ─── экран: начисления и счета ───────────────────────── */

  function viewBills(v) {
    var pad = el('div', 'pad wrap');
    pad.append(el('h1', 'h1', 'Начисления и счета за сентябрь'));
    pad.append(el('p', 'sub',
      'Аренда по договору, коммунальные по счётчикам, допуслуги по факту. ' +
      'Счета выставляются пачкой и уходят в WhatsApp, оплата отмечается в один клик, ЭСФ выписывается тут же.'));

    var list = tenants().filter(function (r) { return r.tenant.contractEnd >= NEXT; });
    var totals = { rent: 0, util: 0, extra: 0, total: 0, issued: 0, paid: 0, esf: 0 };
    list.forEach(function (r) {
      var inv = invoiceOf(r);
      totals.rent += inv.rent; totals.util += inv.util;
      totals.extra += inv.extra; totals.total += inv.total;
      if (r.cells[NEXT].s !== 'plan') totals.issued += inv.total;
      if (r.cells[NEXT].s === 'paid') totals.paid += inv.total;
      if (r.tenant.esf) totals.esf++;
    });

    var k = el('div', 'kpis');
    [['К начислению', mln(totals.total) + ' ₸', list.length + ' договоров', ''],
     ['Аренда', mln(totals.rent) + ' ₸', 'по ставкам договоров', ''],
     ['Коммунальные', fmt(totals.util) + ' ₸', 'по показаниям счётчиков', ''],
     ['Допуслуги', fmt(totals.extra) + ' ₸', 'парковка, уборка, интернет', ''],
     ['Выставлено', mln(totals.issued) + ' ₸', totals.issued ? 'счета ушли арендаторам' : 'счета ещё не выставлены', totals.issued ? 'good' : 'warn'],
     ['ЭСФ выписано', totals.esf + ' из ' + list.length, 'срок 15 календарных дней', totals.esf < list.length ? 'warn' : 'good']
    ].forEach(function (p) {
      var c = el('div', 'kpi ' + p[3]);
      c.append(el('div', 'l', p[0]), el('div', 'v', p[1]), el('div', 's', p[2]));
      k.append(c);
    });
    pad.append(k);

    var acts = el('div', '');
    acts.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 4px';
    var b1 = el('button', 'btn pri', 'Выставить все счета за сентябрь');
    b1.onclick = issueInvoices;
    var b2 = el('button', 'btn wa', 'Отправить счета в WhatsApp');
    b2.onclick = function () {
      var n = list.filter(function (r) { return r.cells[NEXT].s !== 'plan'; }).length;
      toast(n ? 'Демонстрация: ' + n + ' сообщений со счётом и ссылкой на оплату Kaspi отправлено.'
              : 'Сначала выставьте счета, отправлять пока нечего.');
    };
    var b3 = el('button', 'btn gho', 'Выписать ЭСФ пакетом');
    b3.onclick = issueEsfAll;
    acts.append(b1, b2, b3);
    pad.append(acts);

    var wrap = el('div', 'tbl-wrap cards');
    var t = el('table', 'tbl cards');
    t.innerHTML = '<thead><tr><th>Арендатор</th><th>Помещение</th><th class="num">Аренда</th>' +
      '<th class="num">Коммуналка</th><th class="num">Услуги</th><th class="num">Итого</th>' +
      '<th>Счёт</th><th>ЭСФ</th><th></th></tr></thead>';
    var tb = el('tbody');
    list.forEach(function (r) {
      var inv = invoiceOf(r);
      var s = r.cells[NEXT].s;
      var badge = s === 'plan' ? ['Не выставлен', 'b-fix']
                : s === 'paid' ? ['Оплачен', 'b-ok'] : ['Выставлен', 'b-due'];
      var tr = el('tr');
      tr.innerHTML =
        '<td class="wide" data-l="Арендатор">' + esc(r.tenant.name) + '</td>' +
        '<td data-l="Помещение">' + r.id + '</td>' +
        '<td class="num" data-l="Аренда">' + fmt(inv.rent) + '</td>' +
        '<td class="num" data-l="Коммуналка">' + fmt(inv.util) + '</td>' +
        '<td class="num" data-l="Услуги">' + fmt(inv.extra) + '</td>' +
        '<td class="num" data-l="Итого"><b>' + fmt(inv.total) + '</b></td>' +
        '<td data-l="Счёт"><span class="badge ' + badge[1] + '">' + badge[0] + '</span></td>' +
        '<td data-l="ЭСФ">' + (r.tenant.esf ? '<span class="badge b-ok">Выписана</span>'
                                            : '<span class="badge b-fix">Нет</span>') + '</td>';
      var td = el('td', '');
      td.setAttribute('data-l', 'Действие');
      var btn = el('button', 'btn gho', s === 'plan' ? 'Выставить' : s === 'due' ? 'Отметить оплату' : 'Открыть');
      btn.onclick = function () {
        if (s === 'plan') {
          r.cells[NEXT].s = 'due'; r.cells[NEXT].sum = inv.total; render();
          toast('Демонстрация: счёт на ' + money(inv.total) + ' сформирован и отправлен.');
        } else if (s === 'due') {
          markPaid(r, NEXT);
        } else {
          /* На этом экране панели нет, поэтому карточку открываем там, где она есть. */
          selectRoom(r, 'tenants');
        }
      };
      td.append(btn);
      tr.append(td);
      tb.append(tr);
    });
    t.append(tb);
    wrap.append(t);
    pad.append(wrap);

    /* Разбор одного счёта: показываем, откуда берутся коммунальные. */
    var sample = list.filter(function (r) { return r.tenant.extras.parking > 0; })[0] || list[0];
    if (sample) {
      var u = utilities(sample), x = extras(sample), m = sample.tenant.meters;
      pad.append(el('div', 'h2', 'Как считается коммуналка, на примере помещения ' + sample.id));
      var card = el('div', 'card');
      card.innerHTML =
        '<div class="kv"><span>Электричество, счётчик</span><b>' + fmt(m.powerPrev) + ' на ' + fmt(m.powerCur) +
          ', расход ' + fmt(m.powerCur - m.powerPrev) + ' кВт*ч по ' + D.TARIFF.power + ' ₸</b></div>' +
        '<div class="kv"><span>Электричество, сумма</span><b>' + money(u.power) + '</b></div>' +
        '<div class="kv"><span>Вода, счётчик</span><b>' + m.waterPrev + ' на ' + m.waterCur +
          ', расход ' + Math.round((m.waterCur - m.waterPrev) * 10) / 10 + ' куб. м по ' + D.TARIFF.water + ' ₸</b></div>' +
        '<div class="kv"><span>Вода, сумма</span><b>' + money(u.water) + '</b></div>' +
        '<div class="kv"><span>Отопление, по площади</span><b>' + money(u.heat) + '</b></div>' +
        '<div class="kv"><span>Парковка</span><b>' + sample.tenant.extras.parking + ' места, ' + money(x.parking) + '</b></div>' +
        '<div class="kv"><span>Уборка и интернет</span><b>' + money(x.cleaning + x.internet) + '</b></div>' +
        '<div class="kv"><span>Итого сверх аренды</span><b>' + money(u.total + x.total) + '</b></div>';
      pad.append(card);
    }

    pad.append(el('div', 'src-note',
      '<b>Почему ЭСФ здесь, а не в бухгалтерской программе.</b> Плательщик НДС обязан выписывать ' +
      'электронные счета-фактуры в общем порядке (ст. 207 НК РК), срок 15 календарных дней с даты ' +
      'оборота (ст. 208 НК РК), за нарушение штраф от 20 до 150 МРП в зависимости от размера бизнеса ' +
      '(ст. 280-1 КоАП РК). Это регулярный механический процесс, который обычно делают руками. ' +
      'Источник разобран в нашем каталоге рынка, раздел 2.8.'));

    pad.append(el('div', 'note',
      'Все суммы, показания счётчиков и тарифы в этой демонстрации модельные: ' +
      'они правдоподобны по порядку величины, но взяты не из учётной системы. ' +
      'На вашем объекте считаются ваши.'));
    v.append(pad);
  }

  /* ─── экран: напоминания ──────────────────────────────── */

  function viewRemind(v) {
    var pad = el('div', 'pad wrap');
    pad.append(el('h1', 'h1', 'Напоминания об оплате'));
    pad.append(el('p', 'sub',
      'Цепочка из четырёх шагов идёт по расписанию и без участия человека: счёт, напоминание за день, ' +
      'уведомление о просрочке, претензия. Канал, это WhatsApp, потому что деловой разговор в Казахстане идёт там.'));

    var list = debtors();
    if (!list.length) {
      pad.append(el('div', 'empty', 'Должников нет. В демонстрации это значит, что вы уже отметили все оплаты.'));
      v.append(pad);
      return;
    }

    var cur = null;
    list.forEach(function (r) { if (r.id === state.debtor) cur = r; });
    if (!cur) cur = list[0];
    state.debtor = cur.id;

    var k = el('div', 'kpis');
    var sum = list.reduce(function (s, r) { return s + r.debt; }, 0);
    var deep = list.filter(function (r) { return overdueDays(r) > 30; });
    [['Должников', list.length + '', 'из ' + activeTenants().length + ' арендаторов', 'bad'],
     ['Сумма долга', mln(sum) + ' ₸', 'модельная величина', 'bad'],
     ['Просрочка больше 30 дней', deep.length + '', 'здесь уже нужна претензия', 'warn'],
     ['Самая старая', Math.max.apply(null, list.map(overdueDays)) + ' дней', 'помещение ' +
       list.slice().sort(function (a, b) { return overdueDays(b) - overdueDays(a); })[0].id, 'bad']
    ].forEach(function (p) {
      var c = el('div', 'kpi ' + p[3]);
      c.append(el('div', 'l', p[0]), el('div', 'v', p[1]), el('div', 's', p[2]));
      k.append(c);
    });
    pad.append(k);

    pad.append(el('div', 'h2', 'Кому напоминаем'));
    var chips = el('div', '');
    chips.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px';
    list.forEach(function (r) {
      var b = el('button', 'chip', esc(r.tenant.name) + '<span class="n">' + overdueDays(r) + ' дн.</span>');
      b.setAttribute('aria-pressed', r.id === cur.id);
      b.onclick = function () { state.debtor = r.id; render(); };
      chips.append(b);
    });
    pad.append(chips);

    var card = el('div', 'card');
    card.innerHTML =
      '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline">' +
        '<div><div style="font-size:17px;font-weight:700">' + esc(cur.tenant.name) + '</div>' +
        '<div style="font-size:12.5px;color:var(--muted)">Помещение ' + cur.id + ', договор № ' +
          esc(cur.tenant.contractNo) + ', ' + esc(cur.tenant.contact) + ', ' + esc(cur.tenant.phone) + '</div></div>' +
        '<div style="text-align:right"><div style="font-size:20px;font-weight:700;color:var(--coral)">' +
          money(cur.debt) + '</div><div style="font-size:12px;color:var(--muted)">просрочка ' +
          overdueDays(cur) + ' дней</div></div>' +
      '</div>';

    var chain = el('div', 'chain');
    CHAIN.forEach(function (s, i) {
      var cls = i < cur.tenant.reminderStage ? 'step done'
              : i === cur.tenant.reminderStage ? 'step next' : 'step';
      chain.append(el('div', cls, '<b>' + s.title + '</b>' + s.when));
    });
    card.append(chain);

    var acts = el('div', '');
    acts.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 4px';
    if (cur.tenant.reminderStage < CHAIN.length) {
      var b = el('button', 'btn wa', 'Отправить: ' + CHAIN[cur.tenant.reminderStage].title);
      b.onclick = function () { sendNextReminder(cur); };
      acts.append(b);
    } else {
      acts.append(el('div', 'note', 'Цепочка пройдена целиком. Дальше вопрос уходит юристу.'));
    }
    var bp = el('button', 'btn sec', 'Отметить оплату');
    bp.onclick = function () { payAllDebt(cur); };
    var ball = el('button', 'btn gho', 'Запустить цепочку по всем должникам');
    ball.onclick = function () {
      var n = 0;
      list.forEach(function (r) { if (r.tenant.reminderStage < CHAIN.length) { sendNextReminderQuiet(r); n++; } });
      render();
      toast(n
        ? 'Демонстрация: следующий шаг цепочки отправлен ' + n + ' должникам одним действием.'
        : 'У всех должников цепочка пройдена целиком, дальше вопрос уходит юристу.');
    };
    acts.append(bp, ball);
    card.append(acts);
    pad.append(card);

    pad.append(el('div', 'h2', 'Переписка'));
    var chat = el('div', 'chat');
    if (!cur.tenant.log.length) {
      chat.append(el('div', 'note', 'Пока пусто. Нажмите "Отправить", чтобы увидеть текст сообщения, ' +
        'который уйдёт арендатору.'));
    } else {
      cur.tenant.log.forEach(function (m) {
        var d = el('div', 'msg out');
        d.innerHTML = '<div class="who">' + esc(m.title) + '</div>' + esc(m.text) +
          '<div class="when">' + esc(m.when) + '</div>';
        chat.append(d);
      });
      if (cur.tenant.reminderStage >= 2) {
        var ans = el('div', 'msg');
        ans.innerHTML = esc('Добрый день. Оплату проведём в пятницу, подтверждение пришлю.') +
          '<div class="when">получено</div>';
        chat.append(ans);
      }
    }
    pad.append(chat);

    pad.append(el('div', 'src-note',
      '<b>Что известно про напоминания из независимых источников.</b> В полевом рандомизированном ' +
      'эксперименте по напоминаниям заёмщикам вероятность вовремя внести платёж выросла на 7-9 процентов, ' +
      'а средняя просрочка сократилась примерно на 2 дня в месяц (Cadena, Schoar, NBER Working Paper 17020). ' +
      'В другом эксперименте напоминание должникам с просрочкой 30 дней повысило долю полностью погасивших ' +
      'задолженность с 61,9 до 64,3 процента (Journal of Banking and Finance). ' +
      'Эти работы про кредиты, а не про аренду, и переносить проценты один в один нельзя. ' +
      'Направление эффекта подтверждено независимо, и для разговора этого достаточно.'));

    pad.append(el('div', 'note',
      'Подключение WhatsApp Business API идёт через официальных партнёров Meta, ' +
      'диалог со стороны компании начинается шаблонным сообщением с модерацией, ' +
      'счёт за шаблоны и сессии платится Meta. Это закладывается в смету, а не обещается бесплатным.'));
    v.append(pad);
  }

  function sendNextReminderQuiet(r) {
    var t = r.tenant;
    if (t.reminderStage >= CHAIN.length) return;
    var step = CHAIN[t.reminderStage];
    t.log.push({ text: step.text(r), when: step.when, out: true, title: step.title });
    t.reminderStage++;
  }

  /* ─── экран: договоры и календарь ─────────────────────── */

  function viewContracts(v) {
    var pad = el('div', 'pad wrap');
    pad.append(el('h1', 'h1', 'Реестр договоров с календарём'));
    pad.append(el('p', 'sub',
      'Сроки, индексации и каникулы в одном месте. Ответственный получает уведомление заранее, ' +
      'а не в день, когда договор закончился.'));

    /* Сначала действующие договоры по близости срока, закончившиеся в конце.
       Сортировка просто по дате ставила наверх тех, кто уже съехал, то есть
       ровно то, чем заниматься не надо. */
    var list = tenants().slice().sort(function (a, b) {
      var aa = isOccupied(a) ? 0 : 1, bb = isOccupied(b) ? 0 : 1;
      if (aa !== bb) return aa - bb;
      return a.tenant.contractEnd - b.tenant.contractEnd;
    });

    var k = el('div', 'kpis');
    var forg = forgottenIndex();
    var active = activeTenants();
    var hol = active.filter(function (r) { return r.tenant.holidays > 0; });
    [['Действующих договоров', active.length + '', 'на ' + fmt(active.reduce(function (s, r) { return s + r.area; }, 0)) + ' кв. м, всего в реестре ' + list.length, ''],
     ['Заканчиваются до февраля', ending().length + '', 'нужна пролонгация', 'warn'],
     ['Индексаций пропущено', forg.length + '', 'разбор на экране аудита', forg.length ? 'bad' : 'good'],
     ['С каникулами', hol.length + '', 'нулевая аренда на въезде', '']
    ].forEach(function (p) {
      var c = el('div', 'kpi ' + p[3]);
      c.append(el('div', 'l', p[0]), el('div', 'v', p[1]), el('div', 's', p[2]));
      k.append(c);
    });
    pad.append(k);

    /* Календарь событий: та же ось месяцев, что в шахматке. */
    pad.append(el('div', 'h2', 'Календарь событий на 12 месяцев'));
    var cal = el('div', 'tbl-wrap');
    var ct = el('table', 'tbl');
    var head = '<thead><tr><th>Событие</th>';
    D.MONTHS.forEach(function (m, i) {
      head += '<th class="num" style="' + (i === NOW ? 'color:var(--indigo)' : '') + '">' + m[0] + '</th>';
    });
    head += '</tr></thead>';
    ct.innerHTML = head;
    var ctb = el('tbody');
    /* Третья строка, это то, ради чего календарь нужен: срок, когда пора
       начинать разговор о продлении. Каникулы сюда не ставятся: в данных
       лежит их длительность, а не месяц окончания, и вывести дату из неё
       нельзя. Каникулы показаны в таблице ниже, там это честно. */
    /* Окончание договора, это факт, поэтому считается по всему реестру, включая
       закончившиеся. Индексация и пролонгация, это будущие действия, и делать
       их по съехавшему арендатору не с кем: там только действующие. */
    [['Окончание договора', function (r, i) { return r.tenant.contractEnd === i; }, 'var(--coral)', list],
     ['Индексация ставки', function (r, i) { return r.tenant.indexMonth === i && !r.tenant.indexApplied; }, 'var(--amber)', active],
     ['Начать пролонгацию, за 60 дней', function (r, i) {
       return r.tenant.contractEnd < 12 && r.tenant.contractEnd - 2 === i && i >= 0;
     }, 'var(--indigo-2)', active]
    ].forEach(function (row) {
      var tr = el('tr');
      var html = '<td><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:' +
        row[2] + ';margin-right:7px"></span>' + row[0] + '</td>';
      D.MONTHS.forEach(function (m, i) {
        var n = row[3].filter(function (r) { return row[1](r, i); }).length;
        html += '<td class="num" style="' + (n ? 'font-weight:700;color:' + row[2] : 'color:var(--muted)') +
          (i === NOW ? ';background:#F1F1FA' : '') + '">' + (n || '0') + '</td>';
      });
      tr.innerHTML = html;
      ctb.append(tr);
    });
    ct.append(ctb);
    cal.append(ct);
    pad.append(cal);

    pad.append(el('div', 'h2', 'Договоры'));
    var wrap = el('div', 'tbl-wrap cards');
    var t = el('table', 'tbl cards');
    t.innerHTML = '<thead><tr><th>Арендатор</th><th>Помещение</th><th>№ договора</th>' +
      '<th>Срок до</th><th>Индексация</th><th>Каникулы</th><th>Ответственный</th><th></th></tr></thead>';
    var tb = el('tbody');
    list.forEach(function (r) {
      var t2 = r.tenant;
      var soon = t2.contractEnd >= NOW && t2.contractEnd < 12;
      var idx = t2.indexApplied
        ? '<span class="badge b-ok">Применена, ' + t2.indexPct + '%</span>'
        : t2.indexForgotten
          ? '<span class="badge b-debt">Пропущена, ' + D.MONTHS[t2.indexMonth][0] + '</span>'
          : D.MONTHS[t2.indexMonth][0] + ', ' + t2.indexPct + '%';
      var tr = el('tr');
      tr.innerHTML =
        '<td class="wide" data-l="Арендатор">' + esc(t2.name) + '</td>' +
        '<td data-l="Помещение">' + r.id + '</td>' +
        '<td data-l="Договор">№ ' + esc(t2.contractNo) + '</td>' +
        '<td data-l="Срок до">' + (t2.contractEnd < 12
          ? (soon ? '<b style="color:var(--coral)">' + monthName(t2.contractEnd) + '</b>' : monthName(t2.contractEnd))
          : 'дальше горизонта') + '</td>' +
        '<td data-l="Индексация">' + idx + '</td>' +
        '<td data-l="Каникулы">' + (t2.holidays ? t2.holidays + ' мес.' : 'нет') + '</td>' +
        '<td data-l="Ответственный">' + esc(t2.responsible) + '</td>';
      var td = el('td', '');
      td.setAttribute('data-l', 'Действие');
      var b = el('button', 'btn gho', soon ? 'Пролонгация' : 'Уведомить');
      b.onclick = function () {
        toast(soon
          ? 'Демонстрация: задача "' + esc(t2.responsible) + '" на продление за 60 дней до ' +
            monthName(t2.contractEnd) + ', с индексацией на ' + t2.indexPct + '%.'
          : 'Демонстрация: уведомление ответственному по договору № ' + t2.contractNo + ' поставлено в календарь.');
      };
      td.append(b);
      tr.append(td);
      tb.append(tr);
    });
    t.append(tb);
    wrap.append(t);
    pad.append(wrap);
    pad.append(el('div', 'note', 'Номера договоров, сроки и проценты индексации вымышлены.'));
    v.append(pad);
  }

  /* ─── экран: аудит договоров нейросетью ───────────────── */

  var DEMO_FILES = [
    'Договор аренды 1301-24 Алтын Курылыс.pdf',
    'Договор аренды 1305-25 Береке скан.pdf',
    'Допсоглашение 1305-25 индексация.pdf',
    'Договор аренды 1402-24 Кодек Софт.pdf',
    'Скан договора 1509 Дент Сити.jpg',
    'Договор 1601-26 Нур Медиа.docx',
    'Договор аренды 1204-24 Sapa Consulting.pdf',
    'Допсоглашение каникулы 1204-24.pdf',
    'Договор 1706-25 Юг Энерго скан.pdf',
    'Договор аренды 1808-24 Мега Дистрибьюшн.pdf',
    'Скан 1903 Восток Фарм страницы 1-14.pdf',
    'Договор 2001-25 Гранд Мебель.pdf'
  ];

  function runAudit(names) {
    state.auditState = 'run';
    state.auditFiles = (names && names.length ? names : DEMO_FILES).map(function (n) {
      return { name: n, done: false };
    });
    render();
    var i = 0;
    var tick = setInterval(function () {
      if (i >= state.auditFiles.length) {
        clearInterval(tick);
        state.auditState = 'done';
        render();
        toast('Разбор закончен: ' + state.auditFiles.length + ' файлов, найдено ' +
              forgottenIndex().length + ' пропущенных индексаций и ' + ending().length +
              ' заканчивающихся договоров.');
        return;
      }
      state.auditFiles[i].done = true;
      i++;
      var p = document.querySelector('.prog i');
      if (p) p.style.width = Math.round(i / state.auditFiles.length * 100) + '%';
      var f = document.querySelectorAll('.file')[i - 1];
      if (f) { f.classList.add('ok'); var st = f.querySelector('.st'); if (st) st.textContent = 'разобран'; }
    }, 260);
  }

  function viewAudit(v) {
    var pad = el('div', 'pad wrap');
    pad.append(el('h1', 'h1', 'Аудит договоров нейросетью'));
    pad.append(el('p', 'sub',
      'Отдаёте пачку PDF и сканов, получаете таблицу условий и два списка: ' +
      'где забыли индексацию и что заканчивается. На своих файлах, а не на демонстрационных.'));

    if (state.auditState === 'idle') {
      var drop = el('div', 'drop');
      drop.innerHTML =
        '<div class="big">Перетащите сюда договоры</div>' +
        '<div class="sm">PDF, сканы, фотографии страниц, документы Word.<br>' +
        'В демонстрации файлы никуда не загружаются: разбор показывается на подготовленных данных.</div>';
      var b = el('button', 'btn pri', 'Взять демонстрационную пачку, ' + DEMO_FILES.length + ' файлов');
      b.onclick = function () { runAudit(null); };
      drop.append(b);

      drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('hot'); });
      drop.addEventListener('dragleave', function () { drop.classList.remove('hot'); });
      drop.addEventListener('drop', function (e) {
        e.preventDefault();
        drop.classList.remove('hot');
        var names = [];
        if (e.dataTransfer && e.dataTransfer.files) {
          for (var i = 0; i < e.dataTransfer.files.length; i++) names.push(e.dataTransfer.files[i].name);
        }
        runAudit(names);
      });
      pad.append(drop);
      pad.append(el('div', 'src-note',
        '<b>Что за этим стоит.</b> JLL внедрила автоматический разбор договоров и, по разбору кейса, ' +
        'сократила ручной труд по проверке примерно на 60 процентов и нашла более 1 млн долларов в ' +
        'пропущенных пунктах об индексации. Это отраслевой кейс, а не наш результат: ' +
        'внедрений в бизнес-центре у нас пока ноль, и первый пилот мы делаем дёшево ради кейса.'));
      v.append(pad);
      return;
    }

    var prog = el('div', '');
    var doneN = state.auditFiles.filter(function (f) { return f.done; }).length;
    prog.innerHTML = '<div class="prog"><i style="width:' +
      Math.round(doneN / state.auditFiles.length * 100) + '%"></i></div>';
    var st = el('div', 'note', state.auditState === 'run'
      ? 'Разбираем ' + state.auditFiles.length + ' файлов, извлекаем стороны, площадь, ставку, срок, индексацию, каникулы и штрафы.'
      : 'Разобрано ' + state.auditFiles.length + ' файлов.');
    prog.append(st);
    var files = el('div', 'files');
    state.auditFiles.forEach(function (f) {
      var d = el('div', 'file' + (f.done ? ' ok' : ''));
      d.innerHTML = '<span class="nm">' + esc(f.name) + '</span><span class="st">' +
        (f.done ? 'разобран' : 'в очереди') + '</span>';
      files.append(d);
    });
    prog.append(files);
    pad.append(prog);

    if (state.auditState !== 'done') { v.append(pad); return; }

    /* Найденное: сначала деньги, потом таблица условий. */
    var forg = forgottenIndex();
    var lost = forg.reduce(function (s, r) {
      var months = NOW - r.tenant.indexMonth + 1;
      return s + Math.round(r.monthly * r.tenant.indexPct / 100) * months;
    }, 0);

    pad.append(el('div', 'h2', 'Забытые индексации'));
    if (!forg.length) {
      pad.append(el('div', 'card', 'Пропущенных индексаций не осталось: вы применили их все.'));
    } else {
      var c1 = el('div', 'card');
      c1.innerHTML = '<div style="font-size:15px;line-height:1.6">Найдено <b>' + forg.length +
        '</b> договоров, где срок индексации прошёл, а ставка не менялась. ' +
        'Недоначислено с начала года примерно <b style="color:var(--coral)">' + money(lost) + '</b>.</div>';
      pad.append(c1);

      var w1 = el('div', 'tbl-wrap cards');
      var t1 = el('table', 'tbl cards');
      t1.innerHTML = '<thead><tr><th>Арендатор</th><th>Помещение</th><th>Срок был</th>' +
        '<th class="num">Ставка</th><th class="num">Процент</th><th class="num">Недоначислено</th><th></th></tr></thead>';
      var tb1 = el('tbody');
      forg.forEach(function (r) {
        var months = NOW - r.tenant.indexMonth + 1;
        var miss = Math.round(r.monthly * r.tenant.indexPct / 100) * months;
        var tr = el('tr');
        tr.innerHTML =
          '<td class="wide" data-l="Арендатор">' + esc(r.tenant.name) + '</td>' +
          '<td data-l="Помещение">' + r.id + '</td>' +
          '<td data-l="Срок был">' + monthName(r.tenant.indexMonth) + ', ' + months + ' мес. назад</td>' +
          '<td class="num" data-l="Ставка">' + fmt(r.rate) + '</td>' +
          '<td class="num" data-l="Процент">' + r.tenant.indexPct + '%</td>' +
          '<td class="num" data-l="Недоначислено"><b style="color:var(--coral)">' + fmt(miss) + '</b></td>';
        var td = el('td', '');
        td.setAttribute('data-l', 'Действие');
        var b = el('button', 'btn danger', 'Применить');
        b.onclick = function () { applyIndexation(r); };
        td.append(b);
        tr.append(td);
        tb1.append(tr);
      });
      t1.append(tb1);
      w1.append(t1);
      pad.append(w1);
    }

    pad.append(el('div', 'h2', 'Заканчиваются в ближайшие месяцы'));
    var end = ending();
    var w2 = el('div', 'tbl-wrap cards');
    var t2 = el('table', 'tbl cards');
    t2.innerHTML = '<thead><tr><th>Арендатор</th><th>Помещение</th><th>Заканчивается</th>' +
      '<th class="num">Платёж</th><th>Ответственный</th></tr></thead>';
    var tb2 = el('tbody');
    end.forEach(function (r) {
      var tr = el('tr');
      tr.innerHTML =
        '<td class="wide" data-l="Арендатор">' + esc(r.tenant.name) + '</td>' +
        '<td data-l="Помещение">' + r.id + '</td>' +
        '<td data-l="Заканчивается"><b style="color:var(--coral)">' + monthName(r.tenant.contractEnd) + '</b></td>' +
        '<td class="num" data-l="Платёж">' + money(r.monthly) + '</td>' +
        '<td data-l="Ответственный">' + esc(r.tenant.responsible) + '</td>';
      tb2.append(tr);
    });
    t2.append(tb2);
    w2.append(t2);
    pad.append(w2);

    pad.append(el('div', 'h2', 'Извлечённые условия'));
    var w3 = el('div', 'tbl-wrap cards');
    var t3 = el('table', 'tbl cards');
    t3.innerHTML = '<thead><tr><th>Арендатор</th><th>Помещение</th><th class="num">Площадь</th>' +
      '<th class="num">Ставка</th><th>Срок</th><th>Индексация</th><th>Каникулы</th></tr></thead>';
    var tb3 = el('tbody');
    tenants().slice(0, 14).forEach(function (r) {
      var tr = el('tr');
      tr.innerHTML =
        '<td class="wide" data-l="Арендатор">' + esc(r.tenant.name) + '</td>' +
        '<td data-l="Помещение">' + r.id + '</td>' +
        '<td class="num" data-l="Площадь">' + r.area + ' кв. м</td>' +
        '<td class="num" data-l="Ставка">' + fmt(r.rate) + '</td>' +
        '<td data-l="Срок">' + (r.tenant.contractEnd < 12 ? monthName(r.tenant.contractEnd) : 'дальше горизонта') + '</td>' +
        '<td data-l="Индексация">' + D.MONTHS[r.tenant.indexMonth][0] + ', ' + r.tenant.indexPct + '%</td>' +
        '<td data-l="Каникулы">' + (r.tenant.holidays ? r.tenant.holidays + ' мес.' : 'нет') + '</td>';
      tb3.append(tr);
    });
    t3.append(tb3);
    w3.append(t3);
    pad.append(w3);

    var again = el('button', 'btn gho', 'Разобрать заново');
    again.style.marginTop = '12px';
    again.onclick = function () { state.auditState = 'idle'; state.auditFiles = []; render(); };
    pad.append(again);

    pad.append(el('div', 'note',
      'Показаны первые 14 строк. В демонстрации разбор выполняется на подготовленных данных: ' +
      'модель здесь не работает, и обещать её точность по одному экрану нельзя. ' +
      'На пилоте разбираются ваши файлы, и мы показываем, что нашли, до того как вы платите.'));
    v.append(pad);
  }

  /* ─── экран: витрина свободных площадей ───────────────── */

  function floorPlan(floorNo) {
    var rooms = D.ROOMS.filter(function (r) { return r.floor === floorNo; });
    var W = 760, H = 250, pad = 12, corr = 44;
    var half = Math.ceil(rooms.length / 2);
    var top = rooms.slice(0, half), bot = rooms.slice(half);
    var rowH = (H - corr - pad * 2) / 2;

    function row(list, y) {
      var total = list.reduce(function (s, r) { return s + r.area; }, 0);
      var x = pad, out = '';
      list.forEach(function (r) {
        var w = (W - pad * 2) * (r.area / total);
        var st = statusOf(r);
        var fill = st === 'free' ? '#FDE9E8' : st === 'book' ? '#E8E7FC'
                 : st === 'fix' ? '#EDEDF2' : st === 'debt' ? '#FBE2E1' : '#EDEDFA';
        var stroke = st === 'free' ? '#EE4F49' : st === 'debt' ? '#EE4F49' : '#C9C9DD';
        out += '<g class="rm" data-room="' + r.id + '">' +
          '<rect x="' + x.toFixed(1) + '" y="' + y + '" width="' + (w - 3).toFixed(1) + '" height="' + rowH +
            '" rx="4" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.4"/>' +
          '<text x="' + (x + w / 2 - 1.5).toFixed(1) + '" y="' + (y + rowH / 2 - 3) +
            '" text-anchor="middle" font-size="13" font-weight="700" fill="#14141F">' + r.id + '</text>' +
          '<text x="' + (x + w / 2 - 1.5).toFixed(1) + '" y="' + (y + rowH / 2 + 13) +
            '" text-anchor="middle" font-size="10.5" fill="#8B8B9E">' + r.area + ' кв. м</text>' +
          '<title>' + esc('Помещение ' + r.id + ', ' + r.area + ' кв. м, ' + D.ST[st].t) + '</title>' +
          '</g>';
        x += w;
      });
      return out;
    }

    var svg = '<svg class="plan" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="План этажа ' + floorNo + '">' +
      row(top, pad) +
      '<rect x="' + pad + '" y="' + (pad + rowH) + '" width="' + (W - pad * 2) + '" height="' + corr +
        '" fill="#F7F7FB"/>' +
      '<text x="' + (W / 2) + '" y="' + (pad + rowH + corr / 2 + 4) +
        '" text-anchor="middle" font-size="11" letter-spacing="2" fill="#B6B6C6">КОРИДОР, ЛИФТЫ, САНУЗЛЫ</text>' +
      row(bot, pad + rowH + corr) +
      '</svg>';
    return svg;
  }

  function viewMarket(v) {
    var pad = el('div', 'pad wrap');
    pad.append(el('h1', 'h1', 'Витрина свободных площадей'));
    pad.append(el('p', 'sub',
      'Так объект видит потенциальный арендатор. Список берётся из той же шахматки, ' +
      'поэтому "свободно" на странице означает "свободно" в системе, а не то, что было полгода назад.'));

    var free = freeRooms();
    var k = el('div', 'kpis');
    [['Свободно', free.length + ' помещений', fmt(free.reduce(function (s, r) { return s + r.area; }, 0)) + ' кв. м', ''],
     ['Упускаем в месяц', fmt(free.reduce(function (s, r) { return s + r.monthly; }, 0)) + ' ₸', 'при сдаче по прайсу', 'bad'],
     ['Простой за 6 мес.', mln(D.ROOMS.reduce(function (s, r) { return s + r.monthly * r.idle; }, 0)) + ' ₸', 'недополучено на пустых площадях', 'bad'],
     ['Освобождается', ending().length + ' помещений', 'договоры заканчиваются', 'warn']
    ].forEach(function (p) {
      var c = el('div', 'kpi ' + p[3]);
      c.append(el('div', 'l', p[0]), el('div', 'v', p[1]), el('div', 's', p[2]));
      k.append(c);
    });
    pad.append(k);

    pad.append(el('div', 'h2', 'План этажа'));
    var chips = el('div', '');
    chips.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px';
    D.FLOORS.forEach(function (f) {
      var n = D.ROOMS.filter(function (r) { return r.floor === f.n && statusOf(r) === 'free'; }).length;
      var b = el('button', 'chip', 'Этаж ' + f.n + (n ? '<span class="n">' + n + '</span>' : ''));
      b.setAttribute('aria-pressed', state.planFloor === f.n);
      b.onclick = function () { state.planFloor = f.n; render(); };
      chips.append(b);
    });
    pad.append(chips);

    var planBox = el('div', '');
    planBox.innerHTML = floorPlan(state.planFloor);
    planBox.querySelectorAll('.rm').forEach(function (g) {
      g.addEventListener('click', function () {
        var id = +g.getAttribute('data-room');
        D.ROOMS.forEach(function (r) { if (r.id === id) selectRoom(r, 'grid'); });
      });
    });
    pad.append(planBox);
    pad.append(el('div', 'note',
      'Розовым отмечены свободные помещения этажа ' + state.planFloor +
      '. Нажатие открывает помещение в шахматке.'));

    pad.append(el('div', 'h2', 'Свободные помещения'));
    if (!free.length) {
      pad.append(el('div', 'card', 'Свободных помещений нет: всё сдано или забронировано.'));
    } else {
      var offers = el('div', 'offers');
      free.forEach(function (r) {
        var o = el('div', 'offer');
        o.innerHTML = '<div class="no">Помещение ' + r.id + '</div>' +
          '<div class="ar">Этаж ' + r.floor + ', ' + r.area + ' кв. м, ' + fmt(r.rate) + ' ₸ за кв. м</div>' +
          '<div class="pr">' + money(r.monthly) + ' в месяц</div>';
        var b = el('button', 'btn pri', 'Забронировать');
        b.onclick = function () { bookRoom(r); };
        var b2 = el('button', 'btn gho', 'Посмотреть');
        b2.onclick = function () { selectRoom(r, 'grid'); };
        o.append(b, b2);
        offers.append(o);
      });
      pad.append(offers);
    }

    pad.append(el('div', 'h2', 'Заявка на просмотр'));
    /* Введённое держится в состоянии: выбор этажа перерисовывает экран целиком,
       и без этого набранное имя пропадало на глазах у человека. */
    var form = el('div', 'form');
    [['name', 'Как вас зовут', 'Имя и компания'],
     ['phone', 'Телефон или WhatsApp', '+7'],
     ['area', 'Какая площадь нужна', 'например, от 60 до 90 кв. м']
    ].forEach(function (f) {
      var box = el('div', '');
      var lab = el('label', '', f[1]);
      var inp = el('input');
      inp.placeholder = f[2];
      inp.value = state.lead[f[0]];
      inp.oninput = function (e) { state.lead[f[0]] = e.target.value; };
      box.append(lab, inp);
      form.append(box);
    });
    var send = el('button', 'btn pri wide', 'Отправить заявку');
    send.onclick = function () {
      var n = state.lead.name.trim();
      toast('Демонстрация: заявка' + (n ? ' от ' + n : '') + ' принята. ' +
        'На пилоте ответ уходит в WhatsApp за минуты, круглосуточно, а не на следующее утро.');
      state.lead = { name: '', phone: '', area: '' };
      render();
    };
    form.append(send);
    pad.append(form);
    pad.append(el('div', 'note',
      'Форма ничего не отправляет. Скорость ответа, это отдельный разговор: ' +
      'по исследованию Harvard Business Review 2011 года ответ в течение часа даёт кратно больше ' +
      'шансов на содержательный контакт, но конкретные множители мы до сверки с полным текстом не приводим.'));
    v.append(pad);
  }

  /* ─── экран: сводка собственнику ──────────────────────── */

  function digestText() {
    var occ = occupied(), free = freeRooms();
    var occArea = occ.reduce(function (s, r) { return s + r.area; }, 0);
    var pct = Math.round(occArea / D.RENT_AREA * 100);
    var billed = billedAt(NOW);
    var collected = collectedAt(NOW);
    var debts = debtors();
    var end = ending();

    var lines = [];
    lines.push('Сводка по объекту ' + D.OBJECT.name + ' на ' + D.TODAY + '.');
    lines.push('');
    lines.push('Занятость: ' + pct + '%, ' + fmt(occArea) + ' из ' + fmt(D.RENT_AREA) + ' кв. м.');
    lines.push('Начислено за август: ' + money(billed) + ', собрано ' + money(collected) + '.');
    lines.push('');
    if (debts.length) {
      lines.push('Не заплатили, ' + debts.length + ':');
      debts.slice(0, 5).forEach(function (r) {
        lines.push('  ' + r.tenant.name + ', помещение ' + r.id + ', ' + money(r.debt) +
          ', просрочка ' + overdueDays(r) + ' дней');
      });
      if (debts.length > 5) lines.push('  и ещё ' + (debts.length - 5) + ' в приложении');
    } else {
      lines.push('Должников нет.');
    }
    lines.push('');
    if (end.length) {
      lines.push('Освобождается, ' + end.length + ':');
      end.slice(0, 4).forEach(function (r) {
        lines.push('  помещение ' + r.id + ', ' + r.area + ' кв. м, ' + monthName(r.tenant.contractEnd));
      });
    } else {
      lines.push('В ближайшие месяцы ничего не освобождается.');
    }
    lines.push('');
    lines.push('Свободно сейчас: ' + free.length + ' помещений, ' +
      fmt(free.reduce(function (s, r) { return s + r.area; }, 0)) + ' кв. м.');
    var forg = forgottenIndex();
    if (forg.length) lines.push('Внимание: ' + forg.length + ' договоров без применённой индексации.');
    return lines.join('\n');
  }

  function viewReport(v) {
    var pad = el('div', 'pad wrap');
    pad.append(el('h1', 'h1', 'Сводка собственнику'));
    pad.append(el('p', 'sub',
      'Раз в неделю в WhatsApp, без захода в систему: заполняемость, кто не заплатил, ' +
      'что освобождается и где просрочка. Четыре вопроса, на которые владелец объекта хочет ответ.'));

    var occ = occupied(), free = freeRooms();
    var occArea = occ.reduce(function (s, r) { return s + r.area; }, 0);
    var billed = billedAt(NOW);
    var collected = collectedAt(NOW);

    var k = el('div', 'kpis');
    [['Занятость', Math.round(occArea / D.RENT_AREA * 100) + '%',
      fmt(occArea) + ' из ' + fmt(D.RENT_AREA) + ' кв. м', 'good'],
     ['Свободно', free.length + ' помещ.', fmt(free.reduce(function (s, r) { return s + r.area; }, 0)) +
      ' кв. м, упускаем ' + fmt(free.reduce(function (s, r) { return s + r.monthly; }, 0)) + ' ₸ в месяц', ''],
     ['Начислено за август', mln(billed) + ' ₸', 'собрано ' + mln(collected) + ' ₸', ''],
     ['Долг', mln(totalDebt()) + ' ₸', debtors().length + ' арендаторов с просрочкой', 'bad'],
     ['Простой за 6 мес.', mln(D.ROOMS.reduce(function (s, r) { return s + r.monthly * r.idle; }, 0)) + ' ₸',
      'недополучено на пустых площадях', 'bad'],
     ['Договоры к продлению', ending().length + '', 'истекают до февраля', 'warn']
    ].forEach(function (p) {
      var c = el('div', 'kpi ' + p[3]);
      c.append(el('div', 'l', p[0]), el('div', 'v', p[1]), el('div', 's', p[2]));
      k.append(c);
    });
    pad.append(k);

    pad.append(el('div', 'h2', 'Что уйдёт в WhatsApp в понедельник'));
    var chat = el('div', 'chat');
    var m = el('div', 'msg out');
    m.innerHTML = esc(digestText()) + '<div class="when">понедельник, 09:00</div>';
    chat.append(m);
    pad.append(chat);

    var acts = el('div', '');
    acts.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px';
    var b1 = el('button', 'btn wa', 'Отправить сводку сейчас');
    b1.onclick = function () {
      toast('Демонстрация: сводка отправлена собственнику. На пилоте она уходит по расписанию, без напоминания.');
    };
    var b2 = el('button', 'btn gho', 'Настроить расписание');
    b2.onclick = function () {
      toast('Демонстрация: сводка по понедельникам в 09:00, плюс отдельное сообщение при просрочке больше 30 дней.');
    };
    acts.append(b1, b2);
    pad.append(acts);

    pad.append(el('div', 'src-note',
      '<b>Про заполняемость и рынок.</b> По данным Colliers, приведённым Kursiv в июне 2026 года, ' +
      'занятость качественных офисов Алматы в 2025 году составляла 99 процентов в классе A+, ' +
      'по 91 в классах A и B и 86 в B+. Это Алматы, а не Шымкент: открытых данных по Шымкенту нет, ' +
      'и сравнивать ваш объект мы будем с вашей же историей, а не с чужим городом.'));

    pad.append(el('div', 'note',
      'Все суммы в сводке пересчитываются от текущего состояния демонстрации. ' +
      'Отметьте оплату на любом экране и вернитесь сюда, текст сообщения изменится.'));
    v.append(pad);
  }

  /* ─── экран: состав ───────────────────────────────────── */

  function viewScope(v) {
    var pad = el('div', 'pad wrap');
    pad.append(el('h1', 'h1', 'Состав демонстрации'));
    pad.append(el('p', 'sub',
      'Семь пунктов технического задания и где каждый из них лежит. ' +
      'Раздел нужен, чтобы на встрече не пересказывать список словами.'));

    var rows = [
      ['1', 'Аудит договоров нейросетью', 'Аудит ИИ',
       'Пачка файлов, таблица условий, список забытых индексаций с суммой недоначисления, список заканчивающихся договоров', 'audit'],
      ['2', 'Витрина свободных площадей', 'Витрина',
       'Страница здания, план этажа, актуальный список свободных помещений, форма заявки', 'market'],
      ['3', 'Шахматка со статусами и карточка арендатора', 'Шахматка, Арендаторы',
       'Семь статусов, клик по помещению открывает арендатора, договор, условия и платежи за 12 месяцев', 'grid'],
      ['4', 'Напоминания об оплате', 'Напоминания',
       'Цепочка из четырёх шагов: счёт, напоминание, просрочка, претензия, с текстом сообщений', 'remind'],
      ['5', 'Реестр договоров с календарём', 'Договоры',
       'Сроки, индексации, каникулы, ответственный, календарь событий на 12 месяцев', 'contracts'],
      ['6', 'Начисления и счета', 'Начисления',
       'Аренда, коммуналка по счётчикам, допуслуги, массовое выставление, отметка оплат, выписка ЭСФ', 'bills'],
      ['7', 'Сводка собственнику', 'Сводка',
       'Заполняемость, кто не заплатил, что освобождается, где просрочка, раз в неделю в WhatsApp', 'report']
    ];

    var wrap = el('div', 'tbl-wrap cards');
    var t = el('table', 'tbl cards');
    t.innerHTML = '<thead><tr><th>Пункт</th><th>Что просили</th><th>Где смотреть</th><th>Что показывает</th></tr></thead>';
    var tb = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr', 'rowbtn');
      tr.innerHTML =
        '<td data-l="Пункт">' + r[0] + '</td>' +
        '<td class="wide" data-l="Что просили">' + r[1] + '</td>' +
        '<td data-l="Где смотреть"><span class="badge b-paid">' + r[2] + '</span></td>' +
        '<td data-l="Что показывает">' + r[3] + '</td>';
      clickable(tr, function () { go(r[4]); }, 'Перейти: ' + r[1]);
      tb.append(tr);
    });
    t.append(tb);
    wrap.append(t);
    pad.append(wrap);

    pad.append(el('div', 'h2', 'Что честно сказать, если спросят'));
    var card = el('div', 'card');
    card.innerHTML =
      '<div class="kv"><span>Это настоящая система?</span><b style="max-width:60%">' +
        'Нет. Это работающая демонстрация интерфейса на выдуманных данных. ' +
        'Кнопки нажимаются, состояние меняется, но ничего никуда не отправляется.</b></div>' +
      '<div class="kv"><span>Откуда суммы?</span><b style="max-width:60%">' +
        'Придуманы. Они правдоподобны по порядку величины, но источника под ними нет, ' +
        'и в коммерческое предложение мы их не переносим.</b></div>' +
      '<div class="kv"><span>Нейросеть правда разбирает договоры?</span><b style="max-width:60%">' +
        'На этом экране нет, разбор показан на подготовленных данных. ' +
        'На пилоте разбираются ваши файлы, и результат вы видите до оплаты.</b></div>' +
      '<div class="kv"><span>У вас есть внедрения в бизнес-центрах?</span><b style="max-width:60%">' +
        'Нет ни одного. Первый пилот делаем дёшево ради кейса, и это мы говорим сразу, ' +
        'а не выясняется потом.</b></div>' +
      '<div class="kv"><span>Что уже работает у вас в проде?</span><b style="max-width:60%">' +
        'Приемка помещений застройщиком, передача квартир дольщикам с работой без связи, ' +
        'сайт подбора новостроек и карта рынка Шымкента на 122 объекта.</b></div>';
    pad.append(card);

    pad.append(el('div', 'note',
      'Демонстрация детерминированная: одни и те же данные при каждом открытии. ' +
      'Чтобы вернуть исходное состояние, обновите страницу.'));
    v.append(pad);
  }

  /* ─── легенда ─────────────────────────────────────────── */

  function renderLegend() {
    var l = $('legend');
    l.hidden = state.screen !== 'grid';
    if (l.hidden) return;
    var items = state.gridView === 'hours'
      ? [['rgba(59,57,196,.30)', 'бронь арендатора, минус 50%'],
         ['rgba(169,167,244,.70)', 'внешний клиент, полная ставка'],
         ['#EDEDF3', 'час свободен']]
      : [['rgba(59,57,196,.30)', 'оплачено'], ['rgba(224,179,60,.50)', 'счёт выставлен'],
         ['rgba(238,79,73,.40)', 'просрочка'], ['rgba(110,107,230,.16)', 'по договору вперёд'],
         ['rgba(169,167,244,.70)', 'бронь'], ['#EDEDF3', 'свободно'], ['#DCDCE6', 'ремонт']];
    l.innerHTML = items.map(function (p) {
      return '<span><i style="background:' + p[0] + '"></i>' + p[1] + '</span>';
    }).join('') +
      (state.gridView === 'hours' ? ''
        : '<span><i style="background:#fff;box-shadow:inset -3px 0 0 var(--coral)"></i>конец договора</span>' +
          '<span style="color:var(--muted)">числа в ячейках, это тысячи тенге</span>') +
      '<span class="f">Данные демонстрационные, компании вымышлены</span>';
  }

  /* ─── общая отрисовка ─────────────────────────────────── */

  var VIEWS = {
    grid: viewGrid, tenants: viewTenants, bills: viewBills, remind: viewRemind,
    contracts: viewContracts, audit: viewAudit, market: viewMarket,
    report: viewReport, scope: viewScope
  };
  var BARS = { grid: barGrid, tenants: barTenants };

  function renderView() {
    var v = $('view');
    v.innerHTML = '';
    (VIEWS[state.screen] || viewGrid)(v);
  }

  function renderBar() {
    var bar = $('bar');
    bar.innerHTML = '';
    var f = BARS[state.screen];
    bar.hidden = !f;
    if (f) f(bar);
  }

  function render() {
    renderRail();
    renderTabbar();
    renderBar();
    renderView();
    renderPanel();
    renderLegend();
  }

  function route() {
    var id = (location.hash || '').replace('#/', '');
    state.screen = screenById(id).id;
    var v = $('view');
    if (v) v.scrollTop = 0;
    render();
  }

  /* ─── запуск ──────────────────────────────────────────── */

  $('objName').textContent = D.OBJECT.name + ', ' + fmt(D.OBJECT.totalArea) + ' кв. м';
  $('objSub').textContent = D.OBJECT.city + ', ' + D.OBJECT.floorsCount + ' этажей, ' +
    D.ROOMS.length + ' помещений, ' + fmt(D.RENT_AREA) + ' кв. м арендопригодной';
  document.title = 'Управление арендой, ' + D.OBJECT.name + ', демонстрация';

  /* Долг пересчитывается тем же способом, что и после любого действия:
     генератор считает его по количеству месяцев, и без этого первая цифра
     на экране была бы получена иначе, чем все последующие. */
  D.ROOMS.forEach(recalc);

  $('sheetBg').onclick = closeSheet;
  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeSheet(); closePanel(); }
  });

  route();

})();
