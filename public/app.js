'use strict';

const CATS = { work: 'Работа', home: 'Дом', study: 'Учёба', health: 'Здоровье', personal: 'Личное' };

const $ = (sel) => document.querySelector(sel);
const h = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const fmt = (key) => new Date(`${key}T00:00:00`).toLocaleDateString('ru', { day: 'numeric', month: 'short' });

let todos = [];
let selected = keyOf(new Date());
let view = startOfMonth(new Date());
let tab = 'day';
let cat = 'all';
let editingId = null;
let pendingUndo = null;
let toastTimer = null;
let authMode = 'login';

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    credentials: 'same-origin',
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401 && path !== '/api/login') {
    showAuth();
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Ошибка запроса');
  }
  return res.status === 204 ? null : res.json();
}

function showAuth() {
  $('#app').hidden = true;
  $('#auth').hidden = false;
  $('#auth-login').value = '';
  $('#auth-pass').value = '';
  $('#auth-error').textContent = '';
  $('#auth-login').focus();
}

function setAuthMode(mode) {
  authMode = mode;
  const login = mode === 'login';
  $('#auth-title').textContent = login ? 'Вход' : 'Регистрация';
  $('#auth-hint').textContent = login
    ? 'Войдите, чтобы открыть свои задачи.'
    : 'Логин латиницей, пароль от 6 символов.';
  $('#auth-submit').textContent = login ? 'Войти' : 'Создать аккаунт';
  $('#auth-mode').textContent = login ? 'Зарегистрироваться' : 'У меня есть аккаунт';
  $('#auth-pass').autocomplete = login ? 'current-password' : 'new-password';
  $('#auth-error').textContent = '';
}

$('#auth-mode').addEventListener('click', () => setAuthMode(authMode === 'login' ? 'register' : 'login'));

$('#auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = $('#auth-error');
  error.textContent = '';
  const login = $('#auth-login').value.trim().toLowerCase();
  const password = $('#auth-pass').value;

  if (!login || password.length < 6) {
    error.textContent = 'Заполните оба поля, пароль от 6 символов.';
    return;
  }

  try {
    await api(authMode === 'login' ? '/api/login' : '/api/register', {
      method: 'POST',
      body: { login, password },
    });
    $('#auth-pass').value = '';
    await enterApp();
  } catch (e) {
    if (e.message !== 'unauthorized') error.textContent = e.message;
  }
});

$('#logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  todos = [];
  hideToast();
  showAuth();
});

function hideToast() {
  pendingUndo = null;
  clearTimeout(toastTimer);
  const toast = $('#toast');
  toast.classList.remove('show');
  setTimeout(() => { if (!toast.classList.contains('show')) toast.hidden = true; }, 200);
}

function showToast(message, onUndo) {
  const toast = $('#toast');
  $('#toast-text').textContent = message;
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add('show'));
  clearTimeout(toastTimer);
  $('#toast-undo').onclick = () => {
    hideToast();
    if (onUndo) onUndo();
  };
  toastTimer = setTimeout(hideToast, 5000);
}

async function addTodo(text, category, later) {
  try {
    const todo = await api('/api/todos', {
      method: 'POST',
      body: { text, category, date: later ? null : selected },
    });
    todos.push(todo);
    tab = later ? 'later' : 'day';
    render();
  } catch (e) {
    if (e.message !== 'unauthorized') showToast(e.message);
  }
}

async function patchTodo(id, patch) {
  const todo = todos.find((x) => x.id === id);
  if (!todo) return;
  const before = { ...todo };
  Object.assign(todo, patch);
  render();
  try {
    Object.assign(todo, await api(`/api/todos/${id}`, { method: 'PATCH', body: patch }));
    render();
  } catch (e) {
    Object.assign(todo, before);
    render();
    if (e.message !== 'unauthorized') showToast(e.message);
  }
}

async function removeTodo(id) {
  const index = todos.findIndex((x) => x.id === id);
  if (index < 0) return;
  const [todo] = todos.splice(index, 1);
  render();
  showToast('Задача удалена', async () => {
    try {
      const restored = await api('/api/todos', {
        method: 'POST',
        body: { text: todo.text, category: todo.category, date: todo.date },
      });
      if (todo.done) {
        const done = await api(`/api/todos/${restored.id}`, { method: 'PATCH', body: { done: true } });
        Object.assign(restored, done);
      }
      todos.splice(Math.min(index, todos.length), 0, restored);
      render();
    } catch (e) {
      if (e.message !== 'unauthorized') showToast(e.message);
    }
  });
  try {
    await api(`/api/todos/${id}`, { method: 'DELETE' });
  } catch (e) {
    if (e.message !== 'unauthorized') showToast(e.message);
  }
}

