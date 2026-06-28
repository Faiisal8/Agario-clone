const config = require('./config');
const { getArea, getRadius, getRandomColor } = require('./utils');
const SpatialHash = require('./spatialHash');
const { updateBots, manageBots } = require('./botAI');

class Game {
    constructor(io) {
        this.io = io;
        this.foods = [];
        this.viruses = [];
        this.ejectedMass = [];
        this.players = {}; 
        this.cells = []; 
        this.nextCellId = 1;
        this.nextFoodId = 1;
        this.foodIdCounter = 1;
        this.lastDecayTime = Date.now();
        this.initWorld();
    }

    initWorld() {
        for (let i = 0; i < config.MAX_FOOD; i++) {
            this.foods.push({
                id: this.foodIdCounter++,
                x: Math.random() * config.WORLD_WIDTH,
                y: Math.random() * config.WORLD_HEIGHT,
                r: 5, color: getRandomColor()
            });
        }
        for (let i = 0; i < config.MAX_VIRUSES; i++) {
            this.viruses.push({
                id: Math.random().toString(36),
                x: Math.random() * config.WORLD_WIDTH,
                y: Math.random() * config.WORLD_HEIGHT,
                r: 45, fed: 0
            });
        }
    }

    addPlayer(id, name) {
        this.players[id] = { id, name, targetX: config.WORLD_WIDTH / 2, targetY: config.WORLD_HEIGHT / 2, stats: { foodEaten: 0, cellsEaten: 0, spawnTime: Date.now() } };
        this.cells.push({
            id: this.nextCellId++,
            ownerId: id,
            x: Math.random() * config.WORLD_WIDTH,
            y: Math.random() * config.WORLD_HEIGHT,
            r: 20, color: getRandomColor(), name: name,
            vx: 0, vy: 0
        });
        return { id, foods: this.foods };
    }

    addBot() {
        let id = 'bot_' + Math.random().toString(36).substr(2, 9);
        let name = 'Bot ' + Math.floor(Math.random() * 100);
        let personalities = ['Aggressive', 'Timid', 'Scavenger'];
        let personality = personalities[Math.floor(Math.random() * personalities.length)];
        
        this.players[id] = { id, name, targetX: 0, targetY: 0, isBot: true, personality: personality, stats: { foodEaten: 0, cellsEaten: 0, spawnTime: Date.now() } };
        this.cells.push({
            id: this.nextCellId++,
            ownerId: id,
            x: Math.random() * config.WORLD_WIDTH,
            y: Math.random() * config.WORLD_HEIGHT,
            r: Math.random() * 20 + 20, color: getRandomColor(), name: name,
            vx: 0, vy: 0
        });
    }

    removePlayer(socketId) {
        delete this.players[socketId];
        this.cells = this.cells.filter(c => c.ownerId !== socketId);
    }

    updateTarget(socketId, target) {
        if (this.players[socketId] && !this.players[socketId].isBot) {
            this.players[socketId].targetX = target.x;
            this.players[socketId].targetY = target.y;
        }
    }

    burstFood(cell) {
        let count = Math.floor(cell.r / 10);
        for (let i = 0; i < count; i++) {
            let angle = Math.random() * Math.PI * 2;
            let dist = Math.random() * (cell.r * 2) + cell.r;
            let fx = cell.x + Math.cos(angle) * dist;
            let fy = cell.y + Math.sin(angle) * dist;
            this.foods.push({
                id: this.foodIdCounter++,
                x: Math.max(0, Math.min(config.WORLD_WIDTH, fx)),
                y: Math.max(0, Math.min(config.WORLD_HEIGHT, fy)),
                color: getRandomColor(),
                r: 5
            });
        }
    }

