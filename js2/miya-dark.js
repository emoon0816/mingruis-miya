/**
 * miya-dark.js — 深色模式（蚀月定制）
 * 状态：{ mode: 'off'|'on'|'auto', start: '20:00', end: '07:00' } → kv key 'miya-dark-mode'
 * auto 模式跟随系统时间：start~end 区间内深色（支持跨午夜），每 30s 检查一次。
 * 关键：--ink 系列会被 applyTextColor / desk-custom 内联覆盖，此处用 setProperty(..., 'important') 强制。
 * UI 绑定自包含：美化 App 的深色开关/自动开关/时间段由本文件负责（不依赖 beautify-app 加载时序）。
 */
(function (global) {
  'use strict';

  var KEY = 'miya-dark-mode';
  var CHECK_MS = 30000;
  var DEFAULT_STATE = { mode: 'off', start: '20:00', end: '07:00' };

  var state = Object.assign({}, DEFAULT_STATE);
  var ready = false;
  var timer = null;
  var bound = false;

  /** 内联强制变量（深色开启时 important 写入，关闭时移除恢复） */
  var DARK_VARS = {
    '--ink': 'rgba(232, 234, 238, 0.92)',
    '--ink-soft': 'rgba(188, 192, 200, 0.78)',
    '--ink-faint': 'rgba(148, 153, 163, 0.62)'
  };

  function normalize(raw) {
    var r = raw && typeof raw === 'object' ? raw : {};
    return {
      mode: r.mode === 'on' || r.mode === 'auto' ? r.mode : 'off',
      start: /^\d{2}:\d{2}$/.test(String(r.start || '')) ? r.start : DEFAULT_STATE.start,
      end: /^\d{2}:\d{2}$/.test(String(r.end || '')) ? r.end : DEFAULT_STATE.end
    };
  }

  function toMinutes(hhmm) {
    var p = String(hhmm || '').split(':');
    return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
  }

  function inRange(start, end, nowM) {
    var s = toMinutes(start);
    var e = toMinutes(end);
    if (s === e) return true; // 相同 = 全天深色
    if (s < e) return nowM >= s && nowM < e;
    return nowM >= s || nowM < e; // 跨午夜
  }

  function shouldDark() {
    if (state.mode === 'on') return true;
    if (state.mode === 'off') return false;
    var d = new Date();
    var nowM = d.getHours() * 60 + d.getMinutes();
    return inRange(state.start, state.end, nowM);
  }

  function writeVars(on) {
    var el = document.documentElement;
    if (on) {
      Object.keys(DARK_VARS).forEach(function (k) {
        el.style.setProperty(k, DARK_VARS[k], 'important');
      });
    } else {
      Object.keys(DARK_VARS).forEach(function (k) {
        el.style.removeProperty(k);
      });
    }
  }

  function $id(id) {
    return document.getElementById(id);
  }

  function syncUi() {
    var nowDark = document.documentElement.classList.contains('miya-dark');
    var darkSw = $id('miya-bf-dark-switch');
    var autoSw = $id('miya-bf-dark-auto-switch');
    var status = $id('miya-bf-dark-status');
    var autoStatus = $id('miya-bf-dark-auto-status');
    var start = $id('miya-bf-dark-start');
    var end = $id('miya-bf-dark-end');
    var row = $id('miya-bf-dark-time-row');
    if (darkSw) {
      darkSw.classList.toggle('is-on', state.mode === 'on' || (state.mode === 'auto' && nowDark));
      darkSw.setAttribute('aria-checked', darkSw.classList.contains('is-on') ? 'true' : 'false');
    }
    if (autoSw) {
      autoSw.classList.toggle('is-on', state.mode === 'auto');
      autoSw.setAttribute('aria-checked', state.mode === 'auto' ? 'true' : 'false');
    }
    if (status) {
      if (state.mode === 'on') status.textContent = '已开启';
      else if (state.mode === 'auto') status.textContent = nowDark ? '自动 · 当前深色' : '自动 · 当前浅色';
      else status.textContent = '已关闭';
    }
    if (autoStatus) {
      autoStatus.textContent = state.mode === 'auto'
        ? '开启 · ' + state.start + ' – ' + state.end
        : '关闭 · 手动控制';
    }
    if (start) start.value = state.start || '20:00';
    if (end) end.value = state.end || '07:00';
    if (row) row.hidden = state.mode !== 'auto';
  }

  function bindUi() {
    if (bound) return;
    bound = true;
    var darkSw = $id('miya-bf-dark-switch');
    if (darkSw) {
      darkSw.addEventListener('click', function () {
        var next = state.mode === 'on' ? 'off' : 'on';
        set({ mode: next });
      });
    }
    var autoSw = $id('miya-bf-dark-auto-switch');
    if (autoSw) {
      autoSw.addEventListener('click', function () {
        var next = state.mode === 'auto' ? 'off' : 'auto';
        set({ mode: next });
      });
    }
    ['miya-bf-dark-start', 'miya-bf-dark-end'].forEach(function (id) {
      var inp = $id(id);
      if (!inp) return;
      inp.addEventListener('change', function () {
        var patch = {};
        if (id === 'miya-bf-dark-start') patch.start = inp.value;
        else patch.end = inp.value;
        set(patch);
      });
    });
    syncUi();
  }

  function apply() {
    var on = shouldDark();
    document.documentElement.classList.toggle('miya-dark', on);
    writeVars(on);
    if (ready) syncUi();
    return on;
  }

  function get() {
    return Object.assign({}, state);
  }

  function set(partial) {
    state = normalize(Object.assign({}, state, partial || {}));
    if (typeof global.miyaWriteLsJsonKey === 'function') {
      global.miyaWriteLsJsonKey(KEY, state).catch(function () {});
    } else {
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
    }
    return apply();
  }

  function load() {
    var p;
    if (typeof global.miyaReadLsJsonKey === 'function') {
      p = global.miyaReadLsJsonKey(KEY);
    } else {
      try { p = Promise.resolve(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch (e) { p = Promise.resolve(null); }
    }
    return (p || Promise.resolve(null)).then(function (raw) {
      state = normalize(raw);
      ready = true;
      apply();
      bindUi();
      startTimer();
      return get();
    }).catch(function () {
      ready = true;
      apply();
      bindUi();
      return get();
    });
  }

  function startTimer() {
    if (timer) return;
    timer = setInterval(function () {
      if (state.mode === 'auto') apply();
    }, CHECK_MS);
  }

  global.miyaDarkMode = {
    get: get,
    set: set,
    apply: apply,
    shouldDark: shouldDark,
    KEY: KEY
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})(window);
