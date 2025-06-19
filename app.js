const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Create directories if they don't exist
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|mp4|mp3|pdf|doc|docx/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('File type not allowed'));
        }
    }
});

// Data files
const USERS_FILE = 'data/users.json';
const MESSAGES_FILE = 'data/messages.json';

// Create data directory if it doesn't exist
if (!fs.existsSync('data')) {
    fs.mkdirSync('data');
}

// Initialize data files
function initializeDataFiles() {
    if (!fs.existsSync(USERS_FILE)) {
        fs.writeFileSync(USERS_FILE, JSON.stringify([]));
    }
    if (!fs.existsSync(MESSAGES_FILE)) {
        fs.writeFileSync(MESSAGES_FILE, JSON.stringify([]));
    }
}

initializeDataFiles();

// Helper functions
function readUsers() {
    try {
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
}

function writeUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function readMessages() {
    try {
        const data = fs.readFileSync(MESSAGES_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
}

function writeMessages(messages) {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
}

// Auto-delete messages older than 24 hours
function cleanOldMessages() {
    const messages = readMessages();
    const now = Date.now();
    const dayInMs = 24 * 60 * 60 * 1000;
    
    const filteredMessages = messages.filter(msg => {
        return (now - msg.timestamp) < dayInMs;
    });
    
    if (filteredMessages.length !== messages.length) {
        writeMessages(filteredMessages);
        console.log(`Deleted ${messages.length - filteredMessages.length} old messages`);
    }
}

// Clean old messages every hour
setInterval(cleanOldMessages, 60 * 60 * 1000);

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/signup', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});

app.post('/api/signup', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    
    const users = readUsers();
    
    // Check if user already exists
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'Username already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Add new user
    const newUser = {
        id: Date.now().toString(),
        username,
        password: hashedPassword,
        isOnline: false,
        lastSeen: Date.now()
    };
    
    users.push(newUser);
    writeUsers(users);
    
    res.json({ success: true, message: 'User created successfully' });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    const users = readUsers();
    const user = users.find(u => u.username === username);
    
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Update user status
    user.isOnline = true;
    user.lastSeen = Date.now();
    writeUsers(users);
    
    res.json({ 
        success: true, 
        user: { 
            id: user.id, 
            username: user.username,
            isOnline: user.isOnline,
            lastSeen: user.lastSeen
        } 
    });
});

app.post('/api/logout', (req, res) => {
    const { userId } = req.body;
    
    const users = readUsers();
    const user = users.find(u => u.id === userId);
    
    if (user) {
        user.isOnline = false;
        user.lastSeen = Date.now();
        writeUsers(users);
    }
    
    res.json({ success: true });
});

app.get('/api/messages', (req, res) => {
    const messages = readMessages();
    res.json(messages);
});

app.get('/api/users', (req, res) => {
    const users = readUsers();
    const publicUsers = users.map(u => ({
        id: u.id,
        username: u.username,
        isOnline: u.isOnline,
        lastSeen: u.lastSeen
    }));
    res.json(publicUsers);
});

app.delete('/api/messages', (req, res) => {
    writeMessages([]);
    res.json({ success: true });
});

app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    
    res.json({
        success: true,
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        url: `/uploads/${req.file.filename}`
    });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    socket.on('join', (userData) => {
        socket.userId = userData.id;
        socket.username = userData.username;
        
        // Update user online status
        const users = readUsers();
        const user = users.find(u => u.id === userData.id);
        if (user) {
            user.isOnline = true;
            user.lastSeen = Date.now();
            writeUsers(users);
        }
        
        // Broadcast online users
        const onlineUsers = users.filter(u => u.isOnline).map(u => ({
            id: u.id,
            username: u.username,
            isOnline: u.isOnline,
            lastSeen: u.lastSeen
        }));
        
        io.emit('userStatusUpdate', onlineUsers);
        
        // Send existing messages to the user
        const messages = readMessages();
        socket.emit('loadMessages', messages);
    });
    
    socket.on('sendMessage', (messageData) => {
        const message = {
            id: Date.now().toString(),
            userId: socket.userId,
            username: socket.username,
            content: messageData.content,
            type: messageData.type || 'text',
            file: messageData.file || null,
            timestamp: Date.now()
        };
        
        // Save message
        const messages = readMessages();
        messages.push(message);
        writeMessages(messages);
        
        // Broadcast message to all users
        io.emit('newMessage', message);
    });
    
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        if (socket.userId) {
            // Update user offline status
            const users = readUsers();
            const user = users.find(u => u.id === socket.userId);
            if (user) {
                user.isOnline = false;
                user.lastSeen = Date.now();
                writeUsers(users);
            }
            
            // Broadcast updated online users
            const onlineUsers = users.filter(u => u.isOnline).map(u => ({
                id: u.id,
                username: u.username,
                isOnline: u.isOnline,
                lastSeen: u.lastSeen
            }));
            
            io.emit('userStatusUpdate', onlineUsers);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
