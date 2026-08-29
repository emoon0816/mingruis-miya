/**
 * miya-memory-store.js — 记忆存储层（蚀月定制）
 * 核心记忆 / 归档记忆 / 元数据，基于 Miya kv 数据层（miyaReadLsJsonKey/miyaWriteLsJsonKey）
 * → 自动被「备份导出」的 indexedDB_kv.json 覆盖，无需改备份代码。
 * 内存缓存保证同步读（buildCharMemoryContextBlock 是同步调用点），kv 负责持久化。
 */
(function (global) {
  'use strict';

  var CORE_PREFIX = 'miya-mem:core:';
  var ARCHIVE_PREFIX = 'miya-mem:archive:';
  var META_PREFIX = 'miya-mem:meta:';

  // 内存缓存：{ chatId: { core: [...], archive: [...], meta: {...}, loaded: bool } }
  var cache = {};

  function readLs(key, fallback) {
    if (typeof global.miyaReadLsJsonKey !== 'function') return Promise.resolve(fallback);
    return global.miyaReadLsJsonKey(key).then(function (v) {
      return v == null ? fallback : v;
    }).catch(function () {
      return fallback;
    });
  }

  function writeLs(key, val) {
    if (typeof global.miyaWriteLsJsonKey !== 'function') return Promise.resolve();
    return global.miyaWriteLsJsonKey(key, val);
  }

  function entry(chatId) {
    if (!cache[chatId]) {
      cache[chatId] = { core: [], archive: [], meta: {}, loaded: false, loading: null };
    }
    return cache[chatId];
  }

  /** 从 kv 加载某聊天记忆（懒加载；并发去重） */
  function ensureLoaded(chatId) {
    var e = entry(chatId);
    if (e.loaded) return Promise.resolve(e);
    if (e.loading) return e.loading;
    e.loading = Promise.all([
      readLs(CORE_PREFIX + chatId, []),
      readLs(ARCHIVE_PREFIX + chatId, []),
      readLs(META_PREFIX + chatId, {})
    ]).then(function (r) {
      e.core = Array.isArray(r[0]) ? r[0] : [];
      e.archive = Array.isArray(r[1]) ? r[1] : [];
      e.meta = r[2] && typeof r[2] === 'object' ? r[2] : {};
      e.loaded = true;
      e.loading = null;
      return e;
    }).catch(function () {
      e.loaded = true;
      e.loading = null;
      return e;
    });
    return e.loading;
  }

  /** 同步读（供 prompt 组装）——未加载时返回空数组 */
  function syncCore(chatId) {
    var e = cache[chatId];
    return e ? e.core : [];
  }
  function syncArchive(chatId) {
    var e = cache[chatId];
    return e ? e.archive : [];
  }

  /** 是否已加载（供渲染层防重入：避免 loaded 后立即 resolve 导致递归重渲染） */
  function isLoaded(chatId) {
    var e = cache[chatId];
    return !!(e && e.loaded);
  }

  /** 异步写核心记忆（写内存 + 持久化） */
  function saveCore(chatId, list) {
    var e = entry(chatId);
    e.core = Array.isArray(list) ? list : [];
    return writeLs(CORE_PREFIX + chatId, e.core);
  }

  /** 异步写归档记忆 */
  function saveArchive(chatId, list) {
    var e = entry(chatId);
    e.archive = Array.isArray(list) ? list : [];
    return writeLs(ARCHIVE_PREFIX + chatId, e.archive);
  }

  /** 元数据读写 */
  function getMeta(chatId, key, fallback) {
    var e = cache[chatId];
    if (!e) return fallback;
    return key == null ? e.meta : (e.meta[key] === undefined ? fallback : e.meta[key]);
  }
  function setMeta(chatId, key, val) {
    var e = entry(chatId);
    if (key == null) e.meta = val || {};
    else e.meta[key] = val;
    return writeLs(META_PREFIX + chatId, e.meta);
  }

  global.miyaMemoryStore = {
    ensureLoaded: ensureLoaded,
    isLoaded: isLoaded,
    syncCore: syncCore,
    syncArchive: syncArchive,
    saveCore: saveCore,
    saveArchive: saveArchive,
    getMeta: getMeta,
    setMeta: setMeta
  };
})(typeof window !== 'undefined' ? window : this);
