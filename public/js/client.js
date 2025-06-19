const socket = io();
let currentUser = null;
let selectedUser = null;

// Login form
const loginForm = document.getElementById('login-form');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const result = await response.json();
        if (result.success) {
            localStorage.setItem('username', username);
            window.location.href = '/';
        } else {
            alert(result.error);
        }
    });
}

// Signup form
const signupForm = document.getElementById('signup-form');
if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const response = await fetch('/api/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const result = await response.json();
        if (result.success) {
            window.location.href = '/login';
        } else {
            alert(result.error);
        }
    });
}

// Chat page
if (document.getElementById('messages')) {
    currentUser = localStorage.getItem('username');
    if (!currentUser) {
        window.location.href = '/login';
        return;
    }

    socket.emit('user-connected', currentUser);
    socket.emit('join-room', currentUser);

    // Logout
    document.getElementById('logout-btn').addEventListener('click', async () => {
        await fetch('/api/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: currentUser })
        });
        localStorage.removeItem('username');
        window.location.href = '/login';
    });

    // Delete messages
    document.getElementById('delete-messages-btn').addEventListener('click', () => {
        socket.emit('delete-messages', currentUser);
    });

    // Send message
    document.getElementById('send-btn').addEventListener('click', () => {
        const messageInput = document.getElementById('message-input');
        const fileInput = document.getElementById('file-input');
        if (!selectedUser) {
            alert('Select a user to chat with');
            return;
        }
        if (messageInput.value.trim()) {
            socket.emit('send-message', {
                from: currentUser,
                to: selectedUser,
                content: messageInput.value,
                type: 'text'
            });
            messageInput.value = '';
        }
        if (fileInput.files[0]) {
            const reader = new FileReader();
            reader.onload = () => {
                socket.emit('send-message', {
                    from: currentUser,
                    to: selectedUser,
                    content: reader.result,
                    type: fileInput.files[0].type.startsWith('image') ? 'image' : 'video'
                });
                fileInput.value = '';
            };
            reader.readAsDataURL(fileInput.files[0]);
        }
    });

    // Update user list
    socket.on('update-users', ({ onlineUsers, users }) => {
        const userList = document.getElementById('user-list');
        userList.innerHTML = '';
        users.forEach(user => {
            if (user.username !== currentUser) {
                const li = document.createElement('li');
                li.textContent = `${user.username} (${user.online ? 'Online' : 'Last online: ' + new Date(user.lastOnline).toLocaleString()})`;
                li.className = user.online ? 'online' : 'offline';
                li.addEventListener('click', () => {
                    selectedUser = user.username;
                    document.getElementById('chat-with').textContent = user.username;
                    document.querySelectorAll('#user-list li').forEach(el => el.classList.remove('selected'));
                    li.classList.add('selected');
                    loadMessages();
                });
                userList.appendChild(li);
            }
        });
    });

    // Load messages
    socket.on('load-messages', (messages) => {
        const messagesDiv = document.getElementById('messages');
        messagesDiv.innerHTML = '';
        messages.forEach(msg => {
            if ((msg.from === currentUser && msg.to === selectedUser) || (msg.from === selectedUser && msg.to === currentUser)) {
                const div = document.createElement('div');
                div.className = msg.from === currentUser ? 'message sent' : 'message received';
                if (msg.type === 'text') {
                    div.textContent = msg.content;
                } else if (msg.type === 'image') {
                    const img = document.createElement('img');
                    img.src = msg.content;
                    img.style.maxWidth = '200px';
                    div.appendChild(img);
                } else if (msg.type === 'video') {
                    const video = document.createElement('video');
                    video.src = msg.content;
                    video.controls = true;
                    video.style.maxWidth = '200px';
                    div.appendChild(video);
                }
                messagesDiv.appendChild(div);
            }
        });
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    });

    // Receive message
    socket.on('receive-message', (msg) => {
        if ((msg.from === selectedUser && msg.to === currentUser) || (msg.from === currentUser && msg.to === selectedUser)) {
            const messagesDiv = document.getElementById('messages');
            const div = document.createElement('div');
            div.className = msg.from === currentUser ? 'message sent' : 'message received';
            if (msg.type === 'text') {
                div.textContent = msg.content;
            } else if (msg.type === 'image') {
                const img = document.createElement('img');
                img.src = msg.content;
                img.style.maxWidth = '200px';
                div.appendChild(img);
            } else if (msg.type === 'video') {
                const video = document.createElement('video');
                video.src = msg.content;
                video.controls = true;
                video.style.maxWidth = '200px';
                div.appendChild(video);
            }
            messagesDiv.appendChild(div);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }
    });
        }