    executeSplit(playerId) {
        if (!this.players[playerId]) return;
        let myCells = this.cells.filter(c => c.ownerId === playerId);
        if (myCells.length >= 16) return;

        let newCells = [];
        let now = Date.now();

        for (let c of myCells) {
            if (getArea(c.r) >= config.MIN_SPLIT_AREA && myCells.length + newCells.length < 16) {
                let halfArea = getArea(c.r) / 2;
                c.r = getRadius(halfArea);
                c.splitTime = now;
                
                let dx = this.players[playerId].targetX - c.x;
                let dy = this.players[playerId].targetY - c.y;
                let dist = Math.sqrt(dx * dx + dy * dy);
                let dirX = dist > 0 ? dx/dist : 1;
                let dirY = dist > 0 ? dy/dist : 0;

                newCells.push({
                    id: this.nextCellId++,
                    ownerId: playerId,
                    x: c.x + dirX * c.r,
                    y: c.y + dirY * c.r,
                    r: c.r,
                    color: c.color,
                    vx: dirX * config.SPLIT_SPEED,
                    vy: dirY * config.SPLIT_SPEED,
                    splitTime: now
                });
            }
        }
        this.cells.push(...newCells);
    }

    executeEject(playerId) {
        if (!this.players[playerId]) return;
        let myCells = this.cells.filter(c => c.ownerId === playerId);
        for (let c of myCells) {
            if (getArea(c.r) >= config.MIN_EJECT_AREA) {
                let currentArea = getArea(c.r);
                let ejectArea = getArea(config.EJECTED_MASS_RADIUS);
                c.r = getRadius(currentArea - ejectArea);
                
                let dx = this.players[playerId].targetX - c.x;
                let dy = this.players[playerId].targetY - c.y;
                let dist = Math.sqrt(dx * dx + dy * dy);
                let dirX = dist > 0 ? dx/dist : 1;
                let dirY = dist > 0 ? dy/dist : 0;

                let ejectSpeed = config.EJECT_SPEED;

                this.ejectedMass.push({
                    id: Math.random().toString(36),
                    x: c.x + dirX * (c.r + config.EJECTED_MASS_RADIUS + 5),
                    y: c.y + dirY * (c.r + config.EJECTED_MASS_RADIUS + 5),
                    r: config.EJECTED_MASS_RADIUS,
                    color: c.color,
                    vx: dirX * ejectSpeed,
                    vy: dirY * ejectSpeed,
                    ownerId: playerId
                });
            }
        }
    }

