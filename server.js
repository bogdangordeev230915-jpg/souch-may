import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { customAlphabet } from 'nanoid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Хранилище в памяти
const users = new Map();
const usersByCode = new Map();
const chats = new Map();
const messages = new Map();

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const nano4 = customAlphabet(CODE_CHARS, 4);
const nanoId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12);

function generateUniqueCode() {
  for (let i = 0; i < 30; i++) {
    const code = `SOUCH-${nano4()}-${nano4()}`;
    if (!usersByCode.has(code)) return code;
  }
  throw new Error('Не удалось сгенерировать код');
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    user_code: u.user_code,
    display_name: u.display_name,
    avatar: u.avatar || null
  };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype.startsWith('image/') ||
      file.mimetype.startsWith('audio/') ||
      file.mimetype.startsWith('video/')
    ) cb(null, true);
    else cb(new Error('Только изображения, аудио и видео'));
  }
});

app.post('/api/register', (req, res) => {
  const { display_name, password } = req.body;
  if (!display_name || display_name.trim().length < 2)
    return res.status(400).json({ error: 'Имя минимум 2 символа' });
  if (!password || password.length < 4)
    return res.status(400).json({ error: 'Пароль минимум 4 символа' });

  const id = nanoId();
  const code = generateUniqueCode();
  const user = {
    id,
    user_code: code,
    display_name: display_name.trim(),
    password,
    avatar: null
  };
  users.set(id, user);
  usersByCode.set(code, id);

  res.json(publicUser(user));
});

app.post('/api/login', (req, res) => {
  const { user_code, password } = req.body;
  const id = usersByCode.get((user_code || '').toUpperCase().trim());
  const user = id ? users.get(id) : null;
  if (!user || user.password !== password)
    return res.status(401).json({ error: 'Ничего не нашли в данных' });
  res.json(publicUser(user));
});

app.get('/api/find', (req, res) => {
  const code = (req.query.code || '').toUpperCase().trim();
  const id = usersByCode.get(code);
  const user = id ? users.get(id) : null;
  if (!user) return res.status(404).json({ error: 'Ничего не нашли в данных' });
  res.json(publicUser(user));
});

app.post('/api/avatar', (req, res) => {
  const { user_id, avatar } = req.body;
  const user = users.get(user_id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (typeof avatar !== 'string' || avatar.length > 15 * 1024 * 1024)
    return res.status(400).json({ error: 'Слишком большое изображение' });
  if (avatar && !avatar.startsWith('data:image/'))
    return res.status(400).json({ error: 'Неверный формат' });
  user.avatar = avatar || null;
  res.json(publicUser(user));
});

app.post('/api/chat', (req, res) => {
  const { my_id, other_id } = req.body;
  if (my_id === other_id) return res.status(400).json({ error: 'Это вы' });

  const [u1, u2] = [my_id, other_id].sort();
  const chatId = u1 + '_' + u2;

  if (!chats.has(chatId)) {
    chats.set(chatId, { id: chatId, user1_id: u1, user2_id: u2 });
    messages.set(chatId, []);
  }
  res.json(chats.get(chatId));
});

app.get('/api/messages/:chatId', (req, res) => {
  res.json(messages.get(req.params.chatId) || []);
});

app.get('/api/chats/:userId', (req, res) => {
  const list = [];
  for (const chat of chats.values()) {
    if (chat.user1_id !== req.params.userId && chat.user2_id !== req.params.userId) continue;
    const otherId = chat.user1_id === req.params.userId ? chat.user2_id : chat.user1_id;
    const other = users.get(otherId);
    if (!other) continue;
    list.push({
      id: chat.id,
      other_id: other.id,
      other_name: other.display_name,
      other_code: other.user_code,
      other_avatar: other.avatar || null
    });
  }
  res.json(list);
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Нет файла' });
  const b64 = req.file.buffer.toString('base64');
  const dataUrl = `data:${req.file.mimetype};base64,${b64}`;
  res.json({ url: dataUrl });
});

const onlineUsers = new Map();
io.on('connection', (socket) => {
  socket.on('auth', (userId) => {
    onlineUsers.set(userId, socket.id);
    socket.userId = userId;
  });

  socket.on('send_message', (payload, ack) => {
    const msg = {
      id: nanoId(),
      chat_id: payload.chat_id,
      sender_id: payload.sender_id,
      type: payload.type,
      content: payload.content,
      created_at: Date.now()
    };
    if (!messages.has(payload.chat_id)) messages.set(payload.chat_id, []);
    messages.get(payload.chat_id).push(msg);

    const chat = chats.get(payload.chat_id);
    if (chat) {
      const otherId = chat.user1_id === payload.sender_id ? chat.user2_id : chat.user1_id;
      const otherSocket = onlineUsers.get(otherId);
      if (otherSocket) io.to(otherSocket).emit('new_message', msg);
    }
    if (ack) ack(msg);
  });

  socket.on('disconnect', () => {
    if (socket.userId) onlineUsers.delete(socket.userId);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`СОУЧ Май: http://localhost:${PORT}`);
});