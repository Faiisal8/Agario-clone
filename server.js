const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const path = require('path');
const fs = require('fs');
const Game = require('./src/game');

const skinsDir = path.join(__dirname, 'public', 'skins');
if (!fs.existsSync(skinsDir)) {
    fs.mkdirSync(skinsDir, { recursive: true });
}
const availableSkins = {};
fs.readdirSync(skinsDir).forEach(file => {
    if (file.match(/\.(png|jpe?g|gif)$/i)) {
        let name = file.split('.')[0].toLowerCase();
        availableSkins[name] = file;
    }
});

app.use(express.static(path.join(__dirname, 'public')));

const game = new Game(io);

io.on('connection', (socket) => {
    socket.on('join', (payload) => {
        if (!payload) return;
        let name = typeof payload === 'object' ? payload.name : payload;
        if (typeof name !== 'string') name = 'Player';
        name = name.substring(0, 15);
        
        let level = (typeof payload === 'object' && typeof payload.level === 'number') ? payload.level : 1;
        let mode = typeof payload === 'object' ? payload.mode : 'FFA';
        if (mode === 'FFA' || mode === 'Fast Merge') game.mode = mode;
        
        let data = game.addPlayer(socket.id, name);
        if (game.players[socket.id]) game.players[socket.id].level = level;
        data.skins = availableSkins;
        socket.emit('init', data);
    });

    socket.on('spectate', () => {
        socket.emit('init', { id: socket.id, foods: game.foods, skins: availableSkins });
    });

    socket.on('chatMsg', (msg) => {
        if (typeof msg !== 'string') return;
        msg = msg.substring(0, 100);
        let p = game.players[socket.id];
        let name = p ? p.name : 'Spectator';
        io.emit('chatMsg', { name: name, msg: msg });
    });

    socket.on('updateTarget', (target) => {
        if (target && typeof target.x === 'number' && !isNaN(target.x) && typeof target.y === 'number' && !isNaN(target.y)) {
            game.updateTarget(socket.id, target);
        }
    });

    socket.on('split', () => {
        game.executeSplit(socket.id);
    });

    socket.on('eject', () => {
        game.executeEject(socket.id);
    });

    socket.on('disconnect', () => {
        game.removePlayer(socket.id);
    });
});

setInterval(() => {
    game.tick();
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

