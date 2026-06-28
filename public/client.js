const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let loadedSkins = {};

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const socket = io();

let cells = [];
let foods = [];
let ejectedMass = [];
let viruses = [];
let leaderboard = [];
let players = {};
let myId = null;
let isPlaying = false;
let isSpectating = false;

let camX = 0;
let camY = 0;
let currentZoom = 1;

let mouseX = window.innerWidth / 2;
let mouseY = window.innerHeight / 2;

const WORLD_SIZE = 6000;

let xp = parseInt(localStorage.getItem('agario_xp')) || 0;
let level = Math.floor(Math.sqrt(xp / 100)) + 1;
let nextLevelXp = Math.pow(level, 2) * 100;
let prevLevelXp = Math.pow(level - 1, 2) * 100;
let progress = ((xp - prevLevelXp) / (nextLevelXp - prevLevelXp)) * 100;

document.getElementById('level-display').innerText = `Level ${level}`;
document.getElementById('level-progress').style.width = `${progress}%`;

let maxMass = 0;

const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');
const chatContainer = document.getElementById('chat-container');

function joinGame() {
    let name = document.getElementById('username').value.trim();
    let modeInput = document.getElementById('modeInput');
    let selectedMode = modeInput ? modeInput.value : 'FFA';
    
    socket.emit('join', { name: name, level: level, mode: selectedMode });
    document.getElementById('login-panel').style.display = 'none';
    if(document.getElementById('setting-chat').checked) {
        document.getElementById('chat-container').style.display = 'flex';
    }
    document.getElementById('leaderboard').style.display = 'block';
    isPlaying = true;
    isSpectating = false;
    maxMass = 0;
}

function spectateGame() {
    socket.emit('spectate');
    document.getElementById('login-panel').style.display = 'none';
    if(document.getElementById('setting-chat').checked) {
        document.getElementById('chat-container').style.display = 'flex';
    }
    document.getElementById('leaderboard').style.display = 'block';
    isSpectating = true;
    isPlaying = false;
}

document.getElementById('play-btn').addEventListener('click', joinGame);
document.getElementById('spectate-btn').addEventListener('click', spectateGame);

document.getElementById('setting-chat').addEventListener('change', (e) => {
    if (isPlaying || isSpectating) {
        document.getElementById('chat-container').style.display = e.target.checked ? 'flex' : 'none';
    }
});

window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});

window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
});

const joystick = document.getElementById('joystick');
const joystickKnob = document.getElementById('joystick-knob');
let joystickActive = false;
let joystickCenter = { x: 0, y: 0 };

joystick.addEventListener('touchstart', (e) => {
    e.preventDefault();
    joystickActive = true;
    let rect = joystick.getBoundingClientRect();
    joystickCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    updateJoystick(e.touches[0]);
}, {passive: false});

joystick.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (joystickActive) updateJoystick(e.touches[0]);
}, {passive: false});

joystick.addEventListener('touchend', (e) => {
    e.preventDefault();
    joystickActive = false;
    joystickKnob.style.transform = `translate(0px, 0px)`;
    mouseX = window.innerWidth / 2;
    mouseY = window.innerHeight / 2;
});

function updateJoystick(touch) {
    let dx = touch.clientX - joystickCenter.x;
    let dy = touch.clientY - joystickCenter.y;
    let dist = Math.hypot(dx, dy);
    let maxDist = 50;
    
    if (dist > maxDist) {
        dx = (dx / dist) * maxDist;
        dy = (dy / dist) * maxDist;
    }
    
    joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    
    mouseX = window.innerWidth / 2 + (dx / maxDist) * 300;
    mouseY = window.innerHeight / 2 + (dy / maxDist) * 300;
}

document.getElementById('btn-split').addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (isPlaying) socket.emit('split');
}, {passive: false});

document.getElementById('btn-eject').addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (isPlaying) socket.emit('eject');
}, {passive: false});

let chatTimeout;

chatInput.addEventListener('focus', () => {
    chatMessages.style.display = 'block';
    chatInput.style.borderRadius = '0 0 5px 5px';
    clearTimeout(chatTimeout);
});

chatInput.addEventListener('blur', () => {
    clearTimeout(chatTimeout);
    chatTimeout = setTimeout(() => {
        chatMessages.style.display = 'none';
        chatInput.style.borderRadius = '5px';
    }, 5000);
});

