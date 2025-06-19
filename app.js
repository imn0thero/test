const express = require('express');
const fs = require('fs');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

const upload = multer({ dest: 'public/uploads/' });

let users = require('./data/users.json');
let messages = require('./data/messages.json');

// Middleware session sederhana (tanpa DB, untuk testing 2 user)
let currentSessions = {}; // { username: lastOnline }

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Auto-hapus pesan > 24 jam
function cleanOldMessages() {
  const now = Date.now();
  messages = messages.filter(m => now - m.timestamp <= 86400000);
  saveJSON('./data/messages.json', messages);
}

setInterval(cleanOldMessages, 60000); // tiap 1 menit

// ROUTES
app.get('/', (req, res) => res.redirect('/login.html'));

app.post('/signup', (req, res) => {
  const { username, password } = req.body;
  if (users.find(u => u.username === username)) {
    return res.status(400).send('Username sudah digunakan');
  }
  users.push({ username, password, lastOnline: null });
  saveJSON('./data/users.json', users);
  res.redirect('/login.html');
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) return res.status(400).send('Login gagal');
  currentSessions[username] = Date.now();
  res.redirect(`/index.html?user=${username}`);
});

app.get('/messages', (req, res) => {
  cleanOldMessages();
  res.json(messages);
});

app.post('/message', upload.single('media'), (req, res) => {
  const { sender, text } = req.body;
  const media = req.file ? `/uploads/${req.file.filename}` : null;
  const msg = { sender, text, media, timestamp: Date.now() };
  messages.push(msg);
  saveJSON('./data/messages.json', messages);
  io.emit('newMessage', msg);
  res.sendStatus(200);
});

app.post('/logout', (req, res) => {
  const { username } = req.body;
  const user = users.find(u => u.username === username);
  if (user) {
    user.lastOnline = new Date().toISOString();
    saveJSON('./data/users.json', users);
  }
  delete currentSessions[username];
  res.redirect('/login.html');
});

app.post('/deleteAll', (req, res) => {
  messages = [];
  saveJSON('./data/messages.json', messages);
  io.emit('clearMessages');
  res.sendStatus(200);
});

io.on('connection', socket => {
  socket.on('userOnline', username => {
    currentSessions[username] = Date.now();
    io.emit('updateStatus', currentSessions);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
