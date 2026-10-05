# CreStore Server

Node.js + Express + WebSocket сервер для проекта CreStore.

## Что делает
- Раздаёт статику из папки `public`
- Держит WebSocket-чат на пути `/ws`
- Хранит последние 200 сообщений в памяти

## Запуск локально
npm install
npm start
Открыть http://localhost:3000

## Деплой на Render
- Тип: Web Service
- Build Command: npm install
- Start Command: npm start
- Environment: Node