function startEdit(id) {
  editingId = id;
  render();
  const input = $('#list .todo__edit');
  if (input) {
    input.focus();
    input.select();
  }
}

function commitEdit(input) {
  const item = input.closest('.todo');
  if (!item) return;
  const id = item.dataset.id;
  if (editingId !== id) return;
  const value = input.value.trim();
  editingId = null;
  if (!value) {
    render();
    return;
  }
  patchTodo(id, { text: value });
}

function renderCalendar() {
  $('#month').textContent = view.toLocaleDateString('ru', { month: 'long', year: 'numeric' });
  const grid = $('#grid');
  grid.replaceChildren();

  const offset = (view.getDay() + 6) % 7;
  const start = new Date(view.getFullYear(), view.getMonth(), 1 - offset);
  const today = keyOf(new Date());

  const byDay = new Map();
  for (const todo of todos) {
    if (!todo.date) continue;
    const stat = byDay.get(todo.date) || { all: 0, done: 0 };
    stat.all += 1;
    if (todo.done) stat.done += 1;
    byDay.set(todo.date, stat);
  }

  const fragment = document.createDocumentFragment();
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const k = keyOf(date);
    const stat = byDay.get(k);

    const cell = h('button', 'day');
    cell.type = 'button';
    cell.dataset.date = k;
    if (date.getMonth() !== view.getMonth()) cell.classList.add('day--out');
    if (k === today) cell.classList.add('day--today');
    if (k === selected) cell.classList.add('day--sel');
    if (stat && stat.done === stat.all) cell.classList.add('day--done');
    cell.append(h('span', null, String(date.getDate())));
    if (stat) cell.append(h('small', 'day__c', `${stat.done}/${stat.all}`));
    cell.setAttribute('aria-label', `${date.toLocaleDateString('ru')}${stat ? `, задач ${stat.all}, выполнено ${stat.done}` : ''}`);
    fragment.append(cell);
  }
  grid.append(fragment);
}

function todoNode(todo) {
  const item = h('li', `todo${todo.done ? ' todo--done' : ''}`);
  item.dataset.id = todo.id;

  const label = h('label', 'todo__label');
  const checkbox = h('input', 'todo__cb');
  checkbox.type = 'checkbox';
  checkbox.checked = todo.done;
  label.append(checkbox);

  if (todo.id === editingId) {
    const input = h('input', 'todo__edit');
    input.type = 'text';
    input.value = todo.text;
    input.maxLength = 200;
    input.setAttribute('aria-label', 'Изменить задачу');
    label.append(input);
  } else {
    const text = h('span', 'todo__text', todo.text);
    text.title = 'Двойной клик — изменить';
    label.append(text);
  }

  const parts = [label];

  if (tab === 'done' && todo.date) parts.push(h('span', 'todo__date', fmt(todo.date)));
  if (todo.category) parts.push(h('span', 'tag', CATS[todo.category] || ''));

  if (tab !== 'done') {
    const move = h('button', 'act');
  move.innerHTML = icon(tab === 'day' ? 'clock' : 'back');
    move.type = 'button';
    move.dataset.act = 'move';
    const labelText = tab === 'day' ? 'Отложить без срока' : 'Вернуть на выбранный день';
    move.title = labelText;
    move.setAttribute('aria-label', labelText);
    parts.push(move);
  } else {
    const restore = h('button', 'act');
  restore.innerHTML = icon('back');
    restore.type = 'button';
    restore.dataset.act = 'restore';
    restore.title = 'Вернуть в работу';
    restore.setAttribute('aria-label', `Вернуть в работу: ${todo.text}`);
    parts.push(restore);
  }

  const del = h('button', 'act');
  del.innerHTML = icon('trash');
  del.type = 'button';
  del.dataset.act = 'del';
  del.setAttribute('aria-label', `Удалить задачу: ${todo.text}`);
  parts.push(del);

  item.append(...parts);
  return item;
}