    tick() {
        manageBots(this);
        let now = Date.now();

        if (now - this.lastDecayTime > 1000) {
            this.lastDecayTime = now;
            let decayMultiplier = this.mode === 'Fast Merge' ? 0.999 : 0.995;
            for (let c of this.cells) {
                if (c.r > 20) {
                    let area = getArea(c.r);
                    area *= decayMultiplier; 
                    c.r = Math.max(20, getRadius(area));
                }
            }
        }

        for (let m of this.ejectedMass) {
            m.x += m.vx; m.y += m.vy;
            m.vx *= 0.9; m.vy *= 0.9;
            m.x = Math.max(m.r, Math.min(config.WORLD_WIDTH - m.r, m.x));
            m.y = Math.max(m.r, Math.min(config.WORLD_HEIGHT - m.r, m.y));
        }

        for (let v of this.viruses) {
            if (v.vx || v.vy) {
                v.x += v.vx; v.y += v.vy;
                v.vx *= 0.95; v.vy *= 0.95;
                if (Math.abs(v.vx) < 0.1) v.vx = 0;
                if (Math.abs(v.vy) < 0.1) v.vy = 0;
                v.x = Math.max(v.r, Math.min(config.WORLD_WIDTH - v.r, v.x));
                v.y = Math.max(v.r, Math.min(config.WORLD_HEIGHT - v.r, v.y));
            }
        }

        let shCells = new SpatialHash(500);
        let shFoods = new SpatialHash(250);
        let shViruses = new SpatialHash(500);
        let shEjected = new SpatialHash(250);
        
        for (let c of this.cells) shCells.insert(c);
        for (let f of this.foods) shFoods.insert(f);
        for (let v of this.viruses) shViruses.insert(v);
        for (let m of this.ejectedMass) shEjected.insert(m);

        updateBots(this, shCells, shFoods, shViruses);

        for (let c of this.cells) {
            if (c.r > 50) {
                let tickDecay = this.mode === 'Fast Merge' ? 0.99995 : (config.DECAY_RATE || 0.9995);
                c.r *= tickDecay;
            }
            let p = this.players[c.ownerId];
            if (!p) continue;
            let dx = p.targetX - c.x;
            let dy = p.targetY - c.y;
            let dist = Math.sqrt(dx * dx + dy * dy);
            
            c.x += c.vx; c.y += c.vy;
            c.vx *= 0.9; c.vy *= 0.9;

            if (dist > 0) {
                let speed = config.BASE_SPEED * Math.pow(20 / c.r, 0.4); 
                
                let slowRadius = c.r * 2.5;
                if (dist < slowRadius) {
                    speed = speed * (dist / slowRadius);
                }

                if (dist < speed) {
                    c.x = p.targetX; c.y = p.targetY;
                } else {
                    c.x += (dx / dist) * speed; c.y += (dy / dist) * speed;
                }
            }
        }

        let cellsToKill = new Set();
        for (let c1 of this.cells) {
            if (cellsToKill.has(c1.id)) continue;
            let nearby = shCells.query(c1);
            for (let c2 of nearby) {
                if (c1.id >= c2.id || cellsToKill.has(c2.id)) continue;
                let dx = c1.x - c2.x, dy = c1.y - c2.y;
                let dist = Math.sqrt(dx * dx + dy * dy);

                if (c1.ownerId === c2.ownerId) {
                    let isFast = this.mode === 'Fast Merge';
                    let mergeTime = isFast ? 1000 : 15000;
                    let sizePenalty = isFast ? 0 : 50;
                    
                    let canMerge1 = (now - (c1.splitTime || 0)) > (mergeTime + (c1.r * sizePenalty));
                    let canMerge2 = (now - (c2.splitTime || 0)) > (mergeTime + (c2.r * sizePenalty));
                    
                    if (canMerge1 && canMerge2) {
                        if (dist < Math.max(c1.r, c2.r)) {
                            if (c1.r >= c2.r) { cellsToKill.add(c2.id); c1.r = getRadius(getArea(c1.r) + getArea(c2.r)); }
                            else { cellsToKill.add(c1.id); c2.r = getRadius(getArea(c2.r) + getArea(c1.r)); }
                        }
                    } else {
                        let minDist = c1.r + c2.r;
                        if (dist < minDist && dist > 0) {
                            let overlap = minDist - dist;
                            let nx = dx / dist, ny = dy / dist;
                            c1.x += nx * overlap * 0.5; c1.y += ny * overlap * 0.5;
                            c2.x -= nx * overlap * 0.5; c2.y -= ny * overlap * 0.5;
                        }
                    }
                } else {
                    if (dist < Math.max(c1.r, c2.r)) {
                        if (c1.r > c2.r * 1.1) { this.burstFood(c2); cellsToKill.add(c2.id); c1.r = getRadius(getArea(c1.r) + getArea(c2.r)); if(this.players[c1.ownerId]) this.players[c1.ownerId].stats.cellsEaten++; }
                        else if (c2.r > c1.r * 1.1) { this.burstFood(c1); cellsToKill.add(c1.id); c2.r = getRadius(getArea(c2.r) + getArea(c1.r)); if(this.players[c2.ownerId]) this.players[c2.ownerId].stats.cellsEaten++; }
                    }
                }
            }
        }

        if (cellsToKill.size > 0) this.cells = this.cells.filter(c => !cellsToKill.has(c.id));
        for (let c of this.cells) {
            c.x = Math.max(c.r, Math.min(config.WORLD_WIDTH - c.r, c.x));
            c.y = Math.max(c.r, Math.min(config.WORLD_HEIGHT - c.r, c.y));
        }

        let foodEaten = [];
        let foodGrowth = this.mode === 'Fast Merge' ? 4 : 1;
        for (let c of this.cells) {
            let nearbyFood = shFoods.query(c);
            for (let f of nearbyFood) {
                if (f.eaten) continue;
                if ((c.x - f.x)*(c.x - f.x) + (c.y - f.y)*(c.y - f.y) < c.r * c.r) {
                    c.r = getRadius(getArea(c.r) + getArea(f.r) * foodGrowth);
                    f.eaten = true;
                    foodEaten.push(f.id);
                    if(this.players[c.ownerId]) this.players[c.ownerId].stats.foodEaten++;
                }
            }
        }

        if (foodEaten.length > 0) {
            this.foods = this.foods.filter(f => !f.eaten);
            while (this.foods.length < config.MAX_FOOD) {
                let newFood = { id: this.nextFoodId++, x: Math.random() * config.WORLD_WIDTH, y: Math.random() * config.WORLD_HEIGHT, r: 5, color: getRandomColor() };
                this.foods.push(newFood);
                this.io.emit('foodAdded', newFood);
            }
            this.io.emit('foodEaten', foodEaten);
        }

        for (let v of this.viruses) {
            let nearbyMass = shEjected.query(v);
            for (let m of nearbyMass) {
                if (m.eaten) continue;
                if ((v.x - m.x)*(v.x - m.x) + (v.y - m.y)*(v.y - m.y) < v.r * v.r) {
                    m.eaten = true; v.r += 2; v.fed = (v.fed || 0) + 1;
                    if (v.fed >= 7) {
                        v.fed = 0; v.r = 45;
                        let dist = Math.sqrt(m.vx * m.vx + m.vy * m.vy);
                        let dirX = dist > 0 ? m.vx/dist : 1; let dirY = dist > 0 ? m.vy/dist : 0;
                        if (dist === 0) { dirX = 1; dirY = 0; }
                        this.viruses.push({ id: Math.random().toString(36), x: v.x, y: v.y, r: 45, fed: 0, vx: dirX * 20, vy: dirY * 20 });
                    }
                }
            }
        }

        for (let c of this.cells) {
            let nearbyMass = shEjected.query(c);
            for (let m of nearbyMass) {
                if (m.eaten) continue;
                if ((c.x - m.x)*(c.x - m.x) + (c.y - m.y)*(c.y - m.y) < c.r * c.r && c.r > m.r * 1.1) {
                    c.r = getRadius(getArea(c.r) + getArea(m.r));
                    m.eaten = true;
                }
            }
        }
        this.ejectedMass = this.ejectedMass.filter(m => !m.eaten);

        let virusesToKill = new Set();
        for (let c of this.cells) {
            let nearbyViruses = shViruses.query(c);
            for (let v of nearbyViruses) {
                if (virusesToKill.has(v.id)) continue;
                if ((c.x - v.x)*(c.x - v.x) + (c.y - v.y)*(c.y - v.y) < c.r * c.r && c.r > v.r * 1.1) {
                    virusesToKill.add(v.id);
                    c.r = getRadius(getArea(c.r) + getArea(v.r));
                    let myCells = this.cells.filter(cell => cell.ownerId === c.ownerId);
                    if (myCells.length < 16) {
                        let cellsToCreate = 16 - myCells.length;
                        let areaPerCell = getArea(c.r) / (cellsToCreate + 1);
                        c.r = getRadius(areaPerCell);
                        for (let j = 0; j < cellsToCreate; j++) {
                            let angle = Math.random() * Math.PI * 2;
                            let speed = Math.random() * 20 + 10;
                            this.cells.push({
                                id: this.nextCellId++, ownerId: c.ownerId,
                                x: c.x, y: c.y, r: c.r, color: c.color,
                                vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, splitTime: Date.now()
                            });
                        }
                    }
                }
            }
        }
        if (virusesToKill.size > 0) {
            this.viruses = this.viruses.filter(v => !virusesToKill.has(v.id));
        }
        
        let targetViruses = this.mode === 'Fast Merge' ? config.MAX_VIRUSES * 3 : config.MAX_VIRUSES;
        while(this.viruses.length < targetViruses) {
            let safeX, safeY;
            let attempts = 0;
            let isSafe = false;
            
            while (!isSafe && attempts < 20) {
                safeX = Math.random() * config.WORLD_WIDTH;
                safeY = Math.random() * config.WORLD_HEIGHT;
                isSafe = true;
                
                for (let c of this.cells) {
                    let distSq = (c.x - safeX)*(c.x - safeX) + (c.y - safeY)*(c.y - safeY);
                    let minD = c.r + 45 + 100; // 100 units of padding
                    if (distSq < minD * minD) {
                        isSafe = false;
                        break;
                    }
                }
                attempts++;
            }
            
            if (isSafe) {
                this.viruses.push({ id: Math.random().toString(36), x: safeX, y: safeY, r: 45, fed: 0 });
            } else {
                // Cannot find a safe spot after 20 attempts (map is likely too crowded)
                // Stop trying this tick to prevent infinite loop
                break;
            }
        }

        for (let id in this.players) {
            let myCells = this.cells.filter(c => c.ownerId === id);
            if (myCells.length === 0) {
                if (this.players[id].isBot) delete this.players[id];
                else { 
                    this.players[id].stats.timeAlive = Math.floor((Date.now() - this.players[id].stats.spawnTime) / 1000);
                    this.players[id].stats.maxScore = this.players[id].maxScore || 0;
                    this.io.to(id).emit('died', this.players[id].stats); 
                    delete this.players[id]; 
                }
            } else {
                let score = 0;
                for (let c of myCells) score += getArea(c.r);
                this.players[id].score = Math.floor(score / 100);
                if (this.players[id].score > (this.players[id].maxScore || 0)) {
                    this.players[id].xp = (this.players[id].xp || 0) + (this.players[id].score - (this.players[id].maxScore || 0));
                    this.players[id].maxScore = this.players[id].score;
                }
                this.players[id].level = 1 + Math.floor(Math.sqrt((this.players[id].xp || 0) / 20));
            }
        }

        let leaderboard = Object.values(this.players).sort((a, b) => b.score - a.score).slice(0, 10).map(p => ({ name: p.name, score: p.score, level: p.level }));

        for (let id in this.players) {
            let p = this.players[id];
            if (p.isBot) continue;

            let myCells = this.cells.filter(c => c.ownerId === id);
            let cx = config.WORLD_WIDTH / 2;
            let cy = config.WORLD_HEIGHT / 2;
            let viewW = 1920;
            let viewH = 1080;

            if (myCells.length > 0) {
                let totalMass = 0;
                cx = 0; cy = 0;
                for (let c of myCells) {
                    cx += c.x; cy += c.y;
                    totalMass += (c.r * c.r);
                }
                cx /= myCells.length; cy /= myCells.length;
                let combinedR = Math.max(20, Math.sqrt(totalMass));
                let targetZoom = Math.pow(40 / combinedR, 0.6);
                targetZoom = Math.max(0.05, targetZoom);
                viewW = 1920 / targetZoom;
                viewH = 1080 / targetZoom;
            } else {
                let largest = this.cells.reduce((max, c) => (c.r > (max ? max.r : 0) ? c : max), null);
                if (largest) {
                    cx = largest.x; cy = largest.y;
                    let targetZoom = Math.pow(25 / largest.r, 0.4);
                    targetZoom = Math.max(0.05, targetZoom);
                    viewW = 1920 / targetZoom;
                    viewH = 1080 / targetZoom;
                }
            }

            let viewR = Math.max(viewW, viewH) / 2 + 200; // 200 padding

            let visibleCells = [];
            for (let c of this.cells) {
                if (c.x + c.r > cx - viewR && c.x - c.r < cx + viewR && c.y + c.r > cy - viewR && c.y - c.r < cy + viewR) {
                    visibleCells.push(c);
                }
            }

            let visibleEjected = [];
            for (let m of this.ejectedMass) {
                if (m.x + m.r > cx - viewR && m.x - m.r < cx + viewR && m.y + m.r > cy - viewR && m.y - m.r < cy + viewR) {
                    visibleEjected.push(m);
                }
            }

            let visibleViruses = [];
            for (let v of this.viruses) {
                if (v.x + v.r > cx - viewR && v.x - v.r < cx + viewR && v.y + v.r > cy - viewR && v.y - v.r < cy + viewR) {
                    visibleViruses.push(v);
                }
            }

            this.io.to(id).emit('update', { 
                cells: visibleCells, 
                ejectedMass: visibleEjected, 
                leaderboard, 
                players: this.players, 
                viruses: visibleViruses
            });
        }
    }
}
module.exports = Game;
