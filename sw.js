"use strict";

/* Работа без сети после первого открытия.
 *
 * Зачем: демонстрацию показывают в чужой переговорной, и гостевой вайфай там
 * может отвалиться ровно в тот момент, когда владелец объекта достал телефон.
 * После первого открытия страница обязана подниматься без сети.
 *
 * Имя кеша содержит отпечаток версии. Без него выложенная версия замерзает
 * навсегда: браузер продолжает отдавать старые файлы из кеша, и правка,
 * уехавшая на хостинг, до телефона не доходит. На этом уже обжигались в
 * демонстрации SmartEX, см. ADR-0017.
 *
 * Список файлов записан руками: сборки у проекта нет, файлов четыре.
 */

var VERSION = '2026-08-12-1';
var CACHE = 'bc-rent-' + VERSION;

var FILES = [
  './',
  './index.html',
  './assets/app.css',
  './assets/data.js',
  './assets/app.js'
];

/* Кеш заполняется сразу при установке, а не по мере обращений: ленивый
   вариант не даёт офлайна при первом же открытии. */
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(FILES); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* Сеть вперёд, кеш как запасной путь: так свежая версия доезжает при живой
   сети, а без сети страница всё равно открывается. */
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return res;
      })
      .catch(function () {
        return caches.match(e.request).then(function (hit) {
          return hit || caches.match('./index.html');
        });
      })
  );
});
