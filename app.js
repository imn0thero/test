const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs').promises;
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Paths to JSON files
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const MESSAGES_FILE = path.join(__dirname, 'data', 'messages.json');

// Initialize JSON files if they don't exist
async function initializeFiles() {
    try {
        await fs.access(USERS_FILE);
    } catch {
        await fs.writeFile(USERS_FILE, JSON.stringify([]));
    }
    try {
        await fs.access(MESSAGES_FILE);
    } catch {
        await fs.writeFile(MESSAGES_FILE, JSON.stringify([]));
    }
}
initializeFiles();

// Load data from JSON files
async function loadUsers() {
    const data = await fs.readFile(USERS_FILE, 'utf8');
    return JSON.parse(data);
}

async function saveUsers(users) {
    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
}

async function loadMessages() {
    const data = await fs.readFile(MESSAGES_FILE, 'utf8');
    return JSON.parse(data);
}

async function saveMessages(messages) {
    await fs.writeFile(MESSAGES_FILE, JSON.stringify(messages, null, 2));
}

// Auto-delete messages older than 24 hours
async function cleanOldMessages() {
    const messages = await loadMessages();
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const filteredMessages = messages.filter(msg => now - msg.timestamp < oneDay);
    await saveMessages(filteredMessages);
}

// Run cleanup every hour
setInterval(cleanOldMessages, 60 * 60 * 1000);

// Serve HTML pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, 'public', 'signup.html')));

// Handle signup
app.post('/api/signup', async (req, res) => {
    const { username, password } = req.body;
    const users = await loadUsers();
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'Username already exists' });
    }
    users.push({ username, password, online: false, lastOnline: null });
    await saveUsers(users);
    res.json({ success: true });
});

// Handle login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const users = await loadUsers();
    const user = users.find(u => u.username === username && u.password === password);
    if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    user.online = true;
    await saveUsers(users);
    res.json({ success: true, username });
});

// Handle logout
app.post('/api/logout', async (req, res) => {
    const { username } = req.body;
    const users = await loadUsers();
    const user = users.find(u => u.username === username);
    if (user) {
        user.online = false;
        user.lastOnline = new Date().toISOString();
        await saveUsers(users);
    }
    res.json({ success: true });
});

// Socket.IO for real-time chat
const onlineUsers = new Set();

io.on('connection', (socket) => {
    socket.on('user-connected', async (username) => {
        onlineUsers.add(username);
        socket.username = username;
        io.emit('update-users', { onlineUsers: Array.from(onlineUsers), users: await loadUsers() });

        // Send existing messages
        const messages = await loadMessages();
        socket.emit('load-messages', messages.filter(msg => msg.from === username || msg.to === username));
    });

    socket.on('send-message', async (data) => {
        const { from, to, content, type } = data;
        const message = { from, to, content, type, timestamp: Date.now() };
        const messages = await loadMessages();
        messages.push(message);
        await saveMessages(messages);
        io.to(to).emit('receive-message', message);
        io.to(from).emit('receive-message', message);
    });

    socket.on('delete-messages', async (username) => {
        const messages = await loadMessages();
        const filteredMessages = messages.filter(msg => msg.from !== username && msg.to !== username);
        await saveMessages(filteredMessages);
        io.to(username).emit('load-messages', []);
    });

    socket.on('disconnect', async () => {
        if (socket.username) {
            onlineUsers.delete(socket.username);
            const users = await loadUsers();
            const user = users.find(u => u.username === socket.username);
            if (user) {
                user.online = false;
                user.lastOnline = new Date().toISOString();
                await saveUsers(users);
            }
            io.emit('update-users', { onlineUsers: Array.from(onlineUsers), users });
        }
    });

    // Join room for private messaging
    socket.on('join-room', (username) => {
        socket.join(username);
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
