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
        
        // Bots think faster to react like pros
        let thinkRate = 40; 
        
        if (!bot.lastDecision || now - bot.lastDecision > thinkRate) {
            bot.lastDecision = now;
            let botCells = game.cells.filter(c => c.ownerId === id);
            if(botCells.length === 0) continue;
            
            let botCell = botCells.sort((a,b) => b.r - a.r)[0];
            let isMaxCells = botCells.length >= 16;
            
            let allies = [];
            let threats = [];
            let preys = [];
            let nearbyViruses = shViruses.query({x: botCell.x, y: botCell.y, r: 1500});

            let nearbyCells = shCells.query({x: botCell.x, y: botCell.y, r: 2500});
            for (let other of nearbyCells) {
                if (other.ownerId === id) continue;
                let otherPlayer = game.players[other.ownerId];
                if (!otherPlayer) continue;

                let dSq = (botCell.x - other.x)**2 + (botCell.y - other.y)**2;
                let d = Math.max(1, Math.sqrt(dSq));
                
                if (d < 2500) {
                    if (otherPlayer.team && otherPlayer.team === bot.team) {
                        allies.push({cell: other, player: otherPlayer, d: d, dSq: dSq});
                    } else if (other.r > botCell.r * 1.1) {
                        threats.push({cell: other, d: d, dSq: dSq});
                    } else if (botCell.r > other.r * 1.1 && other.r > botCell.r * 0.1) {
                        preys.push({cell: other, d: d, dSq: dSq});
                    }
                }
            }
            
            let dx = 0;
            let dy = 0;
            let actionTaken = false;

            // 5. Defensive "Bail Out" Splitting
            if (!isMaxCells) {
                for (let t of threats) {
                    if (t.d < t.cell.r + botCell.r + 150) {
                        if (t.cell.r > botCell.r * 1.1 && (now - (bot.lastSplitTime || 0) > 1000)) {
                            // Bail out! Split perfectly away from the threat
                            bot.targetX = botCell.x - (t.cell.x - botCell.x) * 100;
                            bot.targetY = botCell.y - (t.cell.y - botCell.y) * 100;
                            game.executeSplit(id);
                            bot.lastSplitTime = now;
                            actionTaken = true;
                            break;
                        }
                    }
                }
            }

            // 2. Virus Sniping (Trickshots)
            if (!actionTaken && botCell.r > 150 && threats.length > 0) {
                let closestThreat = threats.sort((a,b) => a.d - b.d)[0];
                if (closestThreat.d < 1000 && closestThreat.cell.r > 130) {
                    for (let v of nearbyViruses) {
                        let distToVirus = Math.sqrt((botCell.x - v.x)**2 + (botCell.y - v.y)**2);
                        if (distToVirus < botCell.r + 300) { // Can reach virus with W
                            let vx = v.x - botCell.x;
                            let vy = v.y - botCell.y;
                            let tx = closestThreat.cell.x - v.x;
                            let ty = closestThreat.cell.y - v.y;
                            
                            let dot = (vx * tx + vy * ty);
                            if (dot > 0) {
                                let distV = Math.sqrt(vx*vx + vy*vy);
                                let distT = Math.sqrt(tx*tx + ty*ty);
                                let cosTheta = dot / (distV * distT);
                                
                                // Perfect alignment check (> 0.98 cosTheta)
                                if (cosTheta > 0.98 && distT < 800) {
                                    bot.targetX = v.x;
                                    bot.targetY = v.y;
                                    // Rapid fire W to snipe!
                                    if (now - (bot.botState.lastEjectTime || 0) > 50) {
                                        game.executeEject(id);
                                        bot.botState.lastEjectTime = now;
                                    }
                                    actionTaken = true;
                                    dx = 0; dy = 0;
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            // 1. Perfect Split-Kill Calculations
            if (!actionTaken && !isMaxCells && (now - (bot.lastSplitTime || 0) > 800)) {
                for (let pCell of preys) {
                    let postSplitRadius = botCell.r * 0.707;
                    if (postSplitRadius > pCell.cell.r * 1.1) {
                        let splitReach = botCell.r + postSplitRadius + 300; // Perfect split reach
                        if (pCell.d < splitReach && pCell.d > botCell.r + pCell.cell.r + 20) {
                            let targetVx = pCell.cell.vx || 0;
                            let targetVy = pCell.cell.vy || 0;
                            
                            // Lead the target
                            bot.targetX = pCell.cell.x + targetVx * 10;
                            bot.targetY = pCell.cell.y + targetVy * 10;
                            game.executeSplit(id);
                            bot.lastSplitTime = now;
                            actionTaken = true;
                            break;
                        }
                    }
                }
            }

            // FEATURE: Cooperative Teaming (Mass Sharing & Trick-splitting)
            if (!actionTaken && allies.length > 0) {
                let biggestAlly = allies.sort((a,b) => b.cell.r - a.cell.r)[0];
                if (biggestAlly.cell.r > botCell.r && biggestAlly.d < 800) {
                    let allyCanBeHelped = false;
                    for (let p of preys) {
                        if (biggestAlly.cell.r > p.cell.r * 1.05 && biggestAlly.cell.r < p.cell.r * 1.5 && p.d < 1200) {
                            allyCanBeHelped = true; break;
                        }
                    }
                    
                    if (allyCanBeHelped && (now - (bot.botState.lastEjectTime || 0) > 100)) {
                        bot.targetX = biggestAlly.cell.x;
                        bot.targetY = biggestAlly.cell.y;
                        game.executeEject(id);
                        bot.botState.lastEjectTime = now;
                        actionTaken = true;
                    } else if (botCell.r > 150 && biggestAlly.cell.r > botCell.r * 1.5 && threats.length > 0 && !isMaxCells) {
                        // Trick split into ally to save mass if under threat
                        bot.targetX = biggestAlly.cell.x;
                        bot.targetY = biggestAlly.cell.y;
                        game.executeSplit(id);
                        bot.lastSplitTime = now;
                        actionTaken = true;
                    }
                }
            }

            // FEATURE: Advanced Multi-Cell Management (Self-Feeding)
            if (!actionTaken && botCells.length >= 8 && botCell.r > 100) {
                let smallestBotCell = botCells.sort((a,b) => a.r - b.r)[0];
                if (smallestBotCell.r < 50 && (now - (bot.botState.lastEjectTime || 0) > 100)) {
                    let cx = 0, cy = 0;
                    for (let c of botCells) { cx += c.x; cy += c.y; }
                    cx /= botCells.length; cy /= botCells.length;
                    bot.targetX = cx; bot.targetY = cy;
                    game.executeEject(id);
                    bot.botState.lastEjectTime = now;
                }
            }

            if (!actionTaken) {
                // FEATURE: Predictive Evasion & Dodging (Perpendicular Dodging)
                for (let t of threats) {
                    let splitDangerZone = (t.cell.r > botCell.r * 2.2) ? (t.cell.r * 2 + botCell.r + 300) : (t.cell.r + botCell.r + 100);
                    if (t.d < splitDangerZone) {
                        let force = 500000 / (t.dSq || 1);
                        
                        let escapeX = (botCell.x - t.cell.x) / t.d;
                        let escapeY = (botCell.y - t.cell.y) / t.d;
                        
                        if (t.cell.r > botCell.r * 2.2 && t.d < t.cell.r * 2 + 200) {
                            // Perpendicular dodge
                            let perpX = -escapeY;
                            let perpY = escapeX;
                            let centerX = config.WORLD_WIDTH / 2;
                            let centerY = config.WORLD_HEIGHT / 2;
                            let toCenterX = centerX - botCell.x;
                            let toCenterY = centerY - botCell.y;
                            let dot = (perpX * toCenterX + perpY * toCenterY);
                            if (dot < 0) { perpX = -perpX; perpY = -perpY; }
                            
                            escapeX = (escapeX + perpX * 2) / 3;
                            escapeY = (escapeY + perpY * 2) / 3;
                        }

                        dx += escapeX * force;
                        dy += escapeY * force;
                    }
                }

                // Chasing and Corner Trapping
                for (let pCell of preys) {
                    let force = 200000 / (pCell.dSq || 1);
                    
                    let wallDistX = Math.min(pCell.cell.x, config.WORLD_WIDTH - pCell.cell.x);
                    let wallDistY = Math.min(pCell.cell.y, config.WORLD_HEIGHT - pCell.cell.y);
                    
                    let dirX = (pCell.cell.x - botCell.x) / pCell.d;
                    let dirY = (pCell.cell.y - botCell.y) / pCell.d;
                    
                    // Trap logic: Predict and herd towards corners
                    if (wallDistX < 800) {
                        dirY += (botCell.y < config.WORLD_HEIGHT / 2) ? 0.8 : -0.8; 
                    }
                    if (wallDistY < 800) {
                        dirX += (botCell.x < config.WORLD_WIDTH / 2) ? 0.8 : -0.8;
                    }

                    let dirLen = Math.sqrt(dirX*dirX + dirY*dirY) || 1;
                    dirX /= dirLen; dirY /= dirLen;

                    dx += dirX * force;
                    dy += dirY * force;
                }
                
                // FEATURE: Macro Map Control (Virus Shielding)
                if (botCell.r > 60 && !isMaxCells) {
                    let beingChased = threats.some(t => t.d < 1000 && t.cell.r > botCell.r * 1.5);
                    for (let v of nearbyViruses) {
                        let distSq = (botCell.x - v.x)**2 + (botCell.y - v.y)**2;
                        let dist = Math.sqrt(distSq);
                        
                        if (beingChased && botCell.r < v.r * 1.05) {
                            // Use virus as shield (hide behind it)
                            if (dist < 300 && dist > v.r + botCell.r + 10) {
                                let force = 50000 / distSq;
                                dx += ((v.x - botCell.x) / dist) * force;
                                dy += ((v.y - botCell.y) / dist) * force;
                            }
                        } else if (dist < botCell.r + 150) {
                            let force = 300000 / distSq;
                            dx -= ((v.x - botCell.x) / dist) * force;
                            dy -= ((v.y - botCell.y) / dist) * force;
                        }
                    }
                }

                // Food
                let nearbyFoods = shFoods.query({x: botCell.x, y: botCell.y, r: 800});
                for (let f of nearbyFoods) {
                    let distSq = (botCell.x - f.x)**2 + (botCell.y - f.y)**2;
                    let dist = Math.sqrt(distSq);
                    let force = 1000 / dist;
                    dx += ((f.x - botCell.x) / dist) * force;
                    dy += ((f.y - botCell.y) / dist) * force;
                }

                // Wall Avoidance
                let wallMargin = botCell.r + 50;
                let wallForce = 200000;
                if (botCell.x < wallMargin) dx += wallForce / (botCell.x * botCell.x || 1);
                if (botCell.y < wallMargin) dy += wallForce / (botCell.y * botCell.y || 1);
                let distWX = config.WORLD_WIDTH - botCell.x;
                let distWY = config.WORLD_HEIGHT - botCell.y;
                if (distWX < wallMargin) dx -= wallForce / (distWX * distWX || 1);
                if (distWY < wallMargin) dy -= wallForce / (distWY * distWY || 1);

                // FEATURE: Macro Map Control (Center Dominance)
                if (botCell.r > 200 && preys.length === 0 && threats.length === 0) {
                    let centerX = config.WORLD_WIDTH / 2;
                    let centerY = config.WORLD_HEIGHT / 2;
                    let cDist = Math.max(1, Math.sqrt((centerX - botCell.x)**2 + (centerY - botCell.y)**2));
                    let force = 20000 / cDist;
                    dx += ((centerX - botCell.x) / cDist) * force;
                    dy += ((centerY - botCell.y) / cDist) * force;
                }

                // Wander
                if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
                    if (!bot.botState.wanderX || ((botCell.x - bot.botState.wanderX)**2 + (botCell.y - bot.botState.wanderY)**2) < 40000 || Math.random() < 0.05) {
                        bot.botState.wanderX = Math.random() * config.WORLD_WIDTH;
                        bot.botState.wanderY = Math.random() * config.WORLD_HEIGHT;
                    }
                    let wDist = Math.max(1, Math.sqrt((bot.botState.wanderX - botCell.x)**2 + (bot.botState.wanderY - botCell.y)**2));
                    dx += ((bot.botState.wanderX - botCell.x) / wDist) * 50;
                    dy += ((bot.botState.wanderY - botCell.y) / wDist) * 50;
                }

                // FEATURE: Merge handling & Cell Overlap
                if (botCells.length > 1) {
                    let cx = 0, cy = 0;
                    for (let c of botCells) { cx += c.x; cy += c.y; }
                    cx /= botCells.length;
                    cy /= botCells.length;
                    let dist = Math.max(1, Math.sqrt((cx - botCell.x)**2 + (cy - botCell.y)**2));
                    
                    let mergeTime = game.mode === 'Fast Merge' ? 1000 : 15000;
                    let canMerge = (now - (botCell.splitTime || 0)) > mergeTime;
                    // If can merge, force cells together aggressively
                    let force = canMerge ? 20000 / dist : 1000 / dist;
                    dx += ((cx - botCell.x) / dist) * force;
                    dy += ((cy - botCell.y) / dist) * force;
                }

                // Smoothing vector movement
                dx = dx * 0.2 + (bot.botState.lastDx || 0) * 0.8;
                dy = dy * 0.2 + (bot.botState.lastDy || 0) * 0.8;
                bot.botState.lastDx = dx;
                bot.botState.lastDy = dy;

                let finalDist = Math.sqrt(dx*dx + dy*dy);
                if (finalDist > 0) {
                    bot.targetX = botCell.x + (dx / finalDist) * 1000;
                    bot.targetY = botCell.y + (dy / finalDist) * 1000;
                }
            }
            
            bot.targetX = Math.max(0, Math.min(config.WORLD_WIDTH, bot.targetX));
            bot.targetY = Math.max(0, Math.min(config.WORLD_HEIGHT, bot.targetY));
        }
    }
}

function manageBots(game) {
    let total = Object.keys(game.players).length;
    if (total < config.MIN_PLAYERS) {
        let botId = 'bot_' + Math.random().toString(36).substr(2, 9);
        
        let clans = ['[PRO]', '[GOD]', '[ZOO]', '[WIN]'];
        let clan = clans[Math.floor(Math.random() * clans.length)];
        let botName = clan + ' ' + config.BOT_NAMES[Math.floor(Math.random() * config.BOT_NAMES.length)];
        
        game.players[botId] = {
            isBot: true,
            team: clan,
            targetX: Math.random() * config.WORLD_WIDTH,
            targetY: Math.random() * config.WORLD_HEIGHT,
            color: getRandomColor(),
            name: botName,
            personality: ['Aggressive', 'Timid', 'Scavenger'][Math.floor(Math.random() * 3)],
            score: 0, maxScore: 0,
            xp: Math.floor(Math.random() * 500), level: 1,
            stats: { foodEaten: 0, cellsEaten: 0, spawnTime: Date.now() }
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