let isEjecting = false;
let ejectInterval = null;

window.addEventListener('keydown', (e) => {
    if (e.code === 'Enter') {
        if (document.activeElement === chatInput) {
            let msg = chatInput.value.trim();
            if (msg) socket.emit('chatMsg', msg);
            chatInput.value = '';
            chatInput.blur();
        } else {
            chatInput.focus();
        }
    }
    
    if (document.activeElement === chatInput) return;

    if (!isPlaying) return;
    if (e.code === 'Space') {
        socket.emit('split');
    } else if (e.code === 'KeyW') {
        if (!isEjecting) {
            isEjecting = true;
            socket.emit('eject'); // emit instantly once
            ejectInterval = setInterval(() => {
                if (isPlaying && isEjecting) {
                    socket.emit('eject');
                }
            }, 60); // Roughly 16 times a second, safely under the 25 limit
        }
    }
});

window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyW') {
        isEjecting = false;
        clearInterval(ejectInterval);
    }
});

let manualZoom = 1;

window.addEventListener('wheel', (e) => {
    if (e.deltaY > 0) {
        manualZoom *= 0.9;
    } else {
        manualZoom *= 1.1;
    }
    manualZoom = Math.max(1.0, Math.min(3, manualZoom));
});

setInterval(() => {
    if (isPlaying && myId) {
        let dx = mouseX - window.innerWidth / 2;
        let dy = mouseY - window.innerHeight / 2;
        
        let targetX = camX + (dx / currentZoom);
        let targetY = camY + (dy / currentZoom);
        
        socket.emit('updateTarget', { x: targetX, y: targetY });
    }
}, 1000 / 60);

socket.on('init', (data) => {
    myId = data.id;
    foods = data.foods;
    
    if (data.skins) {
        for (let skinName in data.skins) {
            if (!loadedSkins[skinName]) {
                let img = new Image();
                img.src = '/skins/' + data.skins[skinName];
                loadedSkins[skinName] = img;
            }
        }
    }
    
    isPlaying = true;
});

socket.on('foodAdded', (food) => {
    foods.push(food);
});

socket.on('foodEaten', (ids) => {
    foods = foods.filter(f => !ids.includes(f.id));
});

socket.on('update', (data) => {
    let serverCells = data.cells;
    let serverEjectedMass = data.ejectedMass;
    leaderboard = data.leaderboard;
    players = data.players;
    let serverViruses = data.viruses;
    
    let newCells = [];
    for (let sc of serverCells) {
        let existing = cells.find(c => c.id === sc.id);
        if (existing) {
            existing.targetX = sc.x;
            existing.targetY = sc.y;
            existing.targetR = sc.r;
            newCells.push(existing);
        } else {
            newCells.push({ ...sc, targetX: sc.x, targetY: sc.y, targetR: sc.r });
        }
    }
    cells = newCells;

    let newMass = [];
    for (let sm of serverEjectedMass) {
        let existing = ejectedMass.find(m => m.id === sm.id);
        if (existing) {
            existing.targetX = sm.x;
            existing.targetY = sm.y;
            existing.targetR = sm.r;
            newMass.push(existing);
        } else {
            newMass.push({ ...sm, targetX: sm.x, targetY: sm.y, targetR: sm.r });
        }
    }
    ejectedMass = newMass;
    
    let newViruses = [];
    for (let sv of serverViruses) {
        let existing = viruses.find(v => v.id === sv.id);
        if (existing) {
            existing.targetX = sv.x;
            existing.targetY = sv.y;
            existing.targetR = sv.r;
            newViruses.push(existing);
        } else {
            newViruses.push({ ...sv, targetX: sv.x, targetY: sv.y, targetR: sv.r });
        }
    }
    viruses = newViruses;

    if (myId && players[myId]) {
        let scoreDisplay = document.getElementById('score-display');
        if (scoreDisplay) scoreDisplay.innerText = players[myId].score;
        
        let coordsDisplay = document.getElementById('coords-display');
        if (coordsDisplay) {
            let letters = ['A','B','C','D','E','F', 'G', 'H'];
            // 6000 world width, 1000 per sector (roughly)
            let sx = Math.floor(camX / (6000/letters.length));
            let sy = Math.floor(camY / (6000/letters.length));
            sx = Math.max(0, Math.min(letters.length - 1, sx));
            sy = Math.max(0, Math.min(letters.length - 1, sy));
            coordsDisplay.innerText = `Sector ${letters[sy]}${sx + 1}`;
        }
    }
    
    let sortedPlayers = Object.entries(players).map(([id, p]) => ({ id, ...p })).sort((a, b) => b.score - a.score);
    let lbHTML = '';
    let foundSelf = false;

    for (let i = 0; i < sortedPlayers.length; i++) {
        let p = sortedPlayers[i];
        let name = p.name || 'Unnamed';
        let isMe = (p.id === myId);
        
        if (isMe) foundSelf = true;
        
        if (i < 10) {
            let classMe = isMe ? 'lb-me' : '';
            lbHTML += `<li class="${classMe}"><span class="lb-rank">${i + 1}.</span><span class="lb-name">${name}</span></li>`;
        }
    }
    
    if (!foundSelf && myId && players[myId]) {
        let myRank = sortedPlayers.findIndex(p => p.id === myId) + 1;
        let me = players[myId];
        let name = me.name || 'Unnamed';
        lbHTML += `<li class="lb-me" style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.2);"><span class="lb-rank">${myRank}.</span><span class="lb-name">${name}</span></li>`;
    }

    let lbList = document.getElementById('leaderboard-list');
    if (lbList) lbList.innerHTML = lbHTML;
});