function renderMain() {
  const day = new Date(`${selected}T00:00:00`);
  $('#day-title').textContent = day.toLocaleDateString('ru', { weekday: 'long', day: 'numeric', month: 'long' });

  const dayItems = todos.filter((t) => t.date === selected);
  const doneCount = dayItems.filter((t) => t.done).length;
  const laterCount = todos.filter((t) => !t.date).length;

  $('#day-stats').textContent = dayItems.length
    ? `Выполнено ${doneCount} из ${dayItems.length} · отложено: ${laterCount}`
    : `Задач на этот день нет · отложено: ${laterCount}`;
  $('#bar').style.width = `${dayItems.length ? (doneCount / dayItems.length) * 100 : 0}%`;
  $('#later-n').textContent = String(laterCount);
  $('#done-n').textContent = String(doneCount);

  for (const btn of document.querySelectorAll('.tab')) {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  }

  const chips = $('#chips');
  chips.replaceChildren();
  for (const [value, label] of [['all', 'Все'], ...Object.entries(CATS)]) {
    const chip = h('button', `chip${cat === value ? ' is-active' : ''}`);
    if (value !== 'all') chip.innerHTML = icon(value);
    chip.append(label);
    chip.type = 'button';
    chip.dataset.cat = value;
    chip.setAttribute('aria-pressed', String(cat === value));
    chips.append(chip);
  }

  let items;
  if (tab === 'day') items = dayItems.filter((t) => !t.done);
  else if (tab === 'done') items = dayItems.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  else items = todos.filter((t) => !t.date);

  if (cat !== 'all') items = items.filter((t) => t.category === cat);

  const list = $('#list');
  list.replaceChildren();
  for (const todo of items) list.append(todoNode(todo));

  const empty = $('#empty');
  empty.hidden = items.length > 0;
  if (!items.length) {
    if (cat !== 'all') empty.textContent = 'В этой категории пусто.';
    else if (tab === 'done') empty.textContent = 'За этот день ничего не выполнено.';
    else if (tab === 'later') empty.textContent = 'Отложенных задач нет.';
    else empty.textContent = 'На этот день всё закрыто.';
  }
}

function render() {
  renderCalendar();
  renderMain();
}

async function enterApp() {
  const [me, list] = await Promise.all([api('/api/me'), api('/api/todos')]);
  todos = Array.isArray(list) ? list : [];
  $('#who').textContent = me.login;
  $('#auth').hidden = true;
  $('#app').hidden = false;
  tab = 'day';
  selected = keyOf(new Date());
  view = startOfMonth(new Date());
  render();
  $('#text').focus();
}

$('#cat').replaceChildren(
  ...Object.entries(CATS).map(([value, label]) => {
    const option = h('option', '', label);
    option.value = value;
    return option;
  }),
);

$('#form').addEventListener('submit', (event) => {
  event.preventDefault();
  const text = $('#text').value.trim();
  if (!text) {
    $('#text').focus();
    return;
  }
  addTodo(text, $('#cat').value, $('#later').checked);
  $('#text').value = '';
  $('#later').checked = false;
  $('#text').focus();
});

$('#list').addEventListener('change', (event) => {
  const checkbox = event.target.closest('.todo__cb');
  if (!checkbox) return;
  const list = $('#list');
  toggleDone(checkbox.closest('.todo').dataset.id, checkbox.checked, checkbox.closest('.todo'));
});

$('#list').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.closest('.todo').dataset.id;
  if (btn.dataset.act === 'del') removeTodo(id);
  else if (btn.dataset.act === 'restore') patchTodo(id, { done: false });
  else patchTodo(id, { date: tab === 'day' ? null : selected });
});

$('#list').addEventListener('dblclick', (event) => {
  const text = event.target.closest('.todo__text');
  if (text) startEdit(text.closest('.todo').dataset.id);
});

$('#list').addEventListener('keydown', (event) => {
  const input = event.target.closest('.todo__edit');
  if (!input) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    commitEdit(input);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    editingId = null;
    render();
  }
});

$('#list').addEventListener('focusout', (event) => {
  const input = event.target.closest('.todo__edit');
  if (input) commitEdit(input);
});

$('#grid').addEventListener('click', (event) => {
  const cell = event.target.closest('.day');
  if (!cell) return;
  selected = cell.dataset.date;
  tab = 'day';
  const date = new Date(`${selected}T00:00:00`);
  if (date.getMonth() !== view.getMonth()) view = startOfMonth(date);
  render();
});

$('#prev').addEventListener('click', () => {
  view = new Date(view.getFullYear(), view.getMonth() - 1, 1);
  render();
});
$('#next').addEventListener('click', () => {
  view = new Date(view.getFullYear(), view.getMonth() + 1, 1);
  render();
});
$('#today').addEventListener('click', () => {
  selected = keyOf(new Date());
  view = startOfMonth(new Date());
  tab = 'day';
  render();
});

for (const btn of document.querySelectorAll('.tab')) {
  btn.addEventListener('click', () => {
    tab = btn.dataset.tab;
    renderMain();
  });
}

$('#chips').addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (!chip) return;
  cat = chip.dataset.cat;
  renderMain();
});

