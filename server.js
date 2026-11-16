'use strict';

const express = require('express');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const SESSION_TTL = 1000 * 60 * 60 * 24 * 14;
const MAX_TEXT = 200;
const CATS = new Set(['work', 'home', 'study', 'health', 'personal']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

let db = { users: [], todos: [] };
let writeQueue = Promise.resolve();
const sessions = new Map();
const attempts = new Map();

async function init() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fsp.readFile(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    db.users = Array.isArray(parsed.users) ? parsed.users : [];
    db.todos = Array.isArray(parsed.todos) ? parsed.todos : [];
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!db.users.length) {
    await createUser('demo', 'demo1234');
    console.log('Создан демо-аккаунт: demo / demo1234');
  }
}

function persist() {
  writeQueue = writeQueue
    .then(async () => {
      const tmp = `${DB_FILE}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(db, null, 2));
      await fsp.rename(tmp, DB_FILE);
    })
    .catch((error) => console.error('Ошибка записи БД:', error));
  return writeQueue;
}

const scrypt = (password, salt) =>
  new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, key) => (error ? reject(error) : resolve(key)));
  });

async function createUser(login, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt)).toString('hex');
  const user = { id: crypto.randomUUID(), login, salt, hash, createdAt: Date.now() };
  db.users.push(user);
  await persist();
  return user;
}

async function verifyUser(login, password) {
  const user = db.users.find((u) => u.login === login);
  if (!user) return null;
  const hash = await scrypt(password, user.salt);
  const stored = Buffer.from(user.hash, 'hex');
  if (hash.length !== stored.length) return null;
  return crypto.timingSafeEqual(hash, stored) ? user : null;
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function startSession(res, userId) {
  const sid = crypto.randomBytes(32).toString('hex');
  sessions.set(sid, { userId, exp: Date.now() + SESSION_TTL });
  res.cookie('sid', sid, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL,
    path: '/',
  });
}

function requireAuth(req, res, next) {
  const sid = readCookie(req, 'sid');
  const session = sid && sessions.get(sid);
  if (!session || session.exp < Date.now()) {
    if (sid) sessions.delete(sid);
    return res.status(401).json({ error: 'Требуется вход' });
  }
  const user = db.users.find((u) => u.id === session.userId);
  if (!user) {
    sessions.delete(sid);
    return res.status(401).json({ error: 'Требуется вход' });
  }
  req.user = user;
  next();
}

function rateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.reset < now) {
    attempts.set(ip, { count: 1, reset: now + 10 * 60 * 1000 });
    return next();
  }
  if (entry.count >= 20) {
    return res.status(429).json({ error: 'Слишком много попыток. Подождите 10 минут.' });
  }
  entry.count += 1;
  next();
}

function cleanText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().slice(0, MAX_TEXT);
  return text || null;
}

function cleanDate(value) {
  if (value === null || value === undefined || value === '') return null;
  return DATE_RE.test(value) ? value : undefined;
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

app.post('/api/register', rateLimit, async (req, res) => {
  const login = String(req.body?.login || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!/^[a-z0-9_.-]{3,32}$/.test(login)) {
    return res.status(400).json({ error: 'Логин: 3–32 символа, латиница, цифры, _ . -' });
  }
  if (password.length < 6 || password.length > 100) {
    return res.status(400).json({ error: 'Пароль: от 6 до 100 символов' });
  }
  if (db.users.some((u) => u.login === login)) {
    return res.status(409).json({ error: 'Такой логин занят' });
  }

  const user = await createUser(login, password);
  startSession(res, user.id);
  res.status(201).json({ login: user.login });
});

app.post('/api/login', rateLimit, async (req, res) => {
  const login = String(req.body?.login || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = await verifyUser(login, password);
  if (!user) return res.status(401).json({ error: 'Неверный логин или пароль' });
  startSession(res, user.id);
  res.json({ login: user.login });
});

app.post('/api/logout', (req, res) => {
  const sid = readCookie(req, 'sid');
  if (sid) sessions.delete(sid);
  res.clearCookie('sid', { path: '/' });
  res.status(204).end();
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ login: req.user.login });
});

app.get('/api/todos', requireAuth, (req, res) => {
  res.json(db.todos.filter((t) => t.userId === req.user.id));
});

app.post('/api/todos', requireAuth, async (req, res) => {
  const text = cleanText(req.body?.text);
  const date = cleanDate(req.body?.date);
  const category = CATS.has(req.body?.category) ? req.body.category : 'personal';

  if (!text) return res.status(400).json({ error: 'Нужен текст задачи' });
  if (date === undefined) return res.status(400).json({ error: 'Неверная дата' });

  const todo = {
    id: crypto.randomUUID(),
    userId: req.user.id,
    text,
    category,
    date,
    done: false,
    createdAt: Date.now(),
    doneAt: null,
  };
  db.todos.push(todo);
  await persist();
  res.status(201).json(todo);
});

app.patch('/api/todos/:id', requireAuth, async (req, res) => {
  const todo = db.todos.find((t) => t.id === req.params.id && t.userId === req.user.id);
  if (!todo) return res.status(404).json({ error: 'Задача не найдена' });

  if ('text' in req.body) {
    const text = cleanText(req.body.text);
    if (!text) return res.status(400).json({ error: 'Пустой текст' });
    todo.text = text;
  }
  if ('date' in req.body) {
    const date = cleanDate(req.body.date);
    if (date === undefined) return res.status(400).json({ error: 'Неверная дата' });
    todo.date = date;
  }
  if ('category' in req.body) {
    if (!CATS.has(req.body.category)) return res.status(400).json({ error: 'Неверная категория' });
    todo.category = req.body.category;
  }
  if ('done' in req.body) {
    todo.done = Boolean(req.body.done);
    todo.doneAt = todo.done ? Date.now() : null;
  }

  await persist();
  res.json(todo);
});

app.delete('/api/todos/:id', requireAuth, async (req, res) => {
  const index = db.todos.findIndex((t) => t.id === req.params.id && t.userId === req.user.id);
  if (index < 0) return res.status(404).json({ error: 'Задача не найдена' });
  db.todos.splice(index, 1);
  await persist();
  res.status(204).end();
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Не найдено' });
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

setInterval(() => {
  const now = Date.now();
  for (const [sid, session] of sessions) if (session.exp < now) sessions.delete(sid);
}, 60 * 60 * 1000).unref();

init()
  .then(() => app.listen(PORT, () => console.log(`http://localhost:${PORT}`)))
  .catch((error) => {
    console.error('Не удалось запустить:', error);
    process.exit(1);
  });