socket.on('chatMsg', (data) => {
    let el = document.createElement('div');
    el.className = 'chat-msg';
    el.innerHTML = `<span class="chat-name">${data.name}:</span> <span class="chat-text">${data.msg}</span>`;
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    chatMessages.style.display = 'block';
    chatInput.style.borderRadius = '0 0 5px 5px';
    
    if (document.activeElement !== chatInput) {
        clearTimeout(chatTimeout);
        chatTimeout = setTimeout(() => {
            chatMessages.style.display = 'none';
            chatInput.style.borderRadius = '5px';
        }, 5000);
    }
});

socket.on('died', (stats) => {
    let gainedXp = Math.floor(maxMass / 10);
    xp += gainedXp;
    localStorage.setItem('agario_xp', xp);
    
    level = Math.floor(Math.sqrt(xp / 100)) + 1;
    nextLevelXp = Math.pow(level, 2) * 100;
    prevLevelXp = Math.pow(level - 1, 2) * 100;
    progress = ((xp - prevLevelXp) / (nextLevelXp - prevLevelXp)) * 100;
    
    document.getElementById('level-display').innerText = `Level ${level}`;
    document.getElementById('level-progress').style.width = `${progress}%`;

    let statsHtml = `
        <div style="font-size: 16px; margin-bottom: 5px;">Time Alive: <strong>${Math.floor(stats.timeAlive / 60)}m ${stats.timeAlive % 60}s</strong></div>
        <div style="font-size: 16px; margin-bottom: 5px;">Highest Score: <strong>${stats.maxScore}</strong></div>
        <div style="font-size: 16px; margin-bottom: 5px;">Food Eaten: <strong>${stats.foodEaten}</strong></div>
        <div style="font-size: 16px; margin-bottom: 15px;">Cells Eaten: <strong>${stats.cellsEaten}</strong></div>
        <div style="font-size: 14px; color: #5cb85c;">XP Gained: <strong>+${gainedXp}</strong></div>
    `;

    document.getElementById('death-stats').innerHTML = statsHtml;
    
    document.getElementById('game-over').style.display = 'block';
    isPlaying = false;
    myId = null;
});

