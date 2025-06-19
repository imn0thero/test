const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3000;
const USERS_FILE = path.join(__dirname, 'users.json');
const MESSAGES_FILE = path.join(__dirname, 'messages.json');

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Init users.json & messages.json jika belum ada
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify({}));
}
if (!fs.existsSync(MESSAGES_FILE)) {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify([]));
}

// Buat folder uploads jika belum ada
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ⬇️ Pindahkan ke sini (sebelum endpoint digunakan)
let messages = loadMessages();
let onlineUsers = {};

// Konfigurasi multer untuk upload file
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = uuidv4() + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});
const upload = multer({ storage });

// Endpoint upload media
app.post('/upload', upload.single('media'), (req, res) => {
  console.log("Upload body:", req.body);
  console.log("Upload file:", req.file);

  if (!req.file) {
    console.log("❌ Tidak ada file diunggah.");
    return res.status(400).json({ success: false, message: 'Tidak ada file diunggah.' });
  }

  const fileUrl = `/uploads/${req.file.filename}`;
  const messageData = {
    id: uuidv4(),
    user: req.body.user || 'unknown',
    media: fileUrl,
    type: req.file.mimetype,
    time: Date.now()
  };

  messages.push(messageData);
  saveMessages(messages);

  io.emit('message', messageData);
  res.json({ success: true, file: fileUrl });
});

// Auto hapus pesan > 24 jam setiap menit
setInterval(() => {
  const now = Date.now();
  messages = messages.filter(m => now - m.time < 24 * 60 * 60 * 1000);
  saveMessages(messages);
}, 60 * 1000);

// Helper
function loadUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function loadMessages() {
  try {
    return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf-8'));
  } catch (err) {
    console.error("Gagal memuat pesan:", err);
    return [];
  }
}

function saveMessages(msgs) {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(msgs, null, 2));
}

// Socket.IO
io.on('connection', socket => {
  let currentUser = null;

  // Signup
  socket.on('signup', data => {
    const users = loadUsers();
    if (!data.username || !data.password) {
      socket.emit('signupResult', { success: false, message: 'Username dan password wajib diisi' });
      return;
    }
    if (users[data.username]) {
      socket.emit('signupResult', { success: false, message: 'Username sudah dipakai' });
    } else {
      users[data.username] = data.password;
      saveUsers(users);
      socket.emit('signupResult', { success: true });
    }
  });

  // Login
  socket.on('login', data => {
    const users = loadUsers();
    if (!data.username || !data.password) {
      socket.emit('loginResult', { success: false, message: 'Username dan password wajib diisi' });
      return;
    }
    if (users[data.username] === data.password) {
      currentUser = data.username;
      onlineUsers[currentUser] = true;

      socket.emit('loginResult', { success: true, user: currentUser, messages });
      io.emit('userList', Object.keys(onlineUsers));
    } else {
      socket.emit('loginResult', { success: false, message: 'Username atau password salah' });
    }
  });

  // Pesan teks
  socket.on('message', data => {
    if (!currentUser || !data.text || data.text.trim() === "") return;

    const messageData = {
      id: uuidv4(),
      user: currentUser,
      text: data.text.trim(),
      time: Date.now()
    };

    messages.push(messageData);
    saveMessages(messages);

    io.emit('message', messageData);
  });

  // Logout
  socket.on('logout', () => {
    if (currentUser) {
      delete onlineUsers[currentUser];
      io.emit('userList', Object.keys(onlineUsers));
      currentUser = null;
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (currentUser) {
      delete onlineUsers[currentUser];
      io.emit('userList', Object.keys(onlineUsers));
      currentUser = null;
    }
  });
});

// Jalankan server
http.listen(PORT, () => {
  console.log(`✅ Server berjalan di http://localhost:${PORT}`);
});
