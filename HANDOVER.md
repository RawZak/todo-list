\# Передача проекта: список задач



Веб-приложение «Список задач» на Node.js + Express. Статика в `public/`,

данные в JSON-файле. Многопользовательское: регистрация, вход, у каждого

пользователя свои задачи.



\## Состав и назначение файлов



&#x20;   server.js          HTTP-сервер: маршруты API, авторизация, работа с хранилищем

&#x20;   package.json       зависимости и команда запуска (npm start)

&#x20;   .env.example       пример переменных окружения (PORT, DATA\_DIR)

&#x20;   .gitignore         что не попадает в git: node\_modules, data, .env

&#x20;   Dockerfile         сборка контейнера, если развёртывание через Docker

&#x20;   public/index.html  разметка: форма входа и интерфейс задач

&#x20;   public/styles.css  оформление, светлая и тёмная темы

&#x20;   public/app.js      клиентская логика: запросы к API, календарь, вкладки

&#x20;   README.md          краткое описание проекта

&#x20;   data/db.json       создаётся при первом старте, в архиве отсутствует



Каталог `node\_modules` в архив не входит — ставится на сервере.



\## Требования



\- Node.js 18 или выше

\- Свободный порт (по умолчанию 3000, меняется через `PORT`)

\- Каталог `DATA\_DIR` с правами на запись



\## Локальный запуск



&#x20;   npm ci --omit=dev

&#x20;   npm start



http://localhost:3000



При первом старте создаётся аккаунт `demo` / `demo1234` и каталог `data`

с файлом `db.json`.



\## Развёртывание на Ubuntu 22.04



&#x20;   apt update \&\& apt upgrade -y

&#x20;   curl -fsSL https://deb.nodesource.com/setup\_20.x | bash -

&#x20;   apt install -y nodejs nginx certbot python3-certbot-nginx



&#x20;   adduser --system --group todo

&#x20;   mkdir -p /opt/todo-list

&#x20;   # распаковать содержимое архива в /opt/todo-list

&#x20;   cd /opt/todo-list

&#x20;   npm ci --omit=dev

&#x20;   mkdir -p data

&#x20;   chown -R todo:todo /opt/todo-list



`/etc/systemd/system/todo.service`:



&#x20;   \[Unit]

&#x20;   Description=todo

&#x20;   After=network.target



&#x20;   \[Service]

&#x20;   WorkingDirectory=/opt/todo-list

&#x20;   Environment=PORT=3000

&#x20;   Environment=DATA\_DIR=/opt/todo-list/data

&#x20;   ExecStart=/usr/bin/node server.js

&#x20;   Restart=always

&#x20;   User=todo



&#x20;   \[Install]

&#x20;   WantedBy=multi-user.target



&#x20;   systemctl daemon-reload

&#x20;   systemctl enable --now todo



`/etc/nginx/sites-available/todo`:



&#x20;   server {

&#x20;       listen 80;

&#x20;       server\_name example.com;



&#x20;       location / {

&#x20;           proxy\_pass http://127.0.0.1:3000;

&#x20;           proxy\_set\_header Host $host;

&#x20;           proxy\_set\_header X-Forwarded-For $proxy\_add\_x\_forwarded\_for;

&#x20;           proxy\_set\_header X-Real-IP $remote\_addr;

&#x20;       }

&#x20;   }



&#x20;   ln -s /etc/nginx/sites-available/todo /etc/nginx/sites-enabled/todo

&#x20;   rm -f /etc/nginx/sites-enabled/default

&#x20;   nginx -t \&\& systemctl reload nginx



\### HTTPS обязателен для боевого режима



&#x20;   certbot --nginx -d example.com



После получения сертификата добавить в юнит строку



&#x20;   Environment=NODE\_ENV=production



и выполнить `systemctl daemon-reload \&\& systemctl restart todo`.



Важно: с `NODE\_ENV=production` cookie сессии уходит только по HTTPS.

Если включить его до настройки сертификата, вход будет молча не работать.



\## Эксплуатация



&#x20;   systemctl status todo        состояние

&#x20;   systemctl restart todo       перезапуск

&#x20;   journalctl -u todo -f        логи в реальном времени

&#x20;   journalctl -u todo -n 200    последние 200 строк



\## Резервные копии



Вся база — один файл `data/db.json`. Копия на ходу безопасна, запись атомарная

через временный файл.



&#x20;   cp /opt/todo-list/data/db.json /var/backups/todo-$(date +%F-%H%M).json



Пример в cron (ежедневно в 3:00):



&#x20;   0 3 \* \* \* cp /opt/todo-list/data/db.json /var/backups/todo-$(date +\\%F).json



Восстановление: остановить службу, положить файл на место, запустить.



\## Обновление версии



&#x20;   systemctl stop todo

&#x20;   # заменить файлы, кроме data/

&#x20;   cd /opt/todo-list \&\& npm ci --omit=dev

&#x20;   chown -R todo:todo /opt/todo-list

&#x20;   systemctl start todo



\## Ограничения



\- Хранилище — JSON-файл, читается в память при старте. Один процесс, без

&#x20; кластеризации: горизонтально масштабировать нельзя без переезда на СУБД.

\- Сессии живут в памяти. Перезапуск службы разлогинивает всех.

\- Файловая система должна быть постоянной. На платформах с эфемерным диском

&#x20; (например, бесплатный Render) база обнулится при пересборке — нужен volume.

\- Аккаунт `demo` / `demo1234` публичный. При необходимости удалить его из

&#x20; массива `users` в `db.json` при остановленной службе.

\- Пароли хранятся как scrypt-хеш со случайной солью, восстановление забытого

&#x20; пароля не предусмотрено.



\## Диагностика



&#x20;   502 Bad Gateway        служба не запущена: systemctl status todo, journalctl -u todo

&#x20;   вход не запоминается   включён NODE\_ENV=production без HTTPS

&#x20;   EACCES при старте      нет прав на DATA\_DIR: chown -R todo:todo /opt/todo-list

&#x20;   EADDRINUSE             занят порт: сменить PORT

&#x20;   «Слишком много попыток»  лимит 20 входов с адреса за 10 минут, подождать



\## Доступ для проверки



`demo` / `demo1234`, регистрация открыта.