api('/api/me').then(enterApp).catch(showAuth);
setAuthMode('login');
function icon(name) {
  const paths = {
    clock: '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.6v4.8l3.2 1.9"/>',
    back: '<path d="M14.5 6.5 9 12l5.5 5.5"/><path d="M9 12h9"/>',
    trash: '<path d="M4 7h16"/><path d="M9.5 7V4.8h5V7"/><path d="M6.4 7l.9 12.2h9.4L17.6 7"/>',
    work: '<rect x="3.5" y="7.5" width="17" height="12" rx="2.5"/><path d="M9 7.5v-2h6v2"/>',
    home: '<path d="M4 10.5 12 4l8 6.5V20H4z"/><path d="M10 20v-5h4v5"/>',
    study: '<path d="M4 5.5h6a2 2 0 0 1 2 2v11a2 2 0 0 0-2-2H4z"/><path d="M20 5.5h-6a2 2 0 0 0-2 2v11a2 2 0 0 1 2-2h6z"/>',
    health: '<path d="M12 20s-7-4.3-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.7-7 9-7 9z"/>',
    personal: '<circle cx="12" cy="8.5" r="3.4"/><path d="M5 20c.6-3.6 3.4-5.6 7-5.6s6.4 2 7 5.6"/>'
  };
  return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || '') + '</svg>';
}

let formCat = 'personal';
const pickBtn = $('#pick-btn');
const pickList = $('#pick-list');

function syncPick() {
  $('#cat').value = formCat;
  pickBtn.innerHTML = icon(formCat) + (CATS[formCat] || '');
}

function buildPick() {
  pickList.replaceChildren();
  for (const [value, label] of Object.entries(CATS)) {
    const item = document.createElement('li');
    item.setAttribute('role', 'option');
    item.dataset.value = value;
    item.tabIndex = 0;
    item.innerHTML = icon(value);
    item.append(label);
    item.setAttribute('aria-selected', String(value === formCat));
    pickList.append(item);
  }
}

function openPick(open) {
  pickList.hidden = !open;
  pickBtn.setAttribute('aria-expanded', String(open));
  if (open) {
    buildPick();
    const first = pickList.querySelector('li');
    if (first) first.focus();
  }
}

pickBtn.addEventListener('click', () => openPick(pickList.hidden));

pickList.addEventListener('click', (event) => {
  const item = event.target.closest('li');
  if (!item) return;
  formCat = item.dataset.value;
  syncPick();
  openPick(false);
  pickBtn.focus();
});

pickList.addEventListener('keydown', (event) => {
  const items = [...pickList.querySelectorAll('li')];
  const index = items.indexOf(document.activeElement);
  if (event.key === 'Escape') {
    openPick(false);
    pickBtn.focus();
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    items[(index + 1) % items.length].focus();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    items[(index - 1 + items.length) % items.length].focus();
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (document.activeElement !== pickBtn) document.activeElement.click();
  }
});

document.addEventListener('click', (event) => {
  if (!pickList.hidden && !event.target.closest('.pick')) openPick(false);
});

syncPick();

function updateStats() {
  const dayItems = todos.filter((t) => t.date === selected);
  const doneCount = dayItems.filter((t) => t.done).length;
  const laterCount = todos.filter((t) => !t.date).length;
  $('#day-stats').textContent = dayItems.length
    ? 'Выполнено ' + doneCount + ' из ' + dayItems.length + ' · отложено: ' + laterCount
    : 'Задач на этот день нет · отложено: ' + laterCount;
  $('#bar').style.width = (dayItems.length ? (doneCount / dayItems.length) * 100 : 0) + '%';
  $('#later-n').textContent = String(laterCount);
  $('#done-n').textContent = String(doneCount);
}

async function toggleDone(id, checked, item) {
  const todo = todos.find((x) => x.id === id);
  if (!todo) return;

  const box = item.querySelector('.todo__cb');
  const apply = (value) => {
    todo.done = value;
    item.classList.toggle('todo--done', value);
    if (box) box.checked = value;
    updateStats();
  syncSelectedCell();
  };

  apply(checked);

  try {
    Object.assign(todo, await api('/api/todos/' + id, { method: 'PATCH', body: { done: checked } }));
  } catch (error) {
    apply(!checked);
    if (error.message !== 'unauthorized') showToast(error.message);
    return;
  }

  const stays = tab === 'day' ? !todo.done : tab === 'done' ? todo.done : true;
  if (!stays) {
    item.classList.add('todo--leaving');
    setTimeout(() => {
      if (item.isConnected) item.remove();
      updateStats();
  syncSelectedCell();
    }, 240);
  }
}

function syncSelectedCell() {
  const cell = document.querySelector('.day--sel');
  if (!cell) return;
  const dayItems = todos.filter((t) => t.date === selected);
  const doneCount = dayItems.filter((t) => t.done).length;
  let small = cell.querySelector('.day__c');
  if (dayItems.length) {
    if (!small) {
      small = document.createElement('small');
      small.className = 'day__c';
      cell.append(small);
    }
    small.textContent = doneCount + '/' + dayItems.length;
    cell.classList.toggle('day--done', doneCount === dayItems.length);
  } else if (small) {
    small.remove();
  }
}