function drawCircle(x, y, r, color, hasText, ownerId) {
    let actualR = Math.max(1, r);

    let playerName = (hasText && players[ownerId]) ? players[ownerId].name : null;
    let skinKey = playerName ? playerName.toLowerCase() : null;
    let skinImg = skinKey ? loadedSkins[skinKey] : null;

    ctx.save();
    ctx.beginPath();
    
    if (hasText && actualR > 15 && !skinImg) {
        let time = Date.now() / 300;
        let points = Math.min(60, Math.floor(actualR / 4) + 15);
        let angleStep = (Math.PI * 2) / points;
        
        for (let i = 0; i <= points; i++) {
            let angle = i * angleStep;
            // The wobble effect formula
            let wobble = Math.sin(angle * 5 + time + ownerId.length) * (actualR * 0.03); 
            if (wobble > 5) wobble = 5;
            
            let px = x + Math.cos(angle) * (actualR + wobble);
            let py = y + Math.sin(angle) * (actualR + wobble);
            
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
    } else {
        ctx.arc(x, y, actualR, 0, Math.PI * 2);
    }
    
    ctx.closePath();

    if (skinImg && skinImg.complete && skinImg.naturalWidth !== 0) {
        ctx.save();
        ctx.clip();
        ctx.drawImage(skinImg, x - actualR, y - actualR, actualR * 2, actualR * 2);
        ctx.restore();
    } else {
        ctx.fillStyle = color;
        ctx.fill();
    }

    ctx.lineWidth = 3;
    ctx.strokeStyle = darkenColor(color, 20);
    ctx.stroke();
    ctx.restore();

    if (hasText && r > 15 && players[ownerId]) {
        let showNames = document.getElementById('setting-names').checked;
        let showMass = document.getElementById('setting-mass').checked;
        
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        let fontSize = Math.max(12, r/3);
        ctx.font = 'bold ' + fontSize + 'px Ubuntu, sans-serif';
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 2;
        
        if (showNames) {
            let pName = players[ownerId].name || '';
            if (players[ownerId].level) {
                pName = `[Lv ${players[ownerId].level}] ${pName}`;
            }
            ctx.fillText(pName, x, y - (showMass && r > 30 ? fontSize/2 : 0));
        }
        
        if (showMass && r > 30) {
            ctx.font = 'bold ' + (fontSize * 0.5) + 'px Ubuntu, sans-serif';
            let mass = Math.floor((Math.PI * r * r) / 100);
            ctx.fillText(mass, x, y + (showNames ? fontSize/2 : 0));
        }
        
        ctx.shadowBlur = 0;
    }
}

function drawVirus(x, y, r) {
    ctx.fillStyle = '#33ff33';
    ctx.strokeStyle = '#22dd22';
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let spikes = 15 + Math.floor(r / 10);
    let rot = Date.now() / 2000;
    for (let i = 0; i < spikes * 2; i++) {
        let angle = rot + (i / (spikes * 2)) * Math.PI * 2;
        let dist = r + (i % 2 === 0 ? 5 : -5);
        let px = x + Math.cos(angle) * dist;
        let py = y + Math.sin(angle) * dist;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
}

function darkenColor(hex, percent) {
    if(!hex) return '#000000';
    let num = parseInt(hex.replace('#',''), 16),
        amt = Math.round(2.55 * percent),
        R = (num >> 16) - amt,
        B = (num >> 8 & 0x00FF) - amt,
        G = (num & 0x0000FF) - amt;
    return "#" + (0x1000000 + (R<255?R<1?0:R:255)*0x10000 + (B<255?B<1?0:B:255)*0x100 + (G<255?G<1?0:G:255)).toString(16).slice(1);
}

function lerp(start, end, amt) {
    return (1 - amt) * start + amt * end;
}

let lastTime = performance.now();

function loop() {
    let now = performance.now();
    let dt = (now - lastTime) / (1000 / 60); 
    lastTime = now;
    
    let lerpFactor = 0.35 * dt;
    if (lerpFactor > 1) lerpFactor = 1;
    
    for (let c of cells) {
        if (c.targetX !== undefined) {
            c.x += (c.targetX - c.x) * lerpFactor;
            c.y += (c.targetY - c.y) * lerpFactor;
            c.r += (c.targetR - c.r) * lerpFactor;
        }
    }
    for (let m of ejectedMass) {
        if (m.targetX !== undefined) {
            m.x += (m.targetX - m.x) * lerpFactor;
            m.y += (m.targetY - m.y) * lerpFactor;
        }
    }
    for (let v of viruses) {
        if (v.targetX !== undefined) {
            v.x += (v.targetX - v.x) * lerpFactor;
            v.y += (v.targetY - v.y) * lerpFactor;
        }
    }

    if (isPlaying) {
        let myCells = cells.filter(c => c.ownerId === myId);
        let avgX = 0, avgY = 0;
        let totalMass = 0;

        for (let c of myCells) {
            avgX += c.x;
            avgY += c.y;
            totalMass += (c.r * c.r);
        }
        
        let displayMass = (totalMass * Math.PI) / 100;
        if (displayMass > maxMass) maxMass = displayMass;

        let combinedR = Math.max(20, Math.sqrt(totalMass));

        if (myCells.length > 0) {
            avgX /= myCells.length;
            avgY /= myCells.length;
            if (camX === 0 && camY === 0) {
                camX = avgX;
                camY = avgY;
            } else {
                camX += (avgX - camX) * Math.min(1, 0.1 * dt);
                camY += (avgY - camY) * Math.min(1, 0.1 * dt);
            }

            let baseTargetZoom = Math.pow(40 / combinedR, 0.6);
            let targetZoom = baseTargetZoom * manualZoom;
            if (targetZoom > 3) targetZoom = 3;
            if (targetZoom < 0.05) targetZoom = 0.05;
            currentZoom += (targetZoom - currentZoom) * (0.05 * dt);
        }
    } else if (isSpectating) {
        let largest = cells.reduce((max, c) => (c.r > (max ? max.r : 0) ? c : max), null);
        if (largest) {
            camX += (largest.x - camX) * 0.1 * dt;
            camY += (largest.y - camY) * 0.1 * dt;
            let baseTargetZoom = Math.pow(25 / largest.r, 0.4);
            let targetZoom = baseTargetZoom * manualZoom;
            currentZoom += (Math.max(0.05, Math.min(2, targetZoom)) - currentZoom) * (0.05 * dt);
        }
    }

    let darkTheme = document.getElementById('setting-dark').checked;
    ctx.fillStyle = darkTheme ? '#111111' : '#f2f2f2';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(currentZoom, currentZoom);
    ctx.translate(-camX, -camY);

    let vw = canvas.width / currentZoom;
    let vh = canvas.height / currentZoom;
    let gridStep = 50;
    if (currentZoom < 0.4) gridStep = 100;
    if (currentZoom < 0.15) gridStep = 250;
    if (currentZoom < 0.05) gridStep = 500;

    let startX = Math.max(0, Math.floor((camX - vw/2) / gridStep) * gridStep);
    let startY = Math.max(0, Math.floor((camY - vh/2) / gridStep) * gridStep);
    let endX = Math.min(WORLD_SIZE, startX + vw + gridStep);
    let endY = Math.min(WORLD_SIZE, startY + vh + gridStep);

    ctx.strokeStyle = darkTheme ? '#222222' : '#dddddd';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = startX; x <= endX; x += gridStep) {
        ctx.moveTo(x, startY);
        ctx.lineTo(x, endY);
    }
    for (let y = startY; y <= endY; y += gridStep) {
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
    }
    ctx.stroke();

    ctx.strokeStyle = darkTheme ? '#555' : '#888';
    ctx.lineWidth = 10;
    ctx.strokeRect(0, 0, WORLD_SIZE, WORLD_SIZE);

    let camMinX = camX - vw / 2;
    let camMaxX = camX + vw / 2;
    let camMinY = camY - vh / 2;
    let camMaxY = camY + vh / 2;

    for (let f of foods) {
        if (f && f.x + f.r >= camMinX && f.x - f.r <= camMaxX && f.y + f.r >= camMinY && f.y - f.r <= camMaxY) {
            drawCircle(f.x, f.y, f.r, f.color, false);
        }
    }
    
    for (let m of ejectedMass) {
        if (m && m.x + m.r >= camMinX && m.x - m.r <= camMaxX && m.y + m.r >= camMinY && m.y - m.r <= camMaxY) {
            drawCircle(m.x, m.y, m.r, m.color, false);
        }
    }

    let sortedCells = cells.slice().sort((a, b) => a.r - b.r);
    for (let c of sortedCells) {
        if (c.x + c.r >= camMinX && c.x - c.r <= camMaxX && c.y + c.r >= camMinY && c.y - c.r <= camMaxY) {
            drawCircle(c.x, c.y, c.r, c.color, true, c.ownerId);
        }
    }

    for (let v of viruses) {
        if (v && v.x + v.r >= camMinX && v.x - v.r <= camMaxX && v.y + v.r >= camMinY && v.y - v.r <= camMaxY) {
            drawVirus(v.x, v.y, v.r);
        }
    }
    ctx.restore();
    requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
