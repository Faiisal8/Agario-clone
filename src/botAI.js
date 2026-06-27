const config = require('./config');
const { getRandomColor } = require('./utils');

function updateBots(game, shCells, shFoods, shViruses) {
    let now = Date.now();
    for (let id in game.players) {
        if (!game.players[id].isBot) continue;
        let bot = game.players[id];
        if (!bot.botState) {
            bot.botState = {
                lastDx: 0,
                lastDy: 0,
                lastEjectTime: 0,
                wanderX: Math.random() * config.WORLD_WIDTH,
                wanderY: Math.random() * config.WORLD_HEIGHT
            };
        }
        
        let p = bot.personality || 'Aggressive';
        let thinkRate = p === 'Aggressive' ? 50 : (p === 'Timid' ? 80 : 120);
        
        if (!bot.lastDecision || now - bot.lastDecision > thinkRate) {
            bot.lastDecision = now;
            let botCells = game.cells.filter(c => c.ownerId === id);
            if(botCells.length > 0) {
                let botCell = botCells.sort((a,b) => b.r - a.r)[0];
                
                let threats = [];
                let postSplitThreats = [];
                let doubleSplitThreats = [];
                let preys = [];

                let nearbyCells = shCells.query({x: botCell.x, y: botCell.y, r: 1500});
                for (let other of nearbyCells) {
                    if (other.ownerId === id) continue;
                    
                    let d = Math.max(1, Math.hypot(botCell.x - other.x, botCell.y - other.y));
                    if (d < 1500) {
                        if (other.r > botCell.r * 1.1) {
                            threats.push({cell: other, d: d});
                            postSplitThreats.push({cell: other, d: d});
                            doubleSplitThreats.push({cell: other, d: d});
                        } else {
                            let postSplitRadius = botCell.r * 0.707;
                            if (other.r > postSplitRadius * 1.1) postSplitThreats.push({cell: other, d: d});
                            
                            let doubleSplitRadius = botCell.r * 0.5;
                            if (other.r > doubleSplitRadius * 1.1) doubleSplitThreats.push({cell: other, d: d});
                            
                            if (botCell.r > other.r * 1.1 && other.r > botCell.r * 0.15) {
                                preys.push({cell: other, d: d});
                            }
                        }
                    }
                }
                
                let nearbyViruses = shViruses.query({x: botCell.x, y: botCell.y, r: 800});
                
                let dx = 0;
                let dy = 0;

                let threatMult = p === 'Aggressive' ? 0.5 : (p === 'Timid' ? 3.0 : 1.0);
                for (let t of threats) {
                    let splitDangerZone = (t.cell.r > botCell.r * 2.2) ? (t.cell.r * 2 + botCell.r + 50) : (t.cell.r + botCell.r + 50);
                    
                    if (t.d < splitDangerZone + 300) {
                        let panicMult = (t.d < splitDangerZone) ? 10.0 : 1.0;
                        let force = - (t.cell.r / botCell.r) * (200000 * threatMult * panicMult) / (t.d * t.d);
                        dx += ((t.cell.x - botCell.x) / t.d) * force;
                        dy += ((t.cell.y - botCell.y) / t.d) * force;
                    }
                }

                let isMaxCells = botCells.length >= 16;
                
                if (botCell.r > 65) {
                    for (let v of nearbyViruses) {
                        let dist = Math.max(1, Math.hypot(botCell.x - v.x, botCell.y - v.y));
                        
                        if (isMaxCells) {
                            let force = 5000 / dist;
                            dx += ((v.x - botCell.x) / dist) * force;
                            dy += ((v.y - botCell.y) / dist) * force;
                        } else {
                            if (dist < botCell.r + 150) {
                                let force = 200000 / (dist * dist);
                                let vecX = (v.x - botCell.x) / dist;
                                let vecY = (v.y - botCell.y) / dist;
                                
                                let perpX = -vecY;
                                let perpY = vecX;
                                
                                dx += perpX * (force * 2.5) - vecX * (force * 0.5);
                                dy += perpY * (force * 2.5) - vecY * (force * 0.5);
                            }
                        }
                    }
                }

                let preyMult = p === 'Aggressive' ? 2.0 : (p === 'Timid' ? 0.5 : 0.2);
                for (let pCell of preys) {
                    let sizeRatio = pCell.cell.r / botCell.r;
                    let force = (sizeRatio * sizeRatio) * (100000 * preyMult) / pCell.d;
                    dx += ((pCell.cell.x - botCell.x) / pCell.d) * force;
                    dy += ((pCell.cell.y - botCell.y) / pCell.d) * force;
                    
                    if (p === 'Aggressive' && botCell.r > 200 && pCell.d < botCell.r + 500 && sizeRatio < 0.3) {
                        if (now - (bot.botState.lastEjectTime || 0) > 1000 && Math.random() < 0.1) {
                            bot.targetX = pCell.cell.x;
                            bot.targetY = pCell.cell.y;
                            game.executeEject(id);
                            bot.botState.lastEjectTime = now;
                        }
                    }
                    
                    let splitCooldown = p === 'Aggressive' ? 500 : (p === 'Timid' ? 2000 : 1000);
                    if (now - (bot.lastSplitTime || 0) > splitCooldown) {
                        if (botCell.r > pCell.cell.r * 2.2 && sizeRatio > 0.15 && pCell.d > botCell.r + pCell.cell.r) {
                            
                            let predictedX = pCell.cell.x + (pCell.cell.vx || 0) * 10;
                            let predictedY = pCell.cell.y + (pCell.cell.vy || 0) * 10;
                            
                            if (pCell.d < botCell.r + 350 && postSplitThreats.length === 0) {
                                bot.targetX = predictedX;
                                bot.targetY = predictedY;
                                game.executeSplit(id);
                                bot.lastSplitTime = now;
                            } else if (pCell.d < botCell.r + 700 && botCell.r > pCell.cell.r * 4.5 && doubleSplitThreats.length === 0 && p !== 'Timid') {
                                bot.targetX = predictedX;
                                bot.targetY = predictedY;
                                game.executeSplit(id);
                                setTimeout(() => {
                                    if (game.players[id]) {
                                        bot.targetX = predictedX;
                                        bot.targetY = predictedY;
                                        game.executeSplit(id);
                                    }
                                }, 50);
                                bot.lastSplitTime = now;
                            }
                        }
                    }
                }

                let foodMult = p === 'Scavenger' ? 3.0 : 1.0;
                let nearbyFoods = shFoods.query({x: botCell.x, y: botCell.y, r: 800});
                for (let f of nearbyFoods) {
                    let dist = Math.max(1, Math.hypot(botCell.x - f.x, botCell.y - f.y));
                    let force = (600 * foodMult) / dist;
                    dx += ((f.x - botCell.x) / dist) * force;
                    dy += ((f.y - botCell.y) / dist) * force;
                }

                if (botCells.length > 1) {
                    let cx = 0, cy = 0;
                    for (let c of botCells) { cx += c.x; cy += c.y; }
                    cx /= botCells.length;
                    cy /= botCells.length;
                    let dist = Math.max(1, Math.hypot(cx - botCell.x, cy - botCell.y));
                    
                    let mergeTime = game.mode === 'Fast Merge' ? 1000 : 15000;
                    let canMerge = (now - (botCell.splitTime || 0)) > mergeTime;
                    let force = canMerge ? 5000 / dist : 1000 / dist;
                    dx += ((cx - botCell.x) / dist) * force;
                    dy += ((cy - botCell.y) / dist) * force;
                    
                    if (botCells.length > 3 && threats.length > 0 && now - (bot.botState.lastEjectTime || 0) > 100) {
                        bot.targetX = botCell.x;
                        bot.targetY = botCell.y;
                        game.executeEject(id);
                        bot.botState.lastEjectTime = now;
                    }
                }

                let wallMargin = botCell.r + 100;
                let wallForce = 100000;
                if (botCell.x < wallMargin) dx += wallForce / (botCell.x * botCell.x || 1);
                if (botCell.y < wallMargin) dy += wallForce / (botCell.y * botCell.y || 1);
                let distX = config.WORLD_WIDTH - botCell.x;
                let distY = config.WORLD_HEIGHT - botCell.y;
                if (distX < wallMargin) dx -= wallForce / (distX * distX || 1);
                if (distY < wallMargin) dy -= wallForce / (distY * distY || 1);

                for (let t of threats) {
                    if (t.d < botCell.r + t.cell.r + 50 && botCell.r > 40) {
                        if (now - (bot.botState.lastEjectTime || 0) > 200) {
                            game.executeEject(id);
                            bot.botState.lastEjectTime = now;
                            break;
                        }
                    }
                }

                if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
                    if (!bot.botState.wanderX || Math.hypot(botCell.x - bot.botState.wanderX, botCell.y - bot.botState.wanderY) < 200 || Math.random() < 0.05) {
                        bot.botState.wanderX = Math.random() * config.WORLD_WIDTH;
                        bot.botState.wanderY = Math.random() * config.WORLD_HEIGHT;
                    }
                    let wDist = Math.max(1, Math.hypot(bot.botState.wanderX - botCell.x, bot.botState.wanderY - botCell.y));
                    dx += ((bot.botState.wanderX - botCell.x) / wDist) * 50;
                    dy += ((bot.botState.wanderY - botCell.y) / wDist) * 50;
                }

                dx = dx * 0.1 + (bot.botState.lastDx || 0) * 0.9;
                dy = dy * 0.1 + (bot.botState.lastDy || 0) * 0.9;
                bot.botState.lastDx = dx;
                bot.botState.lastDy = dy;

                let isShooting = false;

                if (botCell.r > 130 && now - (bot.botState.lastEjectTime || 0) > 100) {
                    for (let v of nearbyViruses) {
                        if (isShooting) break;
                        let distToVirus = Math.hypot(botCell.x - v.x, botCell.y - v.y);
                        if (distToVirus < 400) {
                            let targets = [...threats, ...preys.filter(p => p.cell.r > 150)];
                            for (let t of targets) {
                                let vx = v.x - botCell.x;
                                let vy = v.y - botCell.y;
                                let tx = t.cell.x - v.x;
                                let ty = t.cell.y - v.y;
                                let dot = (vx * tx + vy * ty);
                                if (dot > 0) {
                                    let distV = Math.hypot(vx, vy);
                                    let distT = Math.hypot(tx, ty);
                                    let cosTheta = dot / (distV * distT);
                                    if (cosTheta > 0.95 && distT < 800) {
                                        bot.targetX = v.x;
                                        bot.targetY = v.y;
                                        game.executeEject(id);
                                        bot.botState.lastEjectTime = now;
                                        isShooting = true;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }

                let finalDist = Math.hypot(dx, dy);
                if (finalDist > 0 && !isShooting) {
                    bot.targetX = botCell.x + (dx / finalDist) * 1000;
                    bot.targetY = botCell.y + (dy / finalDist) * 1000;
                }
                
                bot.targetX = Math.max(0, Math.min(config.WORLD_WIDTH, bot.targetX));
                bot.targetY = Math.max(0, Math.min(config.WORLD_HEIGHT, bot.targetY));
            }
        }
    }
}

function manageBots(game) {
    let total = Object.keys(game.players).length;
    if (total < config.MIN_PLAYERS) {
        let botId = 'bot_' + Math.random().toString(36).substr(2, 9);
        game.players[botId] = {
            isBot: true,
            targetX: Math.random() * config.WORLD_WIDTH,
            targetY: Math.random() * config.WORLD_HEIGHT,
            color: getRandomColor(),
            name: config.BOT_NAMES[Math.floor(Math.random() * config.BOT_NAMES.length)],
            personality: ['Aggressive', 'Timid', 'Scavenger'][Math.floor(Math.random() * 3)],
            score: 0, maxScore: 0,
            xp: Math.floor(Math.random() * 500), level: 1
        };
        let isInitialSpawn = (game.totalBotsCreated || 0) < config.MIN_PLAYERS;
        game.totalBotsCreated = (game.totalBotsCreated || 0) + 1;
        
        let baseRadius = isInitialSpawn ? 180 : 20;
        let randomBonus = isInitialSpawn ? 220 : 60;
        game.cells.push({
            id: game.nextCellId++,
            ownerId: botId,
            x: Math.random() * config.WORLD_WIDTH,
            y: Math.random() * config.WORLD_HEIGHT,
            r: baseRadius + Math.random() * randomBonus,
            color: game.players[botId].color,
            vx: 0, vy: 0, splitTime: 0
        });
    }
}

module.exports = { updateBots, manageBots };
