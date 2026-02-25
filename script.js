const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const uiLayer = document.getElementById('ui-layer');
const playUI = document.getElementById('play-ui');
const editorUI = document.getElementById('editor-ui');

// Check for standalone mode (set by export script)
const IS_STANDALONE = window.IS_STANDALONE || false;
const winScreen = document.getElementById('win-screen');
const instructions = document.getElementById('instructions');
const settingsPanel = document.getElementById('level-settings-panel');
const stopTestBtn = document.getElementById('btn-stop-test');

// Default Settings (Global Fallback)
const defaultSettings = {
    gravity: 0.4,
    friction: 0.85,
    jumpForce: -11,
    speed: 4,
    maxFallSpeed: 9,
    fastFallSpeed: 15,
    gridSize: 25,
    worldWidth: window.innerWidth,
    worldHeight: window.innerHeight,
    playerMaxHp: 100,
    playerMaxMp: 100,
    platformCost: 10,
    fallDamage: 20,
    mpRegen: 0.1
};

// Input State
const keys = {};

window.addEventListener('keydown', (e) => {
    keys[e.code] = true;

    // Editor Drag-to-Pan Cursor Hint
    if (e.code === 'Space' && game.state === 'edit') {
        e.preventDefault(); // Prevent page scroll
        if (!game.editor.isPanning) {
            canvas.style.cursor = 'grab';
        }
    }

    // Editor Delete Shortcut
    if (game.state === 'edit' && (e.code === 'Delete' || e.code === 'Backspace')) {
        // Prevent deletion if user is typing in an input field or interacting with UI
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.closest('#ui-layer'))) {
            return;
        }
        game.editor.deleteSelected();
        game.editor.updatePropertiesUI();
    }

    // Global Editor Toggle Shortcut (Tab)
    if (e.code === 'Tab') {
        e.preventDefault(); // Prevent focus change
        if (game.editor) {
            console.log("Tab pressed: Toggling Editor");
            game.editor.toggle();
        }
    }

    if (e.code === 'KeyR' && game.state === 'won') {
        game.restartLevel();
    }
});
window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    // Release Space Pan Cursor Hint
    if (e.code === 'Space' && game.state === 'edit') {
        console.log(`Space released. isPanning was: ${game.editor.isPanning}, cameraX: ${game.editor.cameraX}, cameraY: ${game.editor.cameraY}`);
        // Failsafe: if we released space but are somehow still panning (e.g. clicked outside canvas), force stop pan
        if (game.editor.isPanning) {
            game.editor.isPanning = false;
        }
        if (!game.editor.isPanning) {
            canvas.style.cursor = 'crosshair'; // Default editor cursor
        }
    }
});

// --- CLASS DEFINITIONS ---

class Camera {
    constructor() {
        this.x = 0;
        this.y = 0;
        this.target = null;
        this.shakeTimer = 0;
        this.shakeMagnitude = 0;
    }

    shake(duration, magnitude) {
        this.shakeTimer = duration;
        this.shakeMagnitude = magnitude;
    }

    update(dt) {
        if (this.shakeTimer > 0) {
            this.shakeTimer -= dt;
            if (this.shakeTimer < 0) this.shakeTimer = 0;
        }
    }

    follow(target) {
        this.x = target.x - canvas.width / 2;
        this.y = target.y - canvas.height / 2;
    }

    clamp(worldWidth, worldHeight) {
        if (this.x < 0) this.x = 0;
        if (this.y < 0) this.y = 0;
        if (this.x + canvas.width > worldWidth) this.x = worldWidth - canvas.width;
        if (this.y + canvas.height > worldHeight) this.y = worldHeight - canvas.height;
    }

    apply(ctx) {
        let dx = 0;
        let dy = 0;
        if (this.shakeTimer > 0) {
            dx = (Math.random() - 0.5) * this.shakeMagnitude * 2;
            dy = (Math.random() - 0.5) * this.shakeMagnitude * 2;
        }
        ctx.translate(-this.x + dx, -this.y + dy);
    }
}

class Particle {
    constructor(x, y, color, speed, size, maxLife) {
        this.x = x;
        this.y = y;
        const angle = Math.random() * Math.PI * 2;
        const vel = Math.random() * speed;
        this.vx = Math.cos(angle) * vel;
        this.vy = Math.sin(angle) * vel;
        this.color = color;
        this.size = size;
        this.maxLife = maxLife;
        this.life = maxLife;
    }
    update(dt) {
        this.x += this.vx * dt * 60;
        this.y += this.vy * dt * 60;
        this.life -= dt;
    }
    draw(ctx) {
        if (this.life <= 0) return;
        const alpha = Math.max(0, this.life / this.maxLife);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = this.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = this.color;

        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size * alpha, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1.0;
    }
}

class Player {
    constructor() {
        this.reset();
    }

    reset() {
        this.x = 100;
        this.y = 100;
        this.width = 30;
        this.height = 30;
        this.vx = 0;
        this.vy = 0;
        this.color = '#fff';
        this.grounded = false;
        this.jumpLocked = false;
        this.trail = []; // Array for ghosting trail

        // Initialize Stats (Roguelike)
        this.maxHp = defaultSettings.playerMaxHp;
        this.hp = this.maxHp;
        this.maxMp = defaultSettings.playerMaxMp;
        this.mp = this.maxMp;
        this.defense = 0;
        this.invulnerable = false;
        this.invulnerableTimer = 0;

        // Skills
        this.extraJumps = 0;
        this.jumpsRemaining = 0;
        this.extraDashes = 0;
        this.dashesRemaining = 0;
        this.dashCooldown = 0;
        this.isDashing = false;
        this.dashTimer = 0;
        this.lastDirection = 1; // 1 for Right, -1 for Left

        // Wall Climb Skills
        this.wallClimbLevel = 0;
        this.lastTouchingWall = 0; // -1 = left wall, 1 = right wall, 0 = none
        this.wallJumpTimer = 0;
        this.isWallSliding = false;
        this.isWallClimbing = false;
    }

    updateStats(settings) {
        this.maxHp = settings.playerMaxHp || 100;
        this.maxMp = settings.playerMaxMp || 100;

        // Initialize if NaN
        if (isNaN(this.hp)) this.hp = this.maxHp;
        if (isNaN(this.mp)) this.mp = this.maxMp;

        // Cap stats
        if (this.hp > this.maxHp) this.hp = this.maxHp;
        if (this.mp > this.maxMp) this.mp = this.maxMp;
    }

    takeDamage(amount) {
        if (this.invulnerable) return;

        let dmg = amount - this.defense;
        if (dmg < 0) dmg = 0;

        this.hp -= dmg;
        if (this.hp < 0) this.hp = 0;

        // Visual feedback
        this.invulnerable = true;
        this.invulnerableTimer = 30; // 0.5s at 60fps

        // Damage Shake & Particles
        if (typeof game !== 'undefined') {
            if (game.camera) game.camera.shake(0.2, 5);
            if (game.spawnParticles) game.spawnParticles(this.x + this.width / 2, this.y + this.height / 2, '#ff0000', 10, 5, 3, 0.3);
        }

        console.log(`Player took ${dmg} damage. HP: ${this.hp}`);

        if (this.hp <= 0) {
            if (typeof game !== 'undefined') {
                if (game.camera) game.camera.shake(0.5, 15);
                if (game.spawnParticles) game.spawnParticles(this.x + this.width / 2, this.y + this.height / 2, this.color, 40, 10, 5, 1.0);
            }

            // Wait slightly before game over to show effect
            setTimeout(() => {
                if (typeof game !== 'undefined') game.gameOver();
            }, 500);
        }
    }

    consumeMp(amount) {
        if (this.mp >= amount) {
            this.mp -= amount;
            return true;
        }
        return false;
    }

    draw(ctx) {
        // Draw ghosting trail
        if (this.trail && this.trail.length > 0) {
            for (let i = 0; i < this.trail.length; i++) {
                const pos = this.trail[i];
                const alpha = 1 - (i / this.trail.length);
                // Dash = yellow/orange glow, Normal = cyan glow
                const trailColor = pos.isDashing ? `rgba(255, 200, 0, ${alpha * 0.6})` : `rgba(0, 255, 255, ${alpha * 0.4})`;
                ctx.fillStyle = trailColor;

                // Slight shrinking effect for older trail segments
                const shrink = i * 0.8;
                const sWidth = Math.max(2, this.width - shrink * 2);
                const sHeight = Math.max(2, this.height - shrink * 2);
                ctx.fillRect(pos.x + shrink, pos.y + shrink, sWidth, sHeight);
            }
        }

        // Invulnerability Flash
        if (this.invulnerable) {
            if (Math.floor(Date.now() / 50) % 2 === 0) return;
        }

        // Player core with glow
        let drawColor = this.color || '#00ffaa';
        let glowColor = this.isDashing ? '#ffc800' : '#00ffff';

        if (this.isWallClimbing) {
            drawColor = '#ffcc00'; // Amber
            glowColor = '#ff8800';
        } else if (this.isWallSliding) {
            drawColor = '#aaddff'; // Icy blue
            glowColor = '#0088ff';
        }

        ctx.shadowBlur = 15;
        ctx.shadowColor = glowColor;
        ctx.fillStyle = drawColor;
        ctx.fillRect(this.x, this.y, this.width, this.height);
        ctx.shadowBlur = 0; // reset shadow
    }

    update(platforms, levelSettings, dt) {
        // Record trail for ghosting effect
        if (!this.trail) this.trail = [];
        this.trail.unshift({ x: this.x, y: this.y, isDashing: this.isDashing });
        if (this.trail.length > 12) this.trail.pop(); // keep past 12 frames

        if (this.invulnerable) {
            this.invulnerableTimer--;
            if (this.invulnerableTimer <= 0) this.invulnerable = false;
        }

        // Skill Cooldowns & Timers
        if (this.dashCooldown > 0) this.dashCooldown -= dt;
        if (this.isDashing) {
            this.dashTimer -= dt;
            if (this.dashTimer <= 0) this.isDashing = false;
        }

        // Global Physics Constants
        const speed = this.isDashing ? defaultSettings.speed * (this.dashSpeedMult || 4.0) : defaultSettings.speed;
        const jumpForce = defaultSettings.jumpForce;
        const gravity = this.isDashing ? 0 : defaultSettings.gravity;

        // MP Regen (Time-based)
        const regenRate = levelSettings.mpRegen !== undefined ? levelSettings.mpRegen : 0.1;
        if (this.mp < this.maxMp) {
            this.mp += regenRate * dt;
            if (this.mp > this.maxMp) this.mp = this.maxMp;
        }

        // Input Handling
        // Horizontal
        if (!this.isDashing) {
            // Wall Kickoff Velocity Preservation (decay)
            if (this.wallJumpTimer > 0) {
                this.wallJumpTimer -= dt;
                // Preserve the vx dictated by the wall jump without input overriding it entirely
                // (Optional: ignore input for a split second to force leap away)
            } else {
                if (keys.KeyA) {
                    this.vx = -speed;
                    this.lastDirection = -1;
                } else if (keys.KeyD) {
                    this.vx = speed;
                    this.lastDirection = 1;
                } else {
                    this.vx *= defaultSettings.friction;
                    if (Math.abs(this.vx) < 0.1) this.vx = 0;
                }
            }
        } else {
            // Constant velocity while dashing
            this.vx = speed * this.lastDirection;
            this.vy = 0;
        }

        // Dash Skill
        if (this.extraDashes > 0 && (keys.ShiftLeft || keys.ShiftRight) && this.dashCooldown <= 0 && !this.isDashing && this.dashesRemaining > 0) {
            // Dash now costs 0 MP based on new cumulative rules
            this.dashesRemaining--;
            this.isDashing = true;
            this.dashTimer = 0.2; // 200ms dash
            this.dashCooldown = 0.6; // 600ms cooldown total (including dash)
        }

        // Jump, Double Jump, and Wall Jump Logic
        let jumpInput = keys.KeyW || keys.Space;
        let justJumped = jumpInput && !this.jumpLocked;

        this.isWallSliding = false;
        this.isWallClimbing = false;
        let didWallJump = false;

        if (this.wallClimbLevel > 0 && !this.grounded && this.lastTouchingWall !== 0) {
            let holdingIntoWall = (this.lastTouchingWall === -1 && keys.KeyA) ||
                (this.lastTouchingWall === 1 && keys.KeyD);
            let holdingAwayFromWall = (this.lastTouchingWall === -1 && keys.KeyD) ||
                (this.lastTouchingWall === 1 && keys.KeyA);

            if (holdingIntoWall) {
                this.isWallSliding = true;

                // Allow climb if level 2+ (free) or if level 1 and player has MP
                let canClimb = this.wallClimbLevel >= 2 || this.mp > 0;

                if (jumpInput && canClimb) {
                    // Active Spider Climb Up
                    this.isWallClimbing = true;
                    this.vy = -speed * 0.8; // Climb up smoothly
                    if (this.wallClimbLevel < 2) {
                        this.consumeMp(1 * dt); // 1 MP per second if level 1
                    }

                    if (typeof game !== 'undefined' && game.spawnParticles && Math.random() < 0.2) {
                        let px = this.lastTouchingWall === -1 ? this.x : this.x + this.width;
                        game.spawnParticles(px, this.y + this.height / 2, '#ffaa00', 1, 3, 2, 0.3);
                    }
                } else {
                    // Passive Slide Down
                    if (this.vy > 1.5) this.vy = 1.5; // Cap downward fall speed
                    if (typeof game !== 'undefined' && game.spawnParticles && Math.random() < 0.15) {
                        let px = this.lastTouchingWall === -1 ? this.x : this.x + this.width;
                        game.spawnParticles(px, this.y + this.height, '#ffffff', 1, 2, 2, 0.2);
                    }
                }
            } else if (justJumped && holdingAwayFromWall) {
                // Wall Jump off!
                this.vy = jumpForce;
                this.vx = this.lastTouchingWall === -1 ? speed * 1.5 : -speed * 1.5;
                this.wallJumpTimer = 0.2; // Lock horizontal control for 200ms
                this.jumpLocked = true;
                didWallJump = true;
                this.jumpsRemaining = this.extraJumps; // Reset jumps
                this.dashesRemaining = this.extraDashes; // Reset dashes
                this.lastTouchingWall = 0; // Detach

                if (typeof game !== 'undefined' && game.spawnParticles) {
                    let px = this.lastTouchingWall === -1 ? this.x : this.x + this.width;
                    game.spawnParticles(px, this.y + this.height, '#4a9eff', 15, 12, 3, 0.5);
                    game.camera.shake(0.1, 2);
                }
            }
        }

        if (jumpInput && !didWallJump) {
            if (this.grounded && !this.jumpLocked) {
                this.vy = jumpForce;
                this.grounded = false;
                this.jumpLocked = true;
                this.jumpsRemaining = this.extraJumps;
                this.dashesRemaining = this.extraDashes;
            } else if (!this.grounded && !this.jumpLocked && this.jumpsRemaining > 0 && !this.isWallSliding) {
                this.vy = jumpForce * (this.doubleJumpMult || 1.0);
                this.jumpsRemaining--;
                this.jumpLocked = true;
                if (typeof game !== 'undefined' && game.spawnParticles) {
                    game.spawnParticles(this.x + this.width / 2, this.y + this.height, '#4a9eff', 10, 5, 2, 0.4);
                }
            }
            // If climbing, jump is functioning as the hold-to-climb button, so we must lock it?
            // Actually, if we lock it, they have to re-press to climb. We handled climb directly based on jumpInput (not justJumped), so it's fine.
        } else if (!jumpInput) {
            this.jumpLocked = false;
        }

        // Gravity
        if (!this.isWallClimbing) {
            this.vy += gravity;
            let maxFall = defaultSettings.maxFallSpeed;
            if (keys.KeyS) maxFall = defaultSettings.fastFallSpeed;
            if (this.vy > maxFall) this.vy = maxFall;
        }

        // World Boundaries setup
        const worldW = levelSettings.worldWidth;
        const worldH = levelSettings.worldHeight;

        // --- Jump Pad Collision ---
        if (typeof game !== 'undefined' && game.currentLevelData && game.currentLevelData.jumppads) {
            for (let jp of game.currentLevelData.jumppads) {
                // If player feet intersect jump pad top
                if (this.x + this.width > jp.x && this.x < jp.x + jp.width &&
                    this.y + this.height >= jp.y && this.y + this.height <= jp.y + 20 && this.vy >= 0) {

                    let jf = jp.jumpForce !== undefined ? jp.jumpForce : -20;
                    if (jf >= 0) jf = -20; // force it to go upward to avoid infinite particle generation

                    this.vy = jf;
                    this.y = jp.y - this.height; // pop out of the pad to prevent immediate re-trigger
                    this.grounded = false;
                    this.jumpLocked = true;
                    this.jumpsRemaining = this.extraJumps;
                    this.dashesRemaining = this.extraDashes;
                    this.isWallClimbing = false;
                    this.isWallSliding = false;

                    // Visual/Audio Feedback
                    if (game.spawnParticles) {
                        game.spawnParticles(this.x + this.width / 2, this.y + this.height, '#00ffaa', 15, 8, 4, 0.5);
                    }
                    if (game.camera && game.camera.shake) {
                        game.camera.shake(0.2, 5);
                    }
                }
            }
        }

        // --- X-Axis Movement & Collision ---
        this.x += this.vx;

        if (this.x < 0) {
            this.x = 0;
            this.vx = 0;
            this.lastTouchingWall = -1;
        } else if (this.x + this.width > worldW) {
            this.x = worldW - this.width;
            this.vx = 0;
            this.lastTouchingWall = 1;
        } else {
            this.lastTouchingWall = 0;
        }

        for (let p of platforms) {
            if (this.x + this.width > p.x && this.x < p.x + p.width &&
                this.y + this.height > p.y && this.y < p.y + p.height) {
                // Moving right
                if (this.vx > 0) {
                    this.x = p.x - this.width;
                    this.vx = 0;
                    this.lastTouchingWall = 1;
                }
                // Moving left
                else if (this.vx < 0) {
                    this.x = p.x + p.width;
                    this.vx = 0;
                    this.lastTouchingWall = -1;
                }
            }
        }

        // --- Y-Axis Movement & Collision ---
        this.y += this.vy;

        if (this.y < 0) {
            this.y = 0;
            if (this.vy < 0) this.vy = 0;
        }

        this.grounded = false;
        for (let p of platforms) {
            if (this.x + this.width > p.x && this.x < p.x + p.width &&
                this.y + this.height > p.y && this.y < p.y + p.height) {
                // Moving down (falling)
                if (this.vy > 0) {
                    this.y = p.y - this.height;
                    this.vy = 0;
                    this.grounded = true;
                    this.jumpsRemaining = this.extraJumps;
                    this.dashesRemaining = this.extraDashes;
                }
                // Moving up (jumping)
                else if (this.vy < 0) {
                    this.y = p.y + p.height;
                    this.vy = 0;
                }
            }
        }

        // Fall Damage Logic
        if (this.y > worldH + 100) {
            const damage = levelSettings.fallDamage || 20;
            this.takeDamage(damage);

            if (this.hp > 0) {
                const spawn = game.currentLevelData.spawn;
                this.x = spawn.x;
                this.y = spawn.y;
                this.vx = 0;
                this.vy = 0;
                this.trail = [];
            }
        }
    }
}

class Card {
    constructor(id, name, descriptionTpl, icon, cost, value, effect) {
        this.id = id;
        this.name = name;
        this.descriptionTpl = descriptionTpl;
        this.icon = icon;
        this.cost = cost;
        this.value = value;
        this.effect = effect; // Function (runManager, value) => void
    }

    get description() {
        return this.descriptionTpl.replace('{v}', this.value);
    }
}

const cardPool = [
    new Card('hp_add', '生命核心', '增加 {v} 点最大 HP', '❤️', 5, 20, (m, v) => m.modifiers.maxHpAdd += v),
    new Card('mp_add', '魔力扩容', '增加 {v} 点最大 MP', '🧪', 5, 20, (m, v) => m.modifiers.maxMpAdd += v),
    new Card('speed_mult', '风暴之足', '提升 {v}% 移动速度', '👟', 4, 10, (m, v) => m.modifiers.speedMult += (v / 100)),
    new Card('jump_mult', '强力弹簧', '提升 {v}% 跳跃力度', '🚀', 4, 10, (m, v) => m.modifiers.jumpMult += (v / 100)),
    new Card('mp_regen', '法力回流', '提升 {v} MP/秒 回复速度', '✨', 6, 0.1, (m, v) => m.modifiers.mpRegenAdd += v),
    new Card('cost_down', '造物优化', '减少 {v} 点平台消耗', '🛠️', 8, 2, (m, v) => m.modifiers.costAdd -= v),
    new Card('heal', '急救包', '回复 {v} 点 HP', '🩹', 3, 50, (m, v) => m.currentStats.hp = Math.min(m.currentStats.hp + v, m.currentStats.maxHp + m.modifiers.maxHpAdd)),
    new Card('mp_pot_l', '特大法力药水', '回复 {v} 点 MP', '🧿', 5, 100, (m, v) => m.currentStats.mp = Math.min(m.currentStats.mp + v, m.currentStats.maxMp + m.modifiers.maxMpAdd)),
    new Card('dash', '时空闪烁', '允许按 Shift 冲刺 (0消耗)，距离: {v}倍', '⚡', 12, 4.0, (m, v) => { m.modifiers.extraDashes += 1; m.modifiers.dashSpeedMult = v; }),
    new Card('double_jump', '凌空虚步', '增加一次空中跳跃 (跳跃倍率: {v})', '🕊️', 15, 1.0, (m, v) => { m.modifiers.extraJumps += 1; m.modifiers.doubleJumpMult = v; }),
    new Card('wall_climb', '飞檐走壁', '贴墙缓慢滑落，按W或者空格可蹬墙跳<br>主动爬墙消耗:{v}/s(2级免费)', '🕷️', 10, 1, (m, v) => { m.modifiers.wallClimbLevel += 1; }),
];

function loadCardPoolSettings() {
    const data = localStorage.getItem('geometricPlatformerCardPool');
    if (data) {
        try {
            const saved = JSON.parse(data);
            cardPool.forEach(card => {
                if (saved[card.id]) {
                    if (saved[card.id].cost !== undefined) card.cost = saved[card.id].cost;
                    if (saved[card.id].value !== undefined) card.value = saved[card.id].value;
                }
            });
        } catch (e) {
            console.error("Failed to load card pool settings", e);
        }
    }
}

function saveCardPoolSettings() {
    const data = {};
    cardPool.forEach(card => {
        data[card.id] = { cost: card.cost, value: card.value };
    });
    localStorage.setItem('geometricPlatformerCardPool', JSON.stringify(data));
}

// Immediately load settings to override defaults
loadCardPoolSettings();

class RunManager {
    constructor(game) {
        this.game = game;
        this.runActive = false;
        this.currentStats = {
            hp: 100,
            mp: 100,
            maxHp: 100,
            maxMp: 100,
            currency: 0,
            deck: []
        };
        this.modifiers = {
            maxHpAdd: 0,
            maxMpAdd: 0,
            speedMult: 1.0,
            jumpMult: 1.0,
            mpRegenAdd: 0,
            costAdd: 0,
            extraDashes: 0,
            extraJumps: 0,
            wallClimbLevel: 0,
            dashSpeedMult: 4.0,
            doubleJumpMult: 1.0
        };
    }

    startRun() {
        this.runActive = true;
        this.currentStats = {
            hp: 100,
            mp: 100,
            maxHp: 100,
            maxMp: 100,
            currency: 10, // Start with some currency for testing
            deck: []
        };
        this.modifiers = {
            maxHpAdd: 0,
            maxMpAdd: 0,
            speedMult: 1.0,
            jumpMult: 1.0,
            mpRegenAdd: 0,
            costAdd: 0,
            extraDashes: 0,
            extraJumps: 0,
            wallClimbLevel: 0,
            dashSpeedMult: 4.0,
            doubleJumpMult: 1.0
        };
        console.log("Run Started!");
    }

    endRun() {
        this.runActive = false;
        console.log("Run Ended! Final Currency: " + this.currentStats.currency);
    }

    addCurrency(amount) {
        if (this.runActive) {
            this.currentStats.currency += amount;
        }
    }

    saveState(player) {
        if (!this.runActive) return;
        this.currentStats.hp = player.hp;
        this.currentStats.mp = player.mp;
        // Max stats are managed by modifiers + initial base
        console.log("Run State Saved:", this.currentStats);
    }

    applyState(player) {
        if (!this.runActive) return;

        // Apply permanent modifiers to current stats
        player.maxHp = this.currentStats.maxHp + this.modifiers.maxHpAdd;
        player.maxMp = this.currentStats.maxMp + this.modifiers.maxMpAdd;

        // Restore health/mana to saved values (capped by new max)
        player.hp = Math.min(this.currentStats.hp, player.maxHp);
        player.mp = Math.min(this.currentStats.mp, player.maxMp);

        // Apply multipliers to movement
        player.speed = defaultSettings.speed * this.modifiers.speedMult;
        player.jumpForce = defaultSettings.jumpForce * this.modifiers.jumpMult;

        // Apply additions to regen and cost
        player.mpRegen = (this.game.currentLevelData.settings.mpRegen || 0) + this.modifiers.mpRegenAdd;
        player.platformCost = (this.game.currentLevelData.settings.platformCost || 10) + this.modifiers.costAdd;

        // Apply skill flags
        player.extraDashes = this.modifiers.extraDashes;
        player.extraJumps = this.modifiers.extraJumps;
        player.wallClimbLevel = this.modifiers.wallClimbLevel;
        player.dashSpeedMult = this.modifiers.dashSpeedMult || 4.0;
        player.doubleJumpMult = this.modifiers.doubleJumpMult || 1.0;
    }

    // Shop System
    showShop(nextIdx) {
        if (!this.runActive) {
            this.game.levelManager.loadLevel(nextIdx);
            return;
        }

        this.game.state = 'shop';
        const shopOverlay = document.getElementById('shop-overlay');
        const cardList = document.getElementById('card-list');
        const shopStars = document.getElementById('shop-stars');

        shopStars.textContent = this.currentStats.currency;
        cardList.innerHTML = '';

        // Randomly pick 3 cards
        // Accumulative skills are no longer filtered out
        const availableCards = cardPool;

        const shuffled = [...availableCards].sort(() => 0.5 - Math.random());
        const selected = shuffled.slice(0, 3);

        selected.forEach(card => {
            const cardEl = document.createElement('div');
            cardEl.className = 'card';
            if (this.currentStats.currency < card.cost) {
                cardEl.classList.add('disabled');
            }

            // Dynamic text checking current counts
            let customDesc = card.description;
            if (card.id === 'dash') customDesc += `<br>(已购买: ${this.modifiers.extraDashes}次空中冲刺)`;
            if (card.id === 'double_jump') customDesc += `<br>(已购买: ${this.modifiers.extraJumps}次跳跃)`;
            if (card.id === 'wall_climb') customDesc += `<br>(已购买: ${this.modifiers.wallClimbLevel}级)`;

            cardEl.innerHTML = `
                <div class="card-icon">${card.icon}</div>
                <div class="card-name">${card.name}</div>
                <div class="card-desc">${customDesc}</div>
                <div class="card-cost">⭐ ${card.cost}</div>
            `;

            cardEl.onclick = () => {
                if (this.currentStats.currency >= card.cost) {
                    this.currentStats.currency -= card.cost;

                    // Create unlinked instance of card for leveling up
                    const purchasedCard = { ...card, level: 1 };
                    this.currentStats.deck.push(purchasedCard);

                    card.effect(this, card.value);
                    shopStars.textContent = this.currentStats.currency;
                    // Disable all cards after purchase? (One card per shop)
                    // Or just hide? Let's hide and proceed.
                    this.hideShop(nextIdx);
                }
            };

            cardList.appendChild(cardEl);
        });

        shopOverlay.classList.remove('hidden');
        this._pendingNextIdx = nextIdx; // Store for skip button

        document.getElementById('btn-next-level').onclick = () => {
            this.hideShop(nextIdx);
        };
    }

    hideShop(nextIdx) {
        const shopOverlay = document.getElementById('shop-overlay');
        if (shopOverlay) shopOverlay.classList.add('hidden');
        this.game.state = 'play';
        // Proceed to next level
        if (nextIdx !== undefined && nextIdx !== null && nextIdx !== -1) {
            this.game.levelManager.loadLevel(nextIdx);
        } else {
            this.game.win();
        }
    }
}


class LevelManager {
    constructor(game) {
        this.game = game;
        this.levels = [];
        this.currentLevelIndex = 0;
        this.loadFromStorage();
        if (this.levels.length === 0) {
            this.createDefaultLevel();
        } else {
            // Aggressive Cleanup: Wipe platforms that look like the old defaults
            let changed = false;
            this.levels.forEach(lvl => {
                if (lvl.platforms && lvl.platforms.length > 0) {
                    // Previous aggressive cleanup removed.
                }
                // Ensure new structures exist
                if (!lvl.conditions) {
                    lvl.conditions = { timeLimit: 0, targetCount: 1 };
                    changed = true;
                }
                if (!lvl.flow) {
                    lvl.flow = { nextType: 'linear', targets: [] };
                    changed = true;
                }
                if (!lvl.triggers) {
                    lvl.triggers = [];
                    changed = true;
                }
            });
            if (changed) this.saveToStorage();
        }
    }

    createDefaultLevel() {
        this.levels.push({
            name: "关卡 1",
            settings: JSON.parse(JSON.stringify(defaultSettings)),
            platforms: [],
            goals: [{ x: window.innerWidth * 0.8, y: window.innerHeight * 0.8 }],
            traps: [],
            enemies: [],
            exit: { x: window.innerWidth * 0.9, y: window.innerHeight * 0.8, w: 50, h: 50, active: false },
            spawn: { x: window.innerWidth * 0.1, y: window.innerHeight * 0.8 },
            conditions: { timeLimit: 0, targetCount: 1 },
            flow: { next: [] },
            triggers: []
        });
        this.saveToStorage();
    }

    getCurrentLevel() {
        return this.levels[this.currentLevelIndex];
    }

    getNextLevelIndex() {
        if (this.currentLevelIndex + 1 < this.levels.length) {
            return this.currentLevelIndex + 1;
        }
        return -1;
    }

    loadLevel(index) {
        if (index >= 0 && index < this.levels.length) {
            this.currentLevelIndex = index;
            if (!this.levels[index].settings) {
                this.levels[index].settings = { ...defaultSettings };
            }
            this.game.loadLevel(this.levels[index]);
            updateDashboard();
        }
    }

    createNewLevel() {
        this.levels.push({
            name: `关卡 ${this.levels.length + 1}`,
            settings: { ...defaultSettings },
            platforms: [],
            goals: [{ x: window.innerWidth * 0.8, y: window.innerHeight * 0.8 }],
            traps: [],
            enemies: [],
            exit: { x: window.innerWidth * 0.9, y: window.innerHeight * 0.8, w: 50, h: 50, active: false },
            spawn: { x: window.innerWidth * 0.1, y: window.innerHeight * 0.8 },
            conditions: { timeLimit: 0, targetCount: 1 },
            flow: { nextType: 'linear', targets: [] },
            triggers: []
        });
        this.saveToStorage();
        this.loadLevel(this.levels.length - 1);
        if (this.game.blueprintEditor) this.game.blueprintEditor.draw();
    }

    deleteLevel(index) {
        if (this.levels.length <= 1) {
            alert('无法删除！最少需要保留一个关卡。');
            return;
        }
        if (confirm('确定要删除关卡 "' + this.levels[index].name + '" 吗？')) {
            this.levels.splice(index, 1);
            if (this.currentLevelIndex >= this.levels.length) {
                this.currentLevelIndex = this.levels.length - 1;
            } else if (this.currentLevelIndex > index) {
                this.currentLevelIndex--;
            }
            this.saveToStorage();
            this.loadLevel(this.currentLevelIndex);
        }
    }

    moveLevelUp(index) {
        if (index > 0 && index < this.levels.length) {
            const temp = this.levels[index];
            this.levels[index] = this.levels[index - 1];
            this.levels[index - 1] = temp;
            if (this.currentLevelIndex === index) {
                this.currentLevelIndex--;
            } else if (this.currentLevelIndex === index - 1) {
                this.currentLevelIndex++;
            }
            this.saveToStorage();
            updateDashboard();
        }
    }

    moveLevelDown(index) {
        if (index >= 0 && index < this.levels.length - 1) {
            const temp = this.levels[index];
            this.levels[index] = this.levels[index + 1];
            this.levels[index + 1] = temp;
            if (this.currentLevelIndex === index) {
                this.currentLevelIndex++;
            } else if (this.currentLevelIndex === index + 1) {
                this.currentLevelIndex--;
            }
            this.saveToStorage();
            updateDashboard();
        }
    }

    renameLevel(index, newName) {
        if (newName && index >= 0 && index < this.levels.length) {
            this.levels[index].name = newName;
            this.saveToStorage();
            updateDashboard();
        }
    }

    saveCurrentLevelState(platforms, goals, exit, spawn, settings, conditions, flow, traps, triggers, jumppads) {
        const level = this.levels[this.currentLevelIndex];
        if (!level) return;
        level.platforms = JSON.parse(JSON.stringify(platforms));
        level.goals = JSON.parse(JSON.stringify(goals));
        level.exit = JSON.parse(JSON.stringify(exit));
        level.spawn = JSON.parse(JSON.stringify(spawn));
        level.settings = JSON.parse(JSON.stringify(settings));
        level.conditions = JSON.parse(JSON.stringify(conditions));
        level.flow = JSON.parse(JSON.stringify(flow));
        if (triggers) level.triggers = JSON.parse(JSON.stringify(triggers));
        else if (this.game.currentLevelData.triggers) level.triggers = JSON.parse(JSON.stringify(this.game.currentLevelData.triggers));
        if (traps) level.traps = JSON.parse(JSON.stringify(traps));
        if (jumppads) level.jumppads = JSON.parse(JSON.stringify(jumppads));
        if (this.game.currentLevelData.items) level.items = JSON.parse(JSON.stringify(this.game.currentLevelData.items));
        if (this.game.currentLevelData.facilities) level.facilities = JSON.parse(JSON.stringify(this.game.currentLevelData.facilities));
        this.saveToStorage();
    }

    saveToStorage() {
        localStorage.setItem('geometricPlatformerLevels', JSON.stringify(this.levels));
    }

    loadFromStorage() {
        const data = localStorage.getItem('geometricPlatformerLevels');
        if (data) {
            this.levels = JSON.parse(data);
            // Migrate old levels
            this.levels.forEach(lvl => {
                if (!lvl.triggers) lvl.triggers = [];
                if (!lvl.flow) lvl.flow = { nextType: 'linear', targets: [] };
            });
        }
    }

    exportLevels() {
        const data = JSON.stringify(this.levels, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'levels.json';
        a.click();
    }

    async exportStandaloneGame() {
        if (!this.game || !this.game.currentLevelData) return;

        // Save current level state first
        const d = this.game.currentLevelData;
        this.saveCurrentLevelState(d.platforms, d.goals, d.exit, d.spawn, d.settings, d.conditions, d.flow, d.traps, d.triggers, d.jumppads);

        // ── Fetch CSS ─────────────────────────────────────────────────────────
        let cssText = '';
        const styleTag = document.getElementById('game-styles');
        if (styleTag) {
            cssText = styleTag.innerHTML;
        } else {
            console.warn("Could not find <style id='game-styles'> for export.");
        }

        // ── Bundle JS Classes ─────────────────────────────────────────────────
        const cardPoolLiteral = 'const cardPool = [\n' + cardPool.map(c =>
            `    new Card(${JSON.stringify(c.id)}, ${JSON.stringify(c.name)}, ${JSON.stringify(c.descriptionTpl)}, ${JSON.stringify(c.icon)}, ${c.cost}, ${c.value}, ${c.effect.toString()})`
        ).join(',\n') + '\n];';

        // Include ALL classes needed — Camera, Player, Card, RunManager, LevelManager, Editor, BlueprintEditor, Game
        // Note: Editor and BlueprintEditor classes are still included because Game constructor references them.
        // window.ENABLE_EDITOR = false will prevent editor from being instantiated.
        const classes = [Camera, Player, Card, RunManager, LevelManager, Editor, BlueprintEditor, Game];
        const classCode = classes.map(c => c.toString()).join('\n\n');

        const levelsJSON = JSON.stringify(this.levels);
        const defaultSettingsJSON = JSON.stringify(defaultSettings);

        // ── Extract Play UI HTML via Robust DOM Cloning ───────────────────────
        // Capture the live play-ui but ensure it's not hidden.
        const playUIClone = document.getElementById('play-ui').cloneNode(true);

        // Remove 'hidden' from root if it was hidden by editor
        playUIClone.classList.remove('hidden');

        // Reset sub-elements to default play-state
        const wsClone = playUIClone.querySelector('#win-screen');
        if (wsClone) wsClone.classList.add('hidden');

        const soClone = playUIClone.querySelector('#shop-overlay');
        if (soClone) soClone.classList.add('hidden');

        const psClone = playUIClone.querySelector('#player-stats');
        if (psClone) psClone.classList.remove('hidden');

        const gsClone = playUIClone.querySelector('#game-stats');
        if (gsClone) gsClone.classList.remove('hidden');

        const currClone = playUIClone.querySelector('#currency-display');
        if (currClone) currClone.classList.add('hidden'); // hidden until run starts

        // Remove editor-specific buttons/divs
        ['btn-stop-test', 'btn-edit-mode', 'instructions'].forEach(id => {
            const el = playUIClone.querySelector('#' + id);
            if (el) el.remove();
        });

        const playUIHTML = `    <div id="ui-layer">\n        ${playUIClone.outerHTML}\n    </div>\n    <canvas id="gameCanvas"></canvas>`;

        // ── Standalone Init Script ────────────────────────────────────────────
        const scriptContent = `
// ══ STANDALONE MODE ══════════════════════════════════════════════════════════
window.IS_STANDALONE = true;
window.ENABLE_EDITOR = false; // Disable editor completely

// Standalone polyfill for win screen to avoid reference errors in player module
const winScreen = {
    classList: {
        add: () => {},
        remove: () => {}
    }
};

const defaultSettings = ${defaultSettingsJSON};
const keys = {};
window.addEventListener('keydown', e => { keys[e.code] = true; });
window.addEventListener('keyup', e => { keys[e.code] = false; });

// ── Class Definitions ────────────────────────────────────────────────────────
${classCode}

// ── Card Pool ────────────────────────────────────────────────────────────────
${cardPoolLiteral}

// ── Util Functions ───────────────────────────────────────────────────────────
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
// Stub: dashboard is editor-only, not needed in standalone
function updateDashboard() {}

// ── DOM References ───────────────────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const uiLayer = document.getElementById('ui-layer');
const playUI = document.getElementById('play-ui');
const winScreen = document.getElementById('win-screen');

// ── Game Initialization ──────────────────────────────────────────────────────
// Pass level data via global before Game constructor runs
window.STANDALONE_DATA = ${levelsJSON};

const game = new Game();

// Auto-start the roguelike run so the shop appears between levels
game.runManager.startRun();

// ── UI Event Listeners ───────────────────────────────────────────────────────
window.addEventListener('resize', resize);
resize();

// Keyboard: R to restart
window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR') {
        if (typeof game !== 'undefined') game.restartLevel();
    }
});

// Prevent default context menu on right-click
canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
});

// Mouse click: place platform (costs MP)
canvas.addEventListener('mousedown', (e) => {
    if (game.state !== 'play') return;
    
    // Only handle left (0) and right (2) clicks for platform placement
    if (e.button !== 0 && e.button !== 2) return;

    const cost = (game.currentLevelData.settings && game.currentLevelData.settings.platformCost) || 10;
    if (!game.player.consumeMp(cost)) {
        const mpBar = document.getElementById('mp-bar-fill');
        if (mpBar) {
            mpBar.parentElement.style.borderColor = 'red';
            setTimeout(() => mpBar.parentElement.style.borderColor = '', 300);
        }
        return;
    }
    const rect = canvas.getBoundingClientRect();
    const worldX = (e.clientX - rect.left) + game.camera.x;
    const worldY = (e.clientY - rect.top) + game.camera.y;
    
    // Left click: Horizontal (100x20), Right click: Vertical (20x100)
    let bw = 100;
    let bh = 20;
    if (e.button === 2) {
        bw = 20;
        bh = 100;
    }
    
    game.currentLevelData.platforms.push({ x: worldX - bw/2, y: worldY - bh/2, width: bw, height: bh, color: '#888' });
});

// Shop: close without buying / skip
const closeShopBtn = document.getElementById('btn-next-level');
if (closeShopBtn) {
    closeShopBtn.addEventListener('click', () => {
        // This button is inside the shop, so "继续前进" skips the shop
        if (game.runManager) game.runManager.hideShop(game.runManager._pendingNextIdx);
    });
}

// Win screen: restart
const restartBtn = document.getElementById('btn-restart');
if (restartBtn) restartBtn.addEventListener('click', () => game.restartLevel());

// Win screen: next level
const nextLevelWinBtn = document.getElementById('btn-win-next');
if (nextLevelWinBtn) {
    nextLevelWinBtn.addEventListener('click', () => {
        const nextIdx = game.levelManager.getNextLevelIndex();
        if (nextIdx !== -1) {
            if (game.runManager && game.runManager.showShop) {
                game.runManager.showShop(nextIdx);
            } else {
                game.levelManager.loadLevel(nextIdx);
            }
        } else {
            alert('恭喜！你已完成了所有关卡！');
            game.state = 'play';
            if (typeof winScreen !== 'undefined' && winScreen) winScreen.classList.add('hidden');
        }
    });
}
`;

        // ── Build Full HTML ───────────────────────────────────────────────────
        const linkTag = cssText ? '' : '<link rel="stylesheet" href="style.css">';
        const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>几何跳跃 - 独立版</title>
    ${linkTag}
    <style>
/* Remove editor-specific layout — only keep game styles */
body { margin: 0; overflow: hidden; background: #1a1a2e; font-family: sans-serif; }
canvas { position: fixed; top: 0; left: 0; display: block; }
#ui-layer { position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 10; }
#play-ui { pointer-events: auto; }
.hidden { display: none !important; }

/* ── Imported game styles ── */
${cssText}
    </style>
</head>
<body>
${playUIHTML}
    <script>
${scriptContent}
    <\/script>
</body>
</html>`;

        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'geometry_jump_standalone.html';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        console.log('[Export] Standalone game exported successfully.');
    }
}

class Editor {
    constructor(game) {
        this.game = game;
        this.active = false;
        this.tool = 'cursor';
        this.cameraX = 0;
        this.cameraY = 0;
        this.snap = true;
        this.dragStart = null;
        this.selectedObject = null;
        this.selectedType = null; // 'platform', 'goal', 'exit', 'spawn'
        this.setupInput();

        // Real-time Settings Update
        const settingInputs = [
            'set-gravity', 'set-jump', 'set-speed', 'set-width', 'set-height',
            'set-max-hp', 'set-max-mp', 'set-platform-cost', 'set-fall-damage', 'set-mp-regen',
            'set-time-limit', 'set-target-count'
        ];
        settingInputs.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', () => this.applySettingsFromUI());
            }
        });
        const nextTypeEl = document.getElementById('set-next-type');
        if (nextTypeEl) nextTypeEl.addEventListener('change', () => this.applySettingsFromUI());

        // Database Bar Interaction Logic
        const dbBar = document.getElementById('editor-bottom-bar');
        const btnCollapse = document.getElementById('btn-collapse-db');
        const btnExpand = document.getElementById('btn-expand-db');

        if (btnCollapse && dbBar && btnExpand) {
            btnCollapse.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                dbBar.classList.add('collapsed');
                btnExpand.classList.remove('hidden');
            });
            btnExpand.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                dbBar.classList.remove('collapsed');
                btnExpand.classList.add('hidden');
            });
        }

        // Tab Switching Logic
        const navBtns = document.querySelectorAll('.db-nav-btn[data-tab]');
        const panes = document.querySelectorAll('.db-tab-pane');
        navBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const target = btn.getAttribute('data-tab');
                navBtns.forEach(b => b.classList.remove('active'));
                panes.forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById('tab-' + target).classList.add('active');
            });
        });

        // Trap Selection from UI
        const trapItems = document.querySelectorAll('.trap-item[data-type]');
        trapItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.tool = 'trap';
                this.selectedTrapType = item.getAttribute('data-type');
                // Deselect others
                trapItems.forEach(i => i.classList.remove('active'));
                item.classList.add('active');

                // Clear tool buttons
                document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
            });
        });

        // Facility Selection from UI
        const facilityItems = document.querySelectorAll('.facility-item[data-type]');
        facilityItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.tool = 'facility';
                this.selectedFacilityType = item.getAttribute('data-type');
                // Deselect others
                facilityItems.forEach(i => i.classList.remove('active'));
                item.classList.add('active');

                // Clear tool buttons
                document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
            });
        });

        // Clipboard for Copy/Paste
        this.clipboard = null;
        this.clipboardType = null;

        // Property Panel Handlers
        const propDamage = document.getElementById('prop-trap-damage');
        const propScale = document.getElementById('prop-trap-scale');
        const btnRotate = document.getElementById('btn-rotate-trap');

        if (propDamage) propDamage.onchange = (e) => {
            if (this.selectedObject && this.selectedType === 'trap') {
                this.selectedObject.damage = parseInt(e.target.value) || 20;
            }
        };

        if (propScale) propScale.onchange = (e) => {
            if (this.selectedObject && this.selectedType === 'trap') {
                this.selectedObject.scale = parseFloat(e.target.value) || 1;
            }
        };

        if (btnRotate) btnRotate.onclick = () => {
            if (this.selectedObject && this.selectedType === 'trap') {
                this.selectedObject.rotation = (this.selectedObject.rotation || 0) + 90;
                if (this.selectedObject.rotation >= 360) this.selectedObject.rotation = 0;
            }
        };

        // Hotkeys for Copy/Paste
        window.addEventListener('keydown', (e) => {
            if (!this.active) return;
            if (e.ctrlKey && e.code === 'KeyC') { e.preventDefault(); this.copy(); }
            if (e.ctrlKey && e.code === 'KeyV') { e.preventDefault(); this.paste(); }
        });
    }

    toggle() {
        this.active = !this.active;
        if (this.active) {
            // Restore pristine editor state by reloading from levels block before we display Editor UI
            // This prevents midway physics positions (platforms halfway moved) from becoming canonical editor coordinates.
            this.selectedObject = null;
            this.selectedType = null;
            this.game.restartLevel();

            this.game.state = 'edit';
            playUI.classList.add('hidden');
            document.getElementById('player-stats').classList.add('hidden');
            document.getElementById('instructions').classList.add('hidden');
            editorUI.classList.remove('hidden');
            updateDashboard();
            this.updateDatabaseUI();
            this.updatePropertiesUI();
        } else {
            // Save state before leaving editor
            const d = this.game.currentLevelData;
            this.game.levelManager.saveCurrentLevelState(
                d.platforms, d.goals, d.exit, d.spawn, d.settings, d.conditions, d.flow, d.traps, d.triggers, d.jumppads
            );

            this.game.state = 'play';
            playUI.classList.remove('hidden');
            document.getElementById('player-stats').classList.remove('hidden');
            editorUI.classList.add('hidden');
            settingsPanel.classList.add('hidden');
            this.game.restartLevel();
        }
    }


    applySettingsFromUI() {
        const d = this.game.currentLevelData;
        const s = d.settings;
        const c = d.conditions;
        const f = d.flow;

        // Global Settings (Write to defaultSettings)
        defaultSettings.gravity = parseFloat(document.getElementById('set-gravity').value);
        defaultSettings.jumpForce = parseFloat(document.getElementById('set-jump').value);
        defaultSettings.speed = parseFloat(document.getElementById('set-speed').value);
        defaultSettings.worldWidth = parseFloat(document.getElementById('set-width').value);
        defaultSettings.worldHeight = parseFloat(document.getElementById('set-height').value);

        // Also update current level settings (for backward compatibility/saving)
        s.gravity = defaultSettings.gravity;
        s.jumpForce = defaultSettings.jumpForce;
        s.speed = defaultSettings.speed;
        s.worldWidth = defaultSettings.worldWidth;
        s.worldHeight = defaultSettings.worldHeight;

        // Roguelike Settings (Per Level? Or Global? User said "Gravity, Jump, Speed" are global. 
        // Let's keep Roguelike settings per level for now to allow difficulty progression, 
        // or should they be global too? "所有关卡的这三项数值一致" implies only those 3 are strictly global.
        // But let's assume world size might vary.)

        s.playerMaxHp = parseFloat(document.getElementById('set-max-hp').value);
        s.playerMaxMp = parseFloat(document.getElementById('set-max-mp').value);
        s.platformCost = parseFloat(document.getElementById('set-platform-cost').value);
        s.fallDamage = parseFloat(document.getElementById('set-fall-damage').value);
        s.mpRegen = parseFloat(document.getElementById('set-mp-regen').value);

        c.timeLimit = parseFloat(document.getElementById('set-time-limit').value) || 0;
        c.targetCount = parseInt(document.getElementById('set-target-count').value) || 1;

        f.nextType = document.getElementById('set-next-type').value;

        // Level Type (Normal vs Shop)
        s.type = document.getElementById('set-level-type').value || 'normal';

        // Save immediately
        this.game.levelManager.saveCurrentLevelState(
            d.platforms, d.goals, d.exit, d.spawn, s, c, f, d.traps, d.triggers, d.jumppads
        );

        // Update Player Stats immediately if in editor
        this.game.player.updateStats(s);

        // Force resize if world size changed
        if (game.camera) game.camera.clamp(s.worldWidth, s.worldHeight);
    }

    updateSettingsUI(levelData) {
        const d = levelData || this.game.currentLevelData;
        const s = d.settings;
        const c = d.conditions || { timeLimit: 0, targetCount: 1 };
        const f = d.flow || { nextType: 'linear' };

        // Read physics from Global Default Settings
        document.getElementById('set-gravity').value = defaultSettings.gravity;
        document.getElementById('set-jump').value = defaultSettings.jumpForce;
        document.getElementById('set-speed').value = defaultSettings.speed;
        // World dimensions are per-level, read from level settings
        document.getElementById('set-width').value = s.worldWidth || defaultSettings.worldWidth;
        document.getElementById('set-height').value = s.worldHeight || defaultSettings.worldHeight;

        // Roguelike Settings (read from level for now, or default if missing)
        document.getElementById('set-max-hp').value = s.playerMaxHp || 100;
        document.getElementById('set-max-mp').value = s.playerMaxMp || 100;
        document.getElementById('set-platform-cost').value = s.platformCost || 10;
        document.getElementById('set-fall-damage').value = s.fallDamage || 20;
        document.getElementById('set-mp-regen').value = s.mpRegen !== undefined ? s.mpRegen : 0.1;

        document.getElementById('set-time-limit').value = c.timeLimit;
        document.getElementById('set-target-count').value = c.targetCount;

        document.getElementById('set-next-type').value = f.nextType;

        // Level Type (Normal vs Shop)
        document.getElementById('set-level-type').value = s.type || 'normal';
    }

    updatePropertiesUI() {
        const panel = document.getElementById('editor-properties-panel');
        const trapProps = document.getElementById('trap-props');
        const platformProps = document.getElementById('platform-props');

        if (!panel) return;

        // Prevent wiping out user's current typing
        if (panel.contains(document.activeElement)) return;

        // Cleanup old event listeners by cloning nodes to avoid multiple bindings
        const cloneAndReplace = (id) => {
            const el = document.getElementById(id);
            if (!el) return null;
            const clone = el.cloneNode(true);
            el.parentNode.replaceChild(clone, el);
            return clone;
        };

        if (this.selectedObject) {
            panel.classList.remove('hidden');

            const jumppadProps = document.getElementById('jumppad-props');
            if (jumppadProps) jumppadProps.classList.add('hidden');
            const facilityProps = document.getElementById('facility-props');
            if (facilityProps) facilityProps.classList.add('hidden');

            if (this.selectedType === 'trap') {
                trapProps.classList.remove('hidden');
                platformProps.classList.add('hidden');
                document.getElementById('trigger-props').classList.add('hidden'); // Hide trigger props

                document.getElementById('prop-trap-damage').value = this.selectedObject.damage || 20;
                document.getElementById('prop-trap-scale').value = this.selectedObject.scale || 1;
                document.getElementById('prop-trap-speed').value = this.selectedObject.speed || 0;
                document.getElementById('prop-trap-tx').value = this.selectedObject.tx || 0;
                document.getElementById('prop-trap-ty').value = this.selectedObject.ty || 0;
                document.getElementById('prop-trap-oscX').value = this.selectedObject.oscX || 0;
                document.getElementById('prop-trap-oscY').value = this.selectedObject.oscY || 0;
                document.getElementById('prop-trap-oscSpeed').value = this.selectedObject.oscSpeed || 0;

                ['damage', 'scale', 'speed', 'tx', 'ty', 'oscX', 'oscY', 'oscSpeed'].forEach(prop => {
                    const el = cloneAndReplace(`prop-trap-${prop}`);
                    if (el) el.addEventListener('change', (e) => {
                        this.selectedObject[prop] = parseFloat(e.target.value) || 0;
                    });
                });

                const btnRotate = cloneAndReplace('btn-rotate-trap');
                if (btnRotate) btnRotate.addEventListener('click', () => {
                    this.selectedObject.rotation = ((this.selectedObject.rotation || 0) + 90) % 360;
                });
            } else if (this.selectedType === 'platform') {
                trapProps.classList.add('hidden');
                platformProps.classList.remove('hidden');
                document.getElementById('trigger-props').classList.add('hidden'); // Hide trigger props

                document.getElementById('prop-platform-speed').value = this.selectedObject.speed || 0;
                document.getElementById('prop-platform-tx').value = this.selectedObject.tx || 0;
                document.getElementById('prop-platform-ty').value = this.selectedObject.ty || 0;
                document.getElementById('prop-platform-oscX').value = this.selectedObject.oscX || 0;
                document.getElementById('prop-platform-oscY').value = this.selectedObject.oscY || 0;
                document.getElementById('prop-platform-oscSpeed').value = this.selectedObject.oscSpeed || 0;

                ['speed', 'tx', 'ty', 'oscX', 'oscY', 'oscSpeed'].forEach(prop => {
                    const el = cloneAndReplace(`prop-platform-${prop}`);
                    if (el) el.addEventListener('change', (e) => {
                        this.selectedObject[prop] = parseFloat(e.target.value) || 0;
                    });
                });
            } else if (this.selectedType === 'trigger') {
                trapProps.classList.add('hidden');
                platformProps.classList.add('hidden');
                document.getElementById('trigger-props').classList.remove('hidden');

                const oneshot = document.getElementById('prop-trigger-oneshot');
                oneshot.checked = this.selectedObject.oneShot;
                oneshot.onchange = (e) => this.selectedObject.oneShot = e.target.checked;

                this.refreshTriggerBindingsList();

                const btnBind = cloneAndReplace('btn-add-binding');
                if (btnBind) {
                    btnBind.addEventListener('click', () => {
                        this.isBindingMode = !this.isBindingMode;
                        const hint = document.getElementById('binding-mode-hint');
                        if (this.isBindingMode) {
                            hint.classList.remove('hidden');
                            btnBind.textContent = '取消绑定模式';
                            btnBind.style.background = '#ff4a4a';
                        } else {
                            hint.classList.add('hidden');
                            btnBind.textContent = '+ 点击陷阱添加绑定';
                            btnBind.style.background = '#ff8800';
                        }
                    });
                }
            } else if (this.selectedType === 'jumppad') {
                trapProps.classList.add('hidden');
                platformProps.classList.add('hidden');
                document.getElementById('trigger-props').classList.add('hidden');
                if (jumppadProps) jumppadProps.classList.remove('hidden');

                const jumpEl = cloneAndReplace('prop-jumppad-force');
                if (jumppadProps) {
                    jumpEl.value = this.selectedObject.jumpForce || -20;
                    jumpEl.addEventListener('change', (e) => {
                        this.selectedObject.jumpForce = parseFloat(e.target.value) || -20;
                    });
                }
            } else if (this.selectedType === 'facility') {
                trapProps.classList.add('hidden');
                platformProps.classList.add('hidden');
                document.getElementById('trigger-props').classList.add('hidden');
                if (facilityProps) facilityProps.classList.remove('hidden');

                const costEl = cloneAndReplace('prop-facility-cost');
                if (costEl) {
                    costEl.value = this.selectedObject.cost !== undefined ? this.selectedObject.cost : 10;
                    costEl.addEventListener('change', (e) => {
                        this.selectedObject.cost = Math.max(0, parseInt(e.target.value) || 0);
                    });
                }
                const amountEl = cloneAndReplace('prop-facility-amount');
                if (amountEl) {
                    amountEl.value = this.selectedObject.amount !== undefined ? this.selectedObject.amount : 1;
                    amountEl.addEventListener('change', (e) => {
                        this.selectedObject.amount = Math.max(1, parseInt(e.target.value) || 1);
                    });
                }
            } else {
                trapProps.classList.add('hidden');
                platformProps.classList.add('hidden');
                document.getElementById('trigger-props').classList.add('hidden');
            }
        } else {
            panel.classList.add('hidden');
            trapProps.classList.add('hidden');
            platformProps.classList.add('hidden');
            document.getElementById('trigger-props').classList.add('hidden');
            const jumppadProps = document.getElementById('jumppad-props');
            if (jumppadProps) jumppadProps.classList.add('hidden');
            document.getElementById('trigger-props').classList.add('hidden');
            this.isBindingMode = false;
        }
    }

    refreshTriggerBindingsList() {
        const list = document.getElementById('trigger-bindings-list');
        if (!list || !this.selectedObject || this.selectedType !== 'trigger') return;
        list.innerHTML = '';
        const data = this.game.currentLevelData;

        this.selectedObject.bindings.forEach((bind, bIdx) => {
            const trap = data.traps[bind.trapIndex];
            const div = document.createElement('div');
            div.style.background = 'rgba(255,136,0,0.1)';
            div.style.border = '1px solid rgba(255,136,0,0.3)';
            div.style.padding = '4px';
            div.style.marginBottom = '4px';
            div.style.fontSize = '11px';
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.alignItems = 'center';

            const name = trap ? `${trap.type} #${bind.trapIndex}` : `未知陷阱 #${bind.trapIndex}`;
            div.innerHTML = `<span>${name}</span>`;

            const rightSide = document.createElement('div');
            rightSide.style.display = 'flex';
            rightSide.style.gap = '5px';

            const delayInput = document.createElement('input');
            delayInput.type = 'number';
            delayInput.step = '0.1';
            delayInput.min = '0';
            delayInput.value = bind.delay || 0;
            delayInput.style.width = '40px';
            delayInput.style.background = '#000';
            delayInput.style.border = '1px solid #444';
            delayInput.style.color = '#ffcc00';
            delayInput.onchange = (e) => bind.delay = parseFloat(e.target.value) || 0;
            rightSide.appendChild(delayInput);

            const delBtn = document.createElement('button');
            delBtn.textContent = '×';
            delBtn.style.background = '#822';
            delBtn.style.color = '#fff';
            delBtn.style.border = 'none';
            delBtn.style.padding = '0 5px';
            delBtn.onclick = () => {
                this.selectedObject.bindings.splice(bIdx, 1);
                this.refreshTriggerBindingsList();
            };
            rightSide.appendChild(delBtn);

            div.appendChild(rightSide);
            list.appendChild(div);
        });
    }

    copy() {
        if (this.selectedObject) {
            this.clipboard = JSON.parse(JSON.stringify(this.selectedObject));
            this.clipboardType = this.selectedType;
            console.log("Copied:", this.clipboardType);
        }
    }

    paste() {
        if (this.clipboard) {
            const newItem = JSON.parse(JSON.stringify(this.clipboard));
            newItem.x += 20; // Offset for visibility
            newItem.y += 20;

            if (this.clipboardType === 'platform') {
                this.game.currentLevelData.platforms.push(newItem);
            } else if (this.clipboardType === 'trap') {
                this.game.currentLevelData.traps.push(newItem);
            } else if (this.clipboardType === 'goal') {
                this.game.currentLevelData.goals.push(newItem);
            } else if (this.clipboardType === 'trigger') {
                this.game.currentLevelData.triggers.push(newItem);
            }

            this.selectedObject = newItem;
            this.selectedType = this.clipboardType;
            this.updatePropertiesUI();
            console.log("Pasted:", this.clipboardType);
        }
    }

    deleteSelected() {
        if (!this.selectedObject || !this.selectedType) return;
        const data = this.game.currentLevelData;

        if (this.selectedType === 'platform') {
            const idx = data.platforms.indexOf(this.selectedObject);
            if (idx !== -1) data.platforms.splice(idx, 1);
        } else if (this.selectedType === 'trap') {
            const idx = data.traps.indexOf(this.selectedObject);
            if (idx !== -1) data.traps.splice(idx, 1);
        } else if (this.selectedType === 'jumppad') {
            const idx = data.jumppads.indexOf(this.selectedObject);
            if (idx !== -1) data.jumppads.splice(idx, 1);
        } else if (this.selectedType === 'goal') {
            const idx = data.goals.indexOf(this.selectedObject);
            if (idx !== -1) data.goals.splice(idx, 1);
            // Ensure at least one goal exists if we deleted the last one?
            // Actually, keep it empty if user wants, but engine might need at least one to be winnable.
            // Let's allow empty, but maybe add a warning later.
        } else if (this.selectedType === 'trigger') {
            const idx = data.triggers.indexOf(this.selectedObject);
            if (idx !== -1) data.triggers.splice(idx, 1);
        } else if (this.selectedType === 'exit') {
            const ws = data.settings;
            data.exit.x = ws.worldWidth - 100;
            data.exit.y = ws.worldHeight - 100;
            data.exit.w = 50;
            data.exit.h = 50;
        } else if (this.selectedType === 'spawn') {
            data.spawn.x = 100;
            data.spawn.y = data.settings.worldHeight - 100;
            this.game.player.x = data.spawn.x;
            this.game.player.y = data.spawn.y;
        }

        this.selectedObject = null;
        this.selectedType = null;
    }

    setupInput() {
        canvas.addEventListener('mousemove', (e) => {
            const rect = canvas.getBoundingClientRect();
            const screenX = e.clientX - rect.left;
            const screenY = e.clientY - rect.top;

            this.worldX = screenX + this.cameraX;
            this.worldY = screenY + this.cameraY;

            if (this.snap) {
                this.worldX = Math.round(this.worldX / defaultSettings.gridSize) * defaultSettings.gridSize;
                this.worldY = Math.round(this.worldY / defaultSettings.gridSize) * defaultSettings.gridSize;
            }

            if (this.isPanning) {
                this.cameraX = this.panStart.camX - (screenX - this.panStart.x);
                this.cameraY = this.panStart.camY - (screenY - this.panStart.y);
                canvas.style.cursor = 'grabbing';
            } else if (keys['Space']) {
                canvas.style.cursor = 'grab';
            } else {
                canvas.style.cursor = 'crosshair';
            }

            // Dragging Selected Object (Move Tool)
            if (this.tool === 'cursor' && this.isDraggingObject && this.selectedObject) {
                if (this.selectedType === 'platform') {
                    this.selectedObject.x = this.worldX - this.dragOffset.x;
                    this.selectedObject.y = this.worldY - this.dragOffset.y;
                } else if (this.selectedType === 'trap') {
                    let rawWorldX = screenX + this.cameraX;
                    let rawWorldY = screenY + this.cameraY;
                    let newX = rawWorldX - this.dragOffset.x;
                    let newY = rawWorldY - this.dragOffset.y;
                    if (this.snap) {
                        const halfGrid = defaultSettings.gridSize / 2;
                        newX = Math.round(newX / halfGrid) * halfGrid;
                        newY = Math.round(newY / halfGrid) * halfGrid;
                    }
                    this.selectedObject.x = newX;
                    this.selectedObject.y = newY;
                } else if (this.selectedType === 'trigger') {
                    this.selectedObject.x = this.worldX - this.dragOffset.x;
                    this.selectedObject.y = this.worldY - this.dragOffset.y;
                } else {
                    this.selectedObject.x = this.worldX;
                    this.selectedObject.y = this.worldY;
                }
            }
        });

        canvas.addEventListener('mousedown', (e) => {
            if (!this.active) return;

            const rect = canvas.getBoundingClientRect();
            const screenX = e.clientX - rect.left;
            const screenY = e.clientY - rect.top;

            // Spacebar + Left Click OR Middle Click to Pan
            if (e.button === 1 || (e.button === 0 && keys['Space'])) {
                this.isPanning = true;
                canvas.style.cursor = 'grabbing';
                this.panStart = {
                    x: screenX,
                    y: screenY,
                    camX: this.cameraX,
                    camY: this.cameraY
                };
                return;
            }

            if (this.tool === 'cursor') {
                // Selection Logic
                const data = game.currentLevelData;
                let found = null;
                let foundType = null;

                // Priority: Spawn > Exit > Goal > Trigger > Trap > Platform
                if (Math.hypot(this.worldX - data.spawn.x, this.worldY - data.spawn.y) < 20) {
                    found = data.spawn; foundType = 'spawn';
                }

                if (!found) {
                    const ew = data.exit.w || 50;
                    const eh = data.exit.h || 50;
                    if (this.worldX >= data.exit.x && this.worldX <= data.exit.x + ew &&
                        this.worldY >= data.exit.y && this.worldY <= data.exit.y + eh) {
                        found = data.exit; foundType = 'exit';
                    }
                }

                if (!found) {
                    for (let g of data.goals) {
                        if (Math.hypot(this.worldX - g.x, this.worldY - g.y) < 25) {
                            found = g; foundType = 'goal';
                            break;
                        }
                    }
                }

                // Check Triggers
                if (!found && data.triggers) {
                    for (let i = data.triggers.length - 1; i >= 0; i--) {
                        const tr = data.triggers[i];
                        if (this.worldX >= tr.x && this.worldX <= tr.x + tr.width &&
                            this.worldY >= tr.y && this.worldY <= tr.y + tr.height) {
                            found = tr; foundType = 'trigger';
                            break;
                        }
                    }
                }

                // Check Traps
                if (!found && data.traps) {
                    for (let i = data.traps.length - 1; i >= 0; i--) {
                        const t = data.traps[i];
                        const sw = t.width * (t.scale || 1);
                        const sh = t.height * (t.scale || 1);
                        if (Math.abs(this.worldX - t.x) <= sw / 2 + 5 &&
                            Math.abs(this.worldY - t.y) <= sh / 2 + 5) {
                            found = t; foundType = 'trap';
                            break;
                        }
                    }
                }

                // Check Platforms
                if (!found) {
                    for (let i = data.platforms.length - 1; i >= 0; i--) {
                        const p = data.platforms[i];
                        if (this.worldX >= p.x && this.worldX <= p.x + p.width &&
                            this.worldY >= p.y && this.worldY <= p.y + p.height) {
                            found = p; foundType = 'platform';
                            break;
                        }
                    }
                }

                // Check Jump Pads
                if (!found && data.jumppads) {
                    for (let i = data.jumppads.length - 1; i >= 0; i--) {
                        const jp = data.jumppads[i];
                        if (this.worldX >= jp.x && this.worldX <= jp.x + jp.width &&
                            this.worldY >= jp.y && this.worldY <= jp.y + jp.height) {
                            found = jp; foundType = 'jumppad';
                            break;
                        }
                    }
                }

                // Check Facilities
                if (!found && data.facilities) {
                    for (let i = data.facilities.length - 1; i >= 0; i--) {
                        const fac = data.facilities[i];
                        if (this.worldX >= fac.x && this.worldX <= fac.x + fac.width &&
                            this.worldY >= fac.y && this.worldY <= fac.y + fac.height) {
                            found = fac; foundType = 'facility';
                            break;
                        }
                    }
                }

                const prevSelected = this.selectedObject;
                const prevType = this.selectedType;
                this.selectedObject = found;
                this.selectedType = foundType;

                if (found) {
                    if (this.isBindingMode && foundType === 'trap' && prevType === 'trigger') {
                        // Add binding
                        const trapIdx = data.traps.indexOf(found);
                        const alreadyBound = prevSelected.bindings.find(b => b.trapIndex === trapIdx);
                        if (!alreadyBound) {
                            prevSelected.bindings.push({ trapIndex: trapIdx, delay: 0 });
                        }
                        // Keep trigger selected
                        this.selectedObject = prevSelected;
                        this.selectedType = prevType;
                        this.refreshTriggerBindingsList();
                        return;
                    }

                    this.isDraggingObject = true;
                    if (foundType === 'platform' || foundType === 'trap' || foundType === 'trigger' || foundType === 'jumppad') {
                        this.dragOffset = { x: this.worldX - found.x, y: this.worldY - found.y };
                    }
                }

            } else if (this.tool === 'platform') {
                this.dragStart = { x: this.worldX, y: this.worldY };
            } else if (this.tool === 'goal') {
                const data = this.game.currentLevelData;
                const cond = data.conditions || { targetCount: 1 };

                // Allow clicking near an existing goal to move it, even if at max
                let nearIdx = -1;
                for (let i = 0; i < data.goals.length; i++) {
                    if (Math.hypot(this.worldX - data.goals[i].x, this.worldY - data.goals[i].y) < 25) {
                        nearIdx = i;
                        break;
                    }
                }

                if (nearIdx !== -1) {
                    data.goals[nearIdx].x = this.worldX;
                    data.goals[nearIdx].y = this.worldY;
                } else {
                    // Place new goal (Unrestricted)
                    data.goals.push({ x: this.worldX, y: this.worldY, collected: false });
                }
            } else if (this.tool === 'exit') {
                if (!this.game.currentLevelData.exit) {
                    this.game.currentLevelData.exit = { x: this.worldX, y: this.worldY, w: 50, h: 50 };
                } else {
                    this.game.currentLevelData.exit.x = this.worldX;
                    this.game.currentLevelData.exit.y = this.worldY;
                    // Ensure exit always has valid dimensions
                    if (!this.game.currentLevelData.exit.w) this.game.currentLevelData.exit.w = 50;
                    if (!this.game.currentLevelData.exit.h) this.game.currentLevelData.exit.h = 50;
                }
            } else if (this.tool === 'spawn') {
                if (!this.game.currentLevelData.spawn) {
                    this.game.currentLevelData.spawn = { x: this.worldX, y: this.worldY };
                    this.game.player.x = this.worldX;
                    this.game.player.y = this.worldY;
                } else {
                    this.game.currentLevelData.spawn.x = this.worldX;
                    this.game.currentLevelData.spawn.y = this.worldY;
                    this.game.player.x = this.worldX;
                    this.game.player.y = this.worldY;
                }
            } else if (this.tool === 'item-hp' || this.tool === 'item-mp') {
                const data = this.game.currentLevelData;
                if (!data.items) data.items = [];
                data.items.push({
                    type: this.tool === 'item-hp' ? 'hp' : 'mp',
                    x: this.worldX,
                    y: this.worldY,
                    collected: false
                });
            } else if (this.tool === 'delete') {
                const data = this.game.currentLevelData;
                let foundAny = false;

                // Priority: Goal > Trap > Platform > (Spawn/Exit as last resort)

                // Try to delete Goal under cursor
                if (!foundAny) {
                    for (let i = data.goals.length - 1; i >= 0; i--) {
                        const g = data.goals[i];
                        if (Math.hypot(this.worldX - g.x, this.worldY - g.y) < 25) {
                            data.goals.splice(i, 1);
                            foundAny = true;
                            break;
                        }
                    }
                }

                if (!foundAny) {
                    // Try to delete Items (HP/MP)
                    if (data.items) {
                        for (let i = data.items.length - 1; i >= 0; i--) {
                            const item = data.items[i];
                            if (Math.hypot(this.worldX - item.x, this.worldY - item.y) < 15) {
                                data.items.splice(i, 1);
                                foundAny = true;
                                break;
                            }
                        }
                    }
                }

                if (!foundAny) {
                    // Try to delete Trigger under cursor
                    if (data.triggers) {
                        for (let i = data.triggers.length - 1; i >= 0; i--) {
                            const tr = data.triggers[i];
                            if (this.worldX >= tr.x && this.worldX <= tr.x + tr.width &&
                                this.worldY >= tr.y && this.worldY <= tr.y + tr.height) {
                                data.triggers.splice(i, 1);
                                foundAny = true;
                                break;
                            }
                        }
                    }
                }

                if (!foundAny) {
                    // Try to delete Trap under cursor
                    for (let i = data.traps.length - 1; i >= 0; i--) {
                        const t = data.traps[i];
                        if (Math.abs(this.worldX - t.x) < t.width / 2 + 10 &&
                            Math.abs(this.worldY - t.y) < t.height / 2 + 10) {
                            data.traps.splice(i, 1);
                            foundAny = true;
                            break;
                        }
                    }
                }

                if (!foundAny) {
                    // Try to delete Platform under cursor
                    for (let i = data.platforms.length - 1; i >= 0; i--) {
                        const p = data.platforms[i];
                        if (this.worldX >= p.x && this.worldX <= p.x + p.width &&
                            this.worldY >= p.y && this.worldY <= p.y + p.height) {
                            data.platforms.splice(i, 1);
                            foundAny = true;
                            break;
                        }
                    }
                }

                if (!foundAny && data.jumppads) {
                    // Try to delete Jump Pad under cursor
                    for (let i = data.jumppads.length - 1; i >= 0; i--) {
                        const jp = data.jumppads[i];
                        if (this.worldX >= jp.x && this.worldX <= jp.x + jp.width &&
                            this.worldY >= jp.y && this.worldY <= jp.y + jp.height) {
                            data.jumppads.splice(i, 1);
                            foundAny = true;
                            break;
                        }
                    }
                }

                if (!foundAny && data.facilities) {
                    // Try to delete Facility under cursor
                    for (let i = data.facilities.length - 1; i >= 0; i--) {
                        const fac = data.facilities[i];
                        if (this.worldX >= fac.x && this.worldX <= fac.x + fac.width &&
                            this.worldY >= fac.y && this.worldY <= fac.y + fac.height) {
                            data.facilities.splice(i, 1);
                            foundAny = true;
                            break;
                        }
                    }
                }

                // If nothing else was deleted, allow resetting Spawn/Exit
                // If nothing else was deleted, allow deleting Spawn/Exit (Nullify)
                if (!foundAny) {
                    // Delete Spawn?
                    if (data.spawn && Math.hypot(this.worldX - data.spawn.x, this.worldY - data.spawn.y) < 20) {
                        data.spawn = null;
                        foundAny = true;
                    }

                    // Delete Exit?
                    if (!foundAny && data.exit) {
                        const ew = data.exit.w || 50;
                        const eh = data.exit.h || 50;
                        if (this.worldX >= data.exit.x && this.worldX <= data.exit.x + ew &&
                            this.worldY >= data.exit.y && this.worldY <= data.exit.y + eh) {
                            data.exit = null;
                            foundAny = true;
                        }
                    }
                }


                // Clear selection
                this.selectedObject = null;
                this.selectedType = null;
            } else if (this.tool === 'trap') {
                if (this.selectedTrapType === 'jumppad') {
                    const newPad = { x: this.worldX - 30, y: this.worldY - 10, width: 60, height: 20, jumpForce: -20 };
                    if (!this.game.currentLevelData.jumppads) this.game.currentLevelData.jumppads = [];
                    this.game.currentLevelData.jumppads.push(newPad);
                    this.selectedObject = newPad;
                    this.selectedType = 'jumppad';
                    this.updatePropertiesUI();
                } else {
                    this.dragStart = { x: this.worldX, y: this.worldY };
                }
            } else if (this.tool === 'trigger') {
                this.dragStart = { x: this.worldX, y: this.worldY };
            } else if (this.tool === 'facility') {
                this.dragStart = { x: this.worldX, y: this.worldY };
            }
        });

        window.addEventListener('mouseup', (e) => {
            if (this.isPanning) {
                this.isPanning = false;
                canvas.style.cursor = keys['Space'] ? 'grab' : 'crosshair';
                return;
            }
            if (!this.active) return;

            this.isDraggingObject = false;

            if (this.tool === 'platform' && this.dragStart) {
                const w = this.worldX - this.dragStart.x;
                const h = this.worldY - this.dragStart.y;
                if (Math.abs(w) > 5 && Math.abs(h) > 5) {
                    const newPlat = {
                        x: w > 0 ? this.dragStart.x : this.worldX,
                        y: h > 0 ? this.dragStart.y : this.worldY,
                        width: Math.abs(w),
                        height: Math.abs(h),
                        color: '#666'
                    };

                    // Overlap Check (Shared Logic)
                    let canPlace = true;
                    const margin = 0;
                    const data = this.game.currentLevelData;

                    // 1. Check against Player
                    const p = this.game.player;
                    if (newPlat.x < p.x + p.width + margin &&
                        newPlat.x + newPlat.width > p.x - margin &&
                        newPlat.y < p.y + p.height + margin &&
                        newPlat.y + newPlat.height > p.y - margin) {
                        canPlace = false;
                    }

                    // 2. Check against Existing Platforms
                    if (canPlace) {
                        for (let other of data.platforms) {
                            if (newPlat.x < other.x + other.width + margin &&
                                newPlat.x + newPlat.width > other.x - margin &&
                                newPlat.y < other.y + other.height + margin &&
                                newPlat.y + newPlat.height > other.y - margin) {
                                canPlace = false;
                                break;
                            }
                        }
                    }

                    // 3. Check against Goals
                    if (canPlace) {
                        for (let g of data.goals) {
                            const gRect = { x: g.x - 25, y: g.y - 25, w: 50, h: 50 };
                            if (newPlat.x < gRect.x + gRect.w &&
                                newPlat.x + newPlat.width > gRect.x &&
                                newPlat.y < gRect.y + gRect.h &&
                                newPlat.y + newPlat.height > gRect.y) {
                                canPlace = false;
                                break;
                            }
                        }
                    }

                    // 4. Check against Exit
                    if (canPlace && data.exit) {
                        const ex = data.exit;
                        if (newPlat.x < ex.x + ex.w + margin &&
                            newPlat.x + newPlat.width > ex.x - margin &&
                            newPlat.y < ex.y + ex.h + margin &&
                            newPlat.y + newPlat.height > ex.y - margin) {
                            canPlace = false;
                        }
                    }

                    // 5. Check against Spawn
                    if (canPlace && data.spawn) {
                        const s = data.spawn;
                        // Spawn is point, assume player size 30x30 centered ish? 
                        // Player spawns at s.x, s.y. Player size is 30x30.
                        if (newPlat.x < s.x + 30 + margin &&
                            newPlat.x + newPlat.width > s.x - margin &&
                            newPlat.y < s.y + 30 + margin &&
                            newPlat.y + newPlat.height > s.y - margin) {
                            canPlace = false;
                        }
                    }

                    if (canPlace) {
                        data.platforms.push(newPlat);
                    } else {
                        alert("无法放置：位置重叠！");
                    }
                }
                this.dragStart = null;
            } else if (this.tool === 'trap' && this.dragStart) {
                const w = Math.abs(this.worldX - this.dragStart.x);
                const h = Math.abs(this.worldY - this.dragStart.y);
                const centerX = (this.worldX + this.dragStart.x) / 2;
                const centerY = (this.worldY + this.dragStart.y) / 2;

                if (w > 10 || h > 10) {
                    let tW = Math.max(w, 20);
                    let tH = Math.max(h, 20);
                    let tRot = 0;

                    // Automatically orient the trap based on the drag direction
                    if (h > w) {
                        tW = Math.max(h, 20);
                        tH = Math.max(w, 20);
                        tRot = 90; // Rotate to act as a wall trap
                    }

                    const newTrap = {
                        type: this.selectedTrapType || 'spikes',
                        x: centerX,
                        y: centerY,
                        width: tW,
                        height: tH,
                        rotation: tRot,
                        scale: 1,
                        damage: 20
                    };
                    this.game.currentLevelData.traps.push(newTrap);
                    this.selectedObject = newTrap;
                    this.selectedType = 'trap';
                    this.updatePropertiesUI();
                }
                this.dragStart = null;
            } else if (this.tool === 'trigger' && this.dragStart) {
                const w = this.worldX - this.dragStart.x;
                const h = this.worldY - this.dragStart.y;
                if (Math.abs(w) > 5 && Math.abs(h) > 5) {
                    const newTrigger = {
                        x: w > 0 ? this.dragStart.x : this.worldX,
                        y: h > 0 ? this.dragStart.y : this.worldY,
                        width: Math.abs(w),
                        height: Math.abs(h),
                        bindings: [],
                        oneShot: true,
                        triggered: false
                    };
                    this.game.currentLevelData.triggers.push(newTrigger);
                    this.selectedObject = newTrigger;
                    this.selectedType = 'trigger';
                    this.updatePropertiesUI();
                }
                this.dragStart = null;
            } else if (this.tool === 'facility' && this.dragStart) {
                const w = Math.abs(this.worldX - this.dragStart.x);
                const h = Math.abs(this.worldY - this.dragStart.y);
                const centerX = (this.worldX + this.dragStart.x) / 2;
                const centerY = (this.worldY + this.dragStart.y) / 2;

                let fW = Math.max(w, 40);
                let fH = Math.max(h, 40);

                const newFac = {
                    type: this.selectedFacilityType || 'heal',
                    x: centerX - fW / 2,
                    y: centerY - fH / 2,
                    width: fW,
                    height: fH,
                    cost: 10,
                    amount: 1
                };
                if (!this.game.currentLevelData.facilities) {
                    this.game.currentLevelData.facilities = [];
                }
                this.game.currentLevelData.facilities.push(newFac);
                this.selectedObject = newFac;
                this.selectedType = 'facility';
                this.updatePropertiesUI();

                this.dragStart = null;
            }

            // Selection Update for property panel
            this.updatePropertiesUI();
        });

        canvas.addEventListener('contextmenu', e => e.preventDefault());
    }

    draw(ctx) {
        if (!this.active) return;

        ctx.save();
        ctx.translate(-this.cameraX, -this.cameraY);

        const data = this.game.currentLevelData;
        const s = data.settings;

        // Draw World Bounds (visible boundary)
        ctx.strokeStyle = '#00cccc';
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 6]);
        ctx.strokeRect(0, 0, s.worldWidth, s.worldHeight);
        ctx.setLineDash([]);

        // Draw Fall Damage Zone (start from worldHeight)
        ctx.fillStyle = 'rgba(255, 0, 0, 0.15)';
        ctx.fillRect(0, s.worldHeight, s.worldWidth, 150); // Visualizing 150px deep to cover the +100 threshold comfortably
        ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
        ctx.font = '12px Arial';
        ctx.fillText("FALL DAMAGE ZONE (+100px)", 10, s.worldHeight + 20);

        if (this.snap) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            const startX = Math.floor(this.cameraX / defaultSettings.gridSize) * defaultSettings.gridSize;
            const startY = Math.floor(this.cameraY / defaultSettings.gridSize) * defaultSettings.gridSize;
            const endX = startX + canvas.width + defaultSettings.gridSize;
            const endY = startY + canvas.height + defaultSettings.gridSize;

            for (let x = startX; x < endX; x += defaultSettings.gridSize) {
                ctx.moveTo(x, startY); ctx.lineTo(x, endY);
            }
            for (let y = startY; y < endY; y += defaultSettings.gridSize) {
                ctx.moveTo(startX, y); ctx.lineTo(endX, y);
            }
            ctx.stroke();
        }

        // Draw Spawn
        if (data.spawn) {
            const spawn = data.spawn;
            ctx.strokeStyle = '#00ffff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(spawn.x - 15, spawn.y); ctx.lineTo(spawn.x + 15, spawn.y);
            ctx.moveTo(spawn.x, spawn.y - 15); ctx.lineTo(spawn.x, spawn.y + 15);
            ctx.stroke();
            ctx.fillStyle = '#fff';
            ctx.font = '10px Arial';
            ctx.fillText("SPAWN", spawn.x + 5, spawn.y - 5);
        }

        // Draw Goals
        ctx.fillStyle = '#FFD700';
        for (let g of data.goals) {
            ctx.beginPath();
            ctx.moveTo(g.x, g.y - 15);
            ctx.lineTo(g.x - 15, g.y + 15);
            ctx.lineTo(g.x + 15, g.y + 15);
            ctx.closePath();
            ctx.fill();

            if (this.selectedObject === g) {
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        }

        // Draw Items (HP/MP)
        if (data.items) {
            // console.log("Drawing items, count:", data.items.length);
            for (let item of data.items) {
                ctx.beginPath();
                ctx.arc(item.x, item.y, 10, 0, Math.PI * 2);
                ctx.fillStyle = item.type === 'hp' ? '#ff4a4a' : '#4a9eff';
                ctx.fill();
                if (this.selectedObject === item) {
                    ctx.strokeStyle = '#fff';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
            }
        }

        // Draw Exit
        if (data.exit) {
            const exit = data.exit;
            const exitW = exit.w || 50;
            const exitH = exit.h || 50;
            ctx.strokeStyle = '#00ff00';
            ctx.lineWidth = 2;
            ctx.strokeRect(exit.x, exit.y, exitW, exitH);
            ctx.fillStyle = 'rgba(0, 255, 0, 0.2)';
            ctx.fillRect(exit.x, exit.y, exitW, exitH);
            ctx.fillStyle = '#fff';
            ctx.fillText("EXIT", exit.x + 5, exit.y + 15);
        }

        // Draw Movements (Targets)
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        if (data.platforms) {
            for (let p of data.platforms) {
                let sx = p.x + p.width / 2;
                let sy = p.y + p.height / 2;
                if (p.speed > 0 || this.selectedObject === p) {
                    let ex = sx + (p.tx || 0);
                    let ey = sy + (p.ty || 0);

                    // Draw Phantom Platform
                    ctx.fillStyle = 'rgba(100, 100, 100, 0.4)';
                    ctx.fillRect(p.x + (p.tx || 0), p.y + (p.ty || 0), p.width, p.height);
                    ctx.strokeStyle = 'rgba(0, 255, 0, 0.4)';
                    ctx.strokeRect(p.x + (p.tx || 0), p.y + (p.ty || 0), p.width, p.height);

                    // Trajectory Line (only draw if not perfectly overlapping)
                    if (p.tx || p.ty) {
                        ctx.strokeStyle = 'rgba(0, 255, 0, 0.5)';
                        ctx.beginPath();
                        ctx.moveTo(sx, sy);
                        ctx.lineTo(ex, ey);
                        ctx.stroke();
                        ctx.fillStyle = 'rgba(0, 255, 0, 0.5)';
                        ctx.beginPath();
                        ctx.arc(ex, ey, 4, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
                if (p.oscSpeed > 0 || this.selectedObject === p) {
                    ctx.strokeStyle = 'rgba(0, 255, 255, 0.5)';
                    ctx.beginPath();
                    ctx.ellipse(sx, sy, Math.abs(p.oscX || 0) || 1, Math.abs(p.oscY || 0) || 1, 0, 0, Math.PI * 2);
                    ctx.stroke();
                }
            }
        }
        // Draw Facilities
        if (data.facilities) {
            for (let fac of data.facilities) {
                // Different color based on type
                if (fac.type === 'heal') ctx.fillStyle = 'rgba(74, 239, 255, 0.4)';
                else if (fac.type === 'player_upgrade') ctx.fillStyle = 'rgba(255, 170, 0, 0.4)';
                else if (fac.type === 'card_upgrade') ctx.fillStyle = 'rgba(214, 102, 255, 0.4)';
                else ctx.fillStyle = 'rgba(200, 200, 200, 0.4)';

                ctx.fillRect(fac.x, fac.y, fac.width, fac.height);
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#fff';
                ctx.strokeRect(fac.x, fac.y, fac.width, fac.height);

                // Add text label
                ctx.fillStyle = '#fff';
                ctx.font = '12px Arial';
                let label = "FACILITY";
                if (fac.type === 'heal') label = `❤️(${fac.cost || 10}点)`;
                if (fac.type === 'player_upgrade') label = `⚔️(${fac.cost || 10}点)`;
                if (fac.type === 'card_upgrade') label = `🃏(${fac.cost || 10}点)`;
                ctx.fillText(label, fac.x + 5, fac.y + 20);

                if (this.selectedObject === fac) {
                    ctx.setLineDash([5, 5]);
                    ctx.strokeStyle = '#fff';
                    ctx.strokeRect(fac.x - 2, fac.y - 2, fac.width + 4, fac.height + 4);
                    ctx.setLineDash([]);
                }
            }
        }

        if (data.traps) {
            for (let t of data.traps) {
                let sx = t.x;
                let sy = t.y;
                if (t.speed > 0 || this.selectedObject === t) {
                    let ex = sx + (t.tx || 0);
                    let ey = sy + (t.ty || 0);

                    // Draw Phantom Trap
                    ctx.save();
                    ctx.translate(ex, ey);
                    if (t.rotation) ctx.rotate(t.rotation * Math.PI / 180);
                    let scale = t.scale || 1;
                    ctx.scale(scale, scale);
                    ctx.fillStyle = 'rgba(255, 74, 74, 0.3)';
                    ctx.fillRect(-t.width / 2, -t.height / 2, t.width, t.height);
                    ctx.strokeStyle = 'rgba(255, 74, 74, 0.5)';
                    ctx.strokeRect(-t.width / 2, -t.height / 2, t.width, t.height);
                    ctx.restore();

                    // Trajectory Line
                    if (t.tx || t.ty) {
                        ctx.strokeStyle = 'rgba(255, 74, 74, 0.5)';
                        ctx.beginPath();
                        ctx.moveTo(sx, sy);
                        ctx.lineTo(ex, ey);
                        ctx.stroke();
                        ctx.fillStyle = 'rgba(255, 74, 74, 0.5)';
                        ctx.beginPath();
                        ctx.arc(ex, ey, 4, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
                if (t.oscSpeed > 0 || this.selectedObject === t) {
                    ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)';
                    ctx.beginPath();
                    ctx.ellipse(sx, sy, Math.abs(t.oscX || 0) || 1, Math.abs(t.oscY || 0) || 1, 0, 0, Math.PI * 2);
                    ctx.stroke();
                }
            }
        }

        if (data.jumppads) {
            const timeSession = Date.now() / 1000;
            for (let jp of data.jumppads) {
                // Base
                ctx.fillStyle = '#111';
                ctx.fillRect(jp.x, jp.y, jp.width, jp.height);

                // Outline
                ctx.strokeStyle = '#00ffaa';
                ctx.lineWidth = 2;
                ctx.strokeRect(jp.x, jp.y, jp.width, jp.height);

                // Animated upward arrows
                ctx.save();
                ctx.beginPath();
                ctx.rect(jp.x, jp.y, jp.width, jp.height);
                ctx.clip(); // clip arrows inside the pad

                ctx.strokeStyle = 'rgba(0, 255, 170, 0.6)';
                ctx.lineWidth = 2;
                const arrowSpacing = 15;
                const numArrows = Math.ceil(jp.width / arrowSpacing);
                const offset = (timeSession * 40) % 20; // moving up

                for (let i = 0; i < numArrows; i++) {
                    const ax = jp.x + 10 + i * arrowSpacing;
                    if (ax > jp.x + jp.width - 5) break;

                    // Draw two rows of arrows
                    for (let row = 0; row < 3; row++) {
                        const ay = jp.y + jp.height + offset - row * 10;
                        if (ay > jp.y && ay < jp.y + jp.height) {
                            ctx.beginPath();
                            ctx.moveTo(ax - 4, ay + 4);
                            ctx.lineTo(ax, ay);
                            ctx.lineTo(ax + 4, ay + 4);
                            ctx.stroke();
                        }
                    }
                }
                ctx.restore();
            }
        }

        ctx.setLineDash([]);

        // Tool Previews
        ctx.strokeStyle = '#00f';
        ctx.lineWidth = 2;
        if (this.tool === 'platform' && this.dragStart) {
            const w = this.worldX - this.dragStart.x;
            const h = this.worldY - this.dragStart.y;
            ctx.fillStyle = 'rgba(100, 100, 100, 0.5)';
            ctx.fillRect(this.dragStart.x, this.dragStart.y, w, h);
        } else if (this.tool === 'trap' && this.dragStart) {
            const w = Math.abs(this.worldX - this.dragStart.x);
            const h = Math.abs(this.worldY - this.dragStart.y);
            const centerX = (this.worldX + this.dragStart.x) / 2;
            const centerY = (this.worldY + this.dragStart.y) / 2;

            ctx.save();
            ctx.translate(centerX, centerY);
            ctx.strokeStyle = 'rgba(255, 74, 74, 0.5)';
            ctx.setLineDash([5, 5]);
            ctx.strokeRect(-w / 2, -h / 2, w, h);
            ctx.restore();
        } else if (this.tool === 'trigger' && this.dragStart) {
            const w = this.worldX - this.dragStart.x;
            const h = this.worldY - this.dragStart.y;
            ctx.fillStyle = 'rgba(255, 136, 0, 0.3)';
            ctx.fillRect(this.dragStart.x, this.dragStart.y, w, h);
            ctx.strokeStyle = '#ff8800';
            ctx.strokeRect(this.dragStart.x, this.dragStart.y, w, h);
        } else if (this.tool !== 'cursor' && this.tool !== 'delete') {
            ctx.strokeRect(this.worldX - 5, this.worldY - 5, 10, 10);
            ctx.fillStyle = '#fff';
            ctx.font = '12px Arial';
            ctx.fillText(this.tool, this.worldX + 10, this.worldY);
        } else if (this.tool === 'delete') {
            ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
            ctx.fillRect(this.worldX - 5, this.worldY - 5, 10, 10);
        }

        // Highlight Selected (Generic)
        if (this.selectedObject) {
            ctx.setLineDash([5, 5]);
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            if (this.selectedType === 'platform') {
                ctx.strokeRect(this.selectedObject.x, this.selectedObject.y, this.selectedObject.width, this.selectedObject.height);
            } else if (this.selectedType === 'jumppad') {
                ctx.strokeRect(this.selectedObject.x - 2, this.selectedObject.y - 2, this.selectedObject.width + 4, this.selectedObject.height + 4);
            } else if (this.selectedType === 'trap') {
                ctx.save();
                ctx.translate(this.selectedObject.x, this.selectedObject.y);
                ctx.rotate((this.selectedObject.rotation || 0) * Math.PI / 180);
                const sw = this.selectedObject.width * (this.selectedObject.scale || 1);
                const sh = this.selectedObject.height * (this.selectedObject.scale || 1);
                ctx.strokeRect(-sw / 2 - 5, -sh / 2 - 5, sw + 10, sh + 10);
                ctx.restore();
            } else if (this.selectedType === 'spawn') {
                ctx.beginPath();
                ctx.arc(this.selectedObject.x, this.selectedObject.y, 40, 0, Math.PI * 2);
                ctx.stroke();
            } else if (this.selectedType === 'exit') {
                ctx.strokeRect(this.selectedObject.x, this.selectedObject.y, this.selectedObject.w, this.selectedObject.h);
            } else if (this.selectedType === 'goal') {
                ctx.beginPath();
                ctx.arc(this.selectedObject.x, this.selectedObject.y, 35, 0, Math.PI * 2);
                ctx.stroke();
            }
            ctx.setLineDash([]);
        }

        // Draw Trigger Zones and Connections
        if (data.triggers) {
            data.triggers.forEach((tr, trIdx) => {
                const isSelected = this.selectedObject === tr;
                ctx.strokeStyle = isSelected ? '#fff' : '#ff8800';
                ctx.lineWidth = isSelected ? 3 : 2;
                ctx.setLineDash(isSelected ? [] : [5, 5]);
                ctx.strokeRect(tr.x, tr.y, tr.width, tr.height);
                ctx.fillStyle = isSelected ? 'rgba(255, 136, 0, 0.4)' : 'rgba(255, 136, 0, 0.15)';
                ctx.fillRect(tr.x, tr.y, tr.width, tr.height);
                ctx.setLineDash([]);

                // Label
                ctx.fillStyle = '#fff';
                ctx.font = '10px Arial';
                ctx.fillText(`TRIGGER ${trIdx}`, tr.x + 2, tr.y + 12);

                // Connection Lines to Traps
                if (tr.bindings && data.traps) {
                    tr.bindings.forEach(bind => {
                        const trap = data.traps[bind.trapIndex];
                        if (trap) {
                            ctx.beginPath();
                            ctx.strokeStyle = isSelected ? 'rgba(255, 200, 0, 0.8)' : 'rgba(255, 136, 0, 0.4)';
                            ctx.setLineDash([2, 4]);
                            ctx.moveTo(tr.x + tr.width / 2, tr.y + tr.height / 2);
                            ctx.lineTo(trap.x, trap.y);
                            ctx.stroke();
                            ctx.setLineDash([]);

                            if (bind.delay > 0) {
                                ctx.fillStyle = '#ffcc00';
                                ctx.fillText(`${bind.delay}s`, (tr.x + tr.width / 2 + trap.x) / 2, (tr.y + tr.height / 2 + trap.y) / 2);
                            }
                        }
                    });
                }
            });
        }

        ctx.restore();
    }

    updateDatabaseUI() {
        const list = document.getElementById('card-cost-list');
        if (!list) return;

        list.innerHTML = '';
        cardPool.forEach(card => {
            const item = document.createElement('div');
            item.className = 'db-card-item';

            // Fixed rich tooltip with name and description
            item.title = `${card.name} \n${card.description} \n(点击数值进行编辑)`;

            item.innerHTML = `
                <div class="db-card-header">${card.name}</div>
                <div class="db-card-body">
                    <span class="db-card-icon">${card.icon}</span>
                </div>
                <div class="db-card-footer" style="display:flex; flex-direction:column; align-items:center;">
                    <div style="font-size: 10px; color: #aaa; margin-bottom: 2px;">特效数值 / 星币</div>
                    <div style="display:flex; gap: 4px; justify-content:center;">
                        <input type="number" class="db-card-value-input" value="${card.value}" step="any" style="width: 45px; background: #333; border: 1px solid #555; color: #fff; border-radius: 3px; text-align: center;">
                        <input type="number" class="db-card-cost-input" value="${card.cost}" min="0" style="width: 35px;">
                    </div>
                    <span class="db-card-id" style="margin-top: 4px;">${card.id}</span>
                </div>
            `;

            const inputCost = item.querySelector('.db-card-cost-input');
            inputCost.onchange = (e) => {
                const newCost = parseInt(e.target.value);
                if (!isNaN(newCost)) {
                    card.cost = newCost;
                    if (typeof saveCardPoolSettings !== 'undefined') saveCardPoolSettings();
                    inputCost.style.borderColor = '#4a9eff';
                    setTimeout(() => inputCost.style.borderColor = '', 500);
                }
            };

            const inputValue = item.querySelector('.db-card-value-input');
            inputValue.onchange = (e) => {
                const newVal = parseFloat(e.target.value);
                if (!isNaN(newVal)) {
                    card.value = newVal;
                    if (typeof saveCardPoolSettings !== 'undefined') saveCardPoolSettings();
                    item.title = `${card.name} \n${card.description} \n(点击数值进行编辑)`;
                    inputValue.style.borderColor = '#4a9eff';
                    setTimeout(() => inputValue.style.borderColor = '', 500);
                }
            };

            inputCost.onmousedown = (e) => e.stopPropagation();
            inputValue.onmousedown = (e) => e.stopPropagation();

            list.appendChild(item);
        });
    }
}

class BlueprintEditor {
    constructor(game) {
        this.game = game;
        this.canvas = document.getElementById('blueprintCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.active = false;
        this.camX = 0;
        this.camY = 0;
        this.isPanning = false;
        this.panStart = { x: 0, y: 0 };
        this.draggingNode = null;
        this.dragOffset = { x: 0, y: 0 };
        this.nodeWidth = 150;
        this.nodeHeight = 60;
        this.portSize = 12;
        this.isConnecting = false;
        this.connectStartNode = null;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        this.hoveredConnection = null; // {fromIdx, targetIdx}
        this.isolatedNodes = [];

        this.setupInput();
    }

    toggle() {
        this.active = !this.active;
        const overlay = document.getElementById('blueprint-overlay');
        if (this.active) {
            overlay.classList.remove('hidden');
            // Wait for DOM to update so clientWidth/Height are correct
            setTimeout(() => {
                this.resize();
                this.draw();
            }, 10);
        } else {
            overlay.classList.add('hidden');
        }
    }

    resize() {
        const container = document.getElementById('blueprint-canvas-container');
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;
    }

    setupInput() {
        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 1 || e.altKey) {
                this.isPanning = true;
                this.panStart = { x: e.clientX, y: e.clientY, camX: this.camX, camY: this.camY };
                return;
            }

            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left + this.camX;
            const mouseY = e.clientY - rect.top + this.camY;

            // Alt+Click to clear targets
            if (e.altKey) {
                this.game.levelManager.levels.forEach((lvl, idx) => {
                    const pos = lvl.flow.editorPos || { x: 50 + idx * 180, y: 50 };
                    if (mouseX >= pos.x && mouseX <= pos.x + this.nodeWidth &&
                        mouseY >= pos.y && mouseY <= pos.y + this.nodeHeight) {
                        lvl.flow.targets = [];
                        this.game.levelManager.saveToStorage();
                        this.draw();
                    }
                });
                return;
            }

            // Check if clicking on connection port
            this.isConnecting = false;
            this.game.levelManager.levels.forEach((lvl, idx) => {
                const pos = lvl.flow.editorPos || { x: 50 + idx * 180, y: 50 };
                const portX = pos.x + this.nodeWidth;
                const portY = pos.y + this.nodeHeight / 2;
                if (Math.hypot(mouseX - portX, mouseY - portY) < this.portSize) {
                    this.isConnecting = true;
                    this.connectStartNode = lvl;
                }
            });
            if (this.isConnecting) return;

            // Check if clicking on a node for drag
            this.draggingNode = null;
            this.game.levelManager.levels.forEach((lvl, idx) => {
                const pos = lvl.flow.editorPos || { x: 50 + idx * 180, y: 50 };
                if (mouseX >= pos.x && mouseX <= pos.x + this.nodeWidth &&
                    mouseY >= pos.y && mouseY <= pos.y + this.nodeHeight) {
                    this.draggingNode = lvl;
                    this.dragOffset = { x: mouseX - pos.x, y: mouseY - pos.y };
                }
            });
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.active) return;
            const rect = this.canvas.getBoundingClientRect();
            this.lastMouseX = e.clientX - rect.left + this.camX;
            this.lastMouseY = e.clientY - rect.top + this.camY;

            if (this.isPanning) {
                this.camX = this.panStart.camX - (e.clientX - this.panStart.x);
                this.camY = this.panStart.camY - (e.clientY - this.panStart.y);
                this.draw();
            }

            if (this.draggingNode) {
                const rect = this.canvas.getBoundingClientRect();
                const mouseX = e.clientX - rect.left + this.camX;
                const mouseY = e.clientY - rect.top + this.camY;
                if (!this.draggingNode.flow.editorPos) this.draggingNode.flow.editorPos = { x: 0, y: 0 };
                this.draggingNode.flow.editorPos.x = mouseX - this.dragOffset.x;
                this.draggingNode.flow.editorPos.y = mouseY - this.dragOffset.y;
                this.game.levelManager.saveToStorage();
                this.draw();
            }
            if (this.isConnecting) {
                this.draw(); // Redraw to show the connection line
            }
            this.checkHover();
        });

        window.addEventListener('mouseup', (e) => {
            if (this.isConnecting) {
                const rect = this.canvas.getBoundingClientRect();
                const mouseX = e.clientX - rect.left + this.camX;
                const mouseY = e.clientY - rect.top + this.camY;

                this.game.levelManager.levels.forEach((lvl, idx) => {
                    const pos = lvl.flow.editorPos || { x: 50 + idx * 180, y: 50 };
                    if (mouseX >= pos.x && mouseX <= pos.x + this.nodeWidth &&
                        mouseY >= pos.y && mouseY <= pos.y + this.nodeHeight) {
                        if (this.connectStartNode !== lvl) {
                            if (!this.connectStartNode.flow.targets) this.connectStartNode.flow.targets = [];
                            if (!this.connectStartNode.flow.targets.includes(idx)) {
                                this.connectStartNode.flow.targets.push(idx);
                                this.game.levelManager.saveToStorage();
                            }
                        }
                    }
                });
            }
            this.isPanning = false;
            this.draggingNode = null;
            this.isConnecting = false;
            this.draw();
        });

        this.canvas.addEventListener('wheel', (e) => {
            if (!this.active) return;
            this.camY += e.deltaY;
            this.camX += e.deltaX;
            this.draw();
            e.preventDefault();
        }, { passive: false });

        this.canvas.addEventListener('contextmenu', (e) => {
            if (!this.active) return;
            e.preventDefault();
            if (this.hoveredConnection) {
                const { fromIdx, targetIdx } = this.hoveredConnection;
                const lvl = this.game.levelManager.levels[fromIdx];
                if (lvl) {
                    const type = lvl.flow.nextType || 'linear';
                    if (type === 'linear') {
                        // To disconnect a linear, we must switch the node to branch/random
                        lvl.flow.nextType = 'branch';
                        lvl.flow.targets = [];
                    } else if (lvl.flow.targets) {
                        lvl.flow.targets = lvl.flow.targets.filter(t => t !== targetIdx);
                    }
                    this.game.levelManager.saveToStorage();
                    this.draw();
                }
            }
        });

        // Drag and Drop from Dashboard
        this.canvas.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });

        this.canvas.addEventListener('drop', (e) => {
            e.preventDefault();
            const levelIdx = parseInt(e.dataTransfer.getData('text/plain'));
            if (isNaN(levelIdx)) return;

            const rect = this.canvas.getBoundingClientRect();
            const dropX = e.clientX - rect.left + this.camX;
            const dropY = e.clientY - rect.top + this.camY;

            const lvl = this.game.levelManager.levels[levelIdx];
            if (lvl) {
                if (!lvl.flow.editorPos) lvl.flow.editorPos = { x: 0, y: 0 };
                lvl.flow.editorPos.x = dropX - this.nodeWidth / 2;
                lvl.flow.editorPos.y = dropY - this.nodeHeight / 2;
                this.game.levelManager.saveToStorage();
                this.draw();
            }
        });
    }

    draw() {
        if (!this.active) return;
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        ctx.save();
        ctx.translate(-this.camX, -this.camY);

        // Grid
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 1;
        const gridSize = 100;
        const startX = Math.floor(this.camX / gridSize) * gridSize;
        const endX = startX + this.canvas.width + gridSize;
        const startY = Math.floor(this.camY / gridSize) * gridSize;
        const endY = startY + this.canvas.height + gridSize;

        ctx.beginPath();
        for (let x = startX; x < endX; x += gridSize) {
            ctx.moveTo(x, startY); ctx.lineTo(x, endY);
        }
        for (let y = startY; y < endY; y += gridSize) {
            ctx.moveTo(startX, y); ctx.lineTo(endX, y);
        }
        ctx.stroke();

        this.verifyFlow();

        // Draw Connections First
        this.game.levelManager.levels.forEach((lvl, idx) => {
            const pos = lvl.flow.editorPos || { x: 50 + idx * 180, y: 50 };
            const type = lvl.flow.nextType || 'linear';

            if (type === 'linear' && idx < this.game.levelManager.levels.length - 1) {
                const nextPos = this.game.levelManager.levels[idx + 1].flow.editorPos || { x: 50 + (idx + 1) * 180, y: 50 };
                const isHovered = this.hoveredConnection?.fromIdx === idx && this.hoveredConnection?.targetIdx === idx + 1;
                this.drawConnection(pos, nextPos, '#4a9eff', false, isHovered);
            } else if ((type === 'random' || type === 'branch') && lvl.flow.targets) {
                lvl.flow.targets.forEach(targetIdx => {
                    const targetLvl = this.game.levelManager.levels[targetIdx];
                    if (targetLvl) {
                        const targetPos = targetLvl.flow.editorPos || { x: 50 + targetIdx * 180, y: 50 };
                        const isHovered = this.hoveredConnection?.fromIdx === idx && this.hoveredConnection?.targetIdx === targetIdx;
                        this.drawConnection(pos, targetPos, '#a855f7', true, isHovered);
                    }
                });
            }
        });

        // Nodes
        this.game.levelManager.levels.forEach((lvl, idx) => {
            const pos = lvl.flow.editorPos || { x: 50 + idx * 180, y: 50 };
            const isActive = (idx === this.game.levelManager.currentLevelIndex);

            // Shadow
            ctx.shadowBlur = 10;
            ctx.shadowColor = 'rgba(0,0,0,0.5)';

            // Card
            ctx.fillStyle = isActive ? '#2a4a8a' : '#1e1e2e';
            ctx.strokeStyle = isActive ? '#4a9eff' : '#333';
            ctx.lineWidth = 2;

            ctx.beginPath();
            ctx.roundRect(pos.x, pos.y, this.nodeWidth, this.nodeHeight, 8);
            ctx.fill();
            ctx.stroke();

            ctx.shadowBlur = 0;

            // Text
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 14px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(lvl.name, pos.x + this.nodeWidth / 2, pos.y + 25);
            ctx.font = '10px Arial';
            ctx.fillStyle = isActive ? '#4a9eff' : '#888';
            ctx.fillText(lvl.flow.nextType || 'linear', pos.x + this.nodeWidth / 2, pos.y + 45);

            // Warning for isolated nodes
            if (this.isolatedNodes.includes(idx) && idx !== 0) {
                ctx.fillStyle = '#ff4444';
                ctx.font = 'bold 20px Arial';
                ctx.fillText('!', pos.x + 10, pos.y + 25);
            }

            // Start/End Tags
            if (idx === 0) {
                ctx.fillStyle = '#4a9eff';
                ctx.font = '10px Arial';
                ctx.fillText('START', pos.x + 20, pos.y - 10);
            }

            // Output Port
            ctx.fillStyle = '#4a9eff';
            ctx.beginPath();
            ctx.arc(pos.x + this.nodeWidth, pos.y + this.nodeHeight / 2, this.portSize / 2, 0, Math.PI * 2);
            ctx.fill();
        });

        // Drawing pending connection
        if (this.isConnecting && this.connectStartNode) {
            const rect = this.canvas.getBoundingClientRect();
            // We need a mouse tracking variable for this, or use the last mouse move event
            // For now, I'll rely on global mouse move to trigger re-draw
            const mouseX = this.lastMouseX; // Will add this
            const mouseY = this.lastMouseY;
            this.drawConnection(this.connectStartNode.flow.editorPos, { x: mouseX - this.camX, y: mouseY - this.camY }, '#fff', true);
        }

        ctx.restore();
    }

    drawConnection(from, to, color, dashed = false, isHovered = false) {
        const ctx = this.ctx;
        ctx.strokeStyle = isHovered ? '#fff' : color;
        ctx.lineWidth = isHovered ? 5 : 3;
        if (dashed) ctx.setLineDash([5, 5]);
        else ctx.setLineDash([]);

        const startX = from.x + this.nodeWidth;
        const startY = from.y + this.nodeHeight / 2;
        const endX = to.x;
        const endY = to.y + this.nodeHeight / 2;

        const cp1x = startX + (endX - startX) / 2;
        const cp1y = startY;
        const cp2x = startX + (endX - startX) / 2;
        const cp2y = endY;

        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Arrow head
        ctx.fillStyle = isHovered ? '#fff' : color;
        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX - 10, endY - 5);
        ctx.lineTo(endX - 10, endY + 5);
        ctx.fill();
    }

    checkHover() {
        const mx = this.lastMouseX;
        const my = this.lastMouseY;
        let found = null;

        this.game.levelManager.levels.forEach((lvl, idx) => {
            const pos = lvl.flow.editorPos || { x: 50 + idx * 180, y: 50 };
            const type = lvl.flow.nextType || 'linear';

            if (type === 'linear' && idx < this.game.levelManager.levels.length - 1) {
                const nextPos = this.game.levelManager.levels[idx + 1].flow.editorPos || { x: 50 + (idx + 1) * 180, y: 50 };
                if (this.isNearBezier(mx, my, pos, nextPos)) found = { fromIdx: idx, targetIdx: idx + 1 };
            } else if (lvl.flow.targets) {
                lvl.flow.targets.forEach(tIdx => {
                    const tLvl = this.game.levelManager.levels[tIdx];
                    if (tLvl) {
                        const tPos = tLvl.flow.editorPos || { x: 50 + tIdx * 180, y: 50 };
                        if (this.isNearBezier(mx, my, pos, tPos)) found = { fromIdx: idx, targetIdx: tIdx };
                    }
                });
            }
        });

        if (JSON.stringify(this.hoveredConnection) !== JSON.stringify(found)) {
            this.hoveredConnection = found;
            this.draw();
        }
    }

    isNearBezier(mx, my, from, to) {
        const startX = from.x + this.nodeWidth;
        const startY = from.y + this.nodeHeight / 2;
        const endX = to.x;
        const endY = to.y + this.nodeHeight / 2;

        // Simple check: is point within bounding box of curve (plus padding)
        const pad = 20;
        if (mx < Math.min(startX, endX) - pad || mx > Math.max(startX, endX) + pad ||
            my < Math.min(startY, endY) - pad || my > Math.max(startY, endY) + pad) return false;

        // Sampling check for closer match
        const steps = 20;
        const cp1x = startX + (endX - startX) / 2;
        const cp2x = cp1x;

        for (let t = 0; t <= 1; t += 1 / steps) {
            const invT = 1 - t;
            const x = Math.pow(invT, 3) * startX + 3 * Math.pow(invT, 2) * t * cp1x + 3 * invT * Math.pow(t, 2) * cp2x + Math.pow(t, 3) * endX;
            const y = Math.pow(invT, 3) * startY + 3 * Math.pow(invT, 2) * t * startY + 3 * invT * Math.pow(t, 2) * endY + Math.pow(t, 3) * endY;
            if (Math.hypot(mx - x, my - y) < 15) return true;
        }
        return false;
    }

    verifyFlow() {
        // Simple reachability check from level 0
        const reachable = new Set([0]);
        const queue = [0];
        while (queue.length > 0) {
            const curr = queue.shift();
            const lvl = this.game.levelManager.levels[curr];
            const flow = lvl.flow;
            let neighbors = [];
            if (flow.nextType === 'linear' && curr < this.game.levelManager.levels.length - 1) neighbors.push(curr + 1);
            else if (flow.targets) neighbors = neighbors.concat(flow.targets);

            neighbors.forEach(n => {
                if (!reachable.has(n)) {
                    reachable.add(n);
                    queue.push(n);
                }
            });
        }
        this.isolatedNodes = this.game.levelManager.levels.map((_, i) => i).filter(i => !reachable.has(i));
    }
}


class Game {
    constructor() {
        this.state = 'play';
        this.isTesting = false;
        this.player = new Player();
        this.levelManager = new LevelManager(this);
        this.runManager = new RunManager(this);
        this.blueprintEditor = null;
        this.particles = [];

        if (window.IS_STANDALONE && window.STANDALONE_DATA) {
            this.levelManager.levels = window.STANDALONE_DATA;
            this.state = 'play';
            if (window.ENABLE_EDITOR) {
                this.editor = new Editor(this);
                this.editor.active = false;
                const editBtn = document.getElementById('btn-edit-mode');
                if (editBtn) editBtn.classList.remove('hidden');
            } else {
                this.editor = null;
                const editBtn = document.getElementById('btn-edit-mode');
                if (editBtn) editBtn.classList.add('hidden');
            }
            this.blueprintEditor = null;
            const instrEl = document.getElementById('instructions');
            if (instrEl) instrEl.classList.add('hidden');
            const gameStatsEl = document.getElementById('game-stats');
            if (gameStatsEl) gameStatsEl.classList.remove('hidden');
        } else {
            this.editor = new Editor(this);
            this.blueprintEditor = new BlueprintEditor(this);
            // Determine initial state based on UI
            this.state = editorUI.classList.contains('hidden') ? 'play' : 'edit';
            this.editor.active = (this.state === 'edit');
        }
        this.camera = new Camera();
        this.originalLevelData = null; // Store state before test

        this.isTesting = false;
        this.playTimer = 0;
        this.collectedGoals = 0;
        this.lastTimestamp = 0;

        this.currentLevelData = {
            settings: { ...defaultSettings },
            goals: [{ x: 0, y: 0 }], // Default to an array
            platforms: [],
            exit: { x: 0, y: 0, w: 0, h: 0 },
            spawn: { x: 0, y: 0 }
        };

        if (this.levelManager.levels.length > 0) {
            this.loadLevel(this.levelManager.getCurrentLevel());
        }

        this.loop = this.loop.bind(this);
        requestAnimationFrame((t) => {
            this.lastTimestamp = t;

            // HUD Update
            if (this.state === 'play' && this.player) {
                const hpPercent = (this.player.hp / this.player.maxHp) * 100;
                const mpPercent = (this.player.mp / this.player.maxMp) * 100;

                const hpFill = document.getElementById('hp-bar-fill');
                const mpFill = document.getElementById('mp-bar-fill');
                const hpText = document.getElementById('hp-text');
                const mpText = document.getElementById('mp-text');

                if (hpFill) hpFill.style.width = hpPercent + '%';
                if (mpFill) mpFill.style.width = mpPercent + '%';
                if (hpText) hpText.textContent = Math.ceil(this.player.hp) + '/' + this.player.maxHp;
                if (mpText) mpText.textContent = Math.ceil(this.player.mp) + '/' + this.player.maxMp;
            }

            requestAnimationFrame(this.loop);
        });
    }

    gameOver() {
        alert("游戏结束！挑战失败，将重新开始旅程。");
        this.runManager.endRun();
        this.levelManager.loadLevel(0); // Restart from Level 1
    }

    loadLevel(levelData) {
        this.currentLevelData = JSON.parse(JSON.stringify(levelData));

        // Settings sanitization
        if (!this.currentLevelData.settings) {
            this.currentLevelData.settings = JSON.parse(JSON.stringify(defaultSettings));
        }

        // Sanitize existing settings
        const s = this.currentLevelData.settings;
        if (!s.worldWidth || isNaN(s.worldWidth)) s.worldWidth = defaultSettings.worldWidth;
        if (!s.worldHeight || isNaN(s.worldHeight)) s.worldHeight = defaultSettings.worldHeight;

        // Ensure Roguelike defaults exist
        if (s.playerMaxHp === undefined) s.playerMaxHp = 100;
        if (s.playerMaxMp === undefined) s.playerMaxMp = 100;
        if (s.platformCost === undefined) s.platformCost = 10;
        if (s.fallDamage === undefined) s.fallDamage = 20;
        if (s.mpRegen === undefined) s.mpRegen = 0.1;

        // Data Migration: Single goal to goals array
        if (this.currentLevelData.goal && !this.currentLevelData.goals) {
            this.currentLevelData.goals = [this.currentLevelData.goal];
            delete this.currentLevelData.goal;
        }
        if (!this.currentLevelData.goals) this.currentLevelData.goals = [];

        // Ensure traps and enemies exist
        if (!this.currentLevelData.traps) this.currentLevelData.traps = [];
        if (!this.currentLevelData.enemies) this.currentLevelData.enemies = [];
        if (!this.currentLevelData.triggers) this.currentLevelData.triggers = [];
        if (!this.currentLevelData.jumppads) this.currentLevelData.jumppads = [];

        // Clear selection state in editor
        if (this.editor) {
            this.editor.selectedObject = null;
            this.editor.selectedType = null;
            this.editor.updatePropertiesUI();
        }

        // Reset and Initialize Dormancy for Triggers
        this.currentLevelData.traps.forEach(trap => trap.dormant = false);
        this.currentLevelData.triggers.forEach(tr => {
            tr.triggered = false;
            if (tr.bindings) {
                tr.bindings.forEach(bind => {
                    const trap = this.currentLevelData.traps[bind.trapIndex];
                    if (trap) {
                        trap.dormant = true;
                    }
                });
            }
        });

        if (!this.currentLevelData.goals || this.currentLevelData.goals.length === 0) {
            this.currentLevelData.goals = [{ x: window.innerWidth * 0.8, y: window.innerHeight * 0.8 }];
        }

        // Initialize Player Stats for this level
        if (this.player && this.player.updateStats) {
            this.player.updateStats(this.currentLevelData.settings);
        }

        // Auto-start run on Level 1 (if not in editor)
        if (this.state !== 'edit' && this.levelManager.currentLevelIndex === 0 && !this.runManager.runActive) {
            this.runManager.startRun();
        }

        // Apply Run State (Overwrite default stats with persisted ones)
        if (this.state !== 'edit' && this.runManager.runActive) {
            this.runManager.applyState(this.player);
        }

        if (!this.currentLevelData.conditions) {
            this.currentLevelData.conditions = { timeLimit: 0, targetCount: 1 };
        }
        if (!this.currentLevelData.flow) {
            this.currentLevelData.flow = { nextType: 'linear', targets: [] };
        }

        // Setup stats visibility immediately
        const timerEl = document.getElementById('timer-display');
        const cond = this.currentLevelData.conditions || { targetCount: 1, timeLimit: 0 };
        if (cond.timeLimit > 0) {
            timerEl.classList.remove('hidden');
        } else {
            timerEl.classList.add('hidden');
        }
        document.getElementById('goal-display').textContent = '目标: 0 / ' + cond.targetCount;

        if (this.currentLevelData.spawn) {
            this.player.x = this.currentLevelData.spawn.x;
            this.player.y = this.currentLevelData.spawn.y;
        } else {
            this.player.x = 100;
            this.player.y = 100;
        }
        this.player.vx = 0;
        this.player.vy = 0;

        // Reset goals collection status
        this.currentLevelData.goals.forEach(g => g.collected = false);
        if (this.currentLevelData.exit) this.currentLevelData.exit.active = false;

        // Reset stats for new level
        this.playTimer = 0;
        this.collectedGoals = 0;

        // Synchronize Settings UI
        if (this.editor) this.editor.updateSettingsUI(this.currentLevelData);

        // Respect current context (Editor or Play)
        if (this.isTesting) {
            this.state = 'play';
        } else if (this.editor && this.editor.active) {
            this.state = 'edit';
        } else {
            this.state = 'play';
        }

        winScreen.classList.add('hidden');
    }

    restartLevel() {
        if (this.isTesting && this.originalLevelData) {
            // Reload using the editor state we backed up
            this.currentLevelData = JSON.parse(JSON.stringify(this.originalLevelData));
        } else {
            this.loadLevel(this.levelManager.getCurrentLevel());
        }

        // Reset player state (Full Reset including HP/MP)
        this.player.reset();

        // Re-apply current level settings to stats
        if (this.currentLevelData && this.currentLevelData.settings) {
            this.player.updateStats(this.currentLevelData.settings);
        }

        if (this.currentLevelData.spawn) {
            this.player.x = this.currentLevelData.spawn.x;
            this.player.y = this.currentLevelData.spawn.y;
        } else {
            this.player.x = 100;
            this.player.y = 100;
        }
        this.player.vx = 0;
        this.player.vy = 0;
        this.currentLevelData.goals.forEach(g => g.collected = false);
        if (this.currentLevelData.exit) this.currentLevelData.exit.active = false;
        this.state = 'play';
        winScreen.classList.add('hidden');

        // Stats reset
        this.playTimer = 0;
        this.collectedGoals = 0;
        this.particles = [];
    }

    startPlayTest() {
        // Apply settings from UI FIRST so conditions like timeLimit are captured
        if (this.editor) this.editor.applySettingsFromUI();

        // Save state
        this.originalLevelData = JSON.parse(JSON.stringify(this.currentLevelData));

        this.state = 'play';
        this.isTesting = true;
        this.editor.active = false; // Disable editor overlay during test
        this.lastTimestamp = performance.now(); // Reset timer reference
        this.playTimer = 0;
        this.collectedGoals = 0;

        // Start the roguelike run so shop triggers on exit
        if (this.runManager) {
            this.runManager.runActive = true;
            this.runManager.currentStats.currency = 10; // Give some money for testing
        }

        // Ensure UI reflects current conditions
        const cond = this.currentLevelData.conditions || { targetCount: 1, timeLimit: 0 };
        document.getElementById('goal-display').textContent = '目标: 0 / ' + cond.targetCount;

        // Setup stats visibility immediately
        const timerEl = document.getElementById('timer-display');
        if (cond.timeLimit > 0) {
            timerEl.classList.remove('hidden');
        } else {
            timerEl.classList.add('hidden');
        }

        // UI Transition
        editorUI.classList.add('hidden');
        playUI.classList.remove('hidden'); // Need this for win screen, etc.
        document.getElementById('player-stats').classList.remove('hidden');
        // But hide edit button and instructions if desired?
        // Let's hide instructions and edit button for pure test feel?
        // User asked for "Generate a test interface window like Unity" or "New web page".
        // Let's JUST show the game + a stop button.
        document.getElementById('instructions').classList.add('hidden');
        document.getElementById('btn-edit-mode').classList.add('hidden');
        document.getElementById('btn-stop-test').classList.remove('hidden');
        document.getElementById('level-settings-panel').classList.add('hidden');

        // Reset player
        if (this.currentLevelData.spawn) {
            this.player.x = this.currentLevelData.spawn.x;
            this.player.y = this.currentLevelData.spawn.y;
        }
        this.player.vx = 0;
        this.player.vy = 0;
        this.currentLevelData.goals.forEach(g => g.collected = false);
        if (this.currentLevelData.exit) this.currentLevelData.exit.active = false;

        // Immediate Camera Focus
        this.camera.follow(this.player);
        this.camera.clamp(this.currentLevelData.settings.worldWidth, this.currentLevelData.settings.worldHeight);

        // Stats reset
        this.playTimer = 0;
        this.collectedGoals = 0;
        this.particles = [];
        document.getElementById('game-stats').classList.remove('hidden');

        this.currentLevelData.traps.forEach(t => {
            // Check if this trap is bound to any trigger
            const bound = this.currentLevelData.triggers.some(tr =>
                tr.bindings && tr.bindings.some(b => b.trapIndex === this.currentLevelData.traps.indexOf(t))
            );
            // If bound, it starts as dormant
            t.dormant = bound;
        });

        // Reset trigger states
        this.currentLevelData.triggers.forEach(tr => tr.triggered = false);

        // Apply modifiers (including wall climb) to the player
        if (this.runManager) this.runManager.applyState(this.player);

        // Ensure focus
        canvas.focus();
    }

    stopPlayTest() {
        this.state = 'edit';
        this.isTesting = false;
        this.editor.active = true; // Re-enable editor overlay

        if (this.editor) {
            this.editor.selectedObject = null;
            this.editor.selectedType = null;
            this.editor.updatePropertiesUI();
        }

        // Restore UI
        editorUI.classList.remove('hidden');
        playUI.classList.add('hidden');
        document.getElementById('player-stats').classList.add('hidden');
        document.getElementById('instructions').classList.remove('hidden');
        document.getElementById('btn-edit-mode').classList.remove('hidden');
        document.getElementById('btn-stop-test').classList.add('hidden');
        document.getElementById('game-stats').classList.add('hidden');

        // Restore Level Data (undoing gameplay changes like collected goal)
        if (this.originalLevelData) {
            this.currentLevelData = JSON.parse(JSON.stringify(this.originalLevelData));
        }
    }

    win() {
        this.state = 'won';
        winScreen.classList.remove('hidden');
        if (this.runManager && this.runManager.runActive) {
            this.runManager.endRun();
        }
    }

    getLaserBounds(trap, platforms) {
        let startX, startY, endX, endY;
        const rotation = (trap.rotation || 0) % 360;

        // Trap's "width" is ALWAYS the length of the laser, "height" is thickness.
        // Emitter base is determined by rotation.
        if (rotation === 90) { // Pointing DOWN
            startX = trap.x; endX = trap.x;
            startY = trap.y - trap.width / 2;
            endY = trap.y + trap.width / 2;
        } else if (rotation === 270) { // Pointing UP
            startX = trap.x; endX = trap.x;
            startY = trap.y + trap.width / 2;
            endY = trap.y - trap.width / 2;
        } else if (rotation === 180) { // Pointing LEFT
            startY = trap.y; endY = trap.y;
            startX = trap.x + trap.width / 2;
            endX = trap.x - trap.width / 2;
        } else { // Pointing RIGHT (0 or default)
            startY = trap.y; endY = trap.y;
            startX = trap.x - trap.width / 2;
            endX = trap.x + trap.width / 2;
        }

        if (rotation === 0 || rotation === 180) { // Horizontal
            for (let p of platforms) {
                // Must vertically intersect the platform
                if (startY >= p.y && startY <= p.y + p.height) {
                    if (rotation === 0) { // Shooting right
                        // Blocked by left face of a platform in the path
                        if (p.x >= startX && p.x < endX) {
                            endX = p.x;
                        }
                    } else { // Shooting left
                        // Blocked by right face
                        if (p.x + p.width <= startX && p.x + p.width > endX) {
                            endX = p.x + p.width;
                        }
                    }
                }
            }
        } else { // Vertical
            for (let p of platforms) {
                // Must horizontally intersect the platform
                if (startX >= p.x && startX <= p.x + p.width) {
                    if (rotation === 90) { // Shooting down
                        // Blocked by top face
                        if (p.y >= startY && p.y < endY) {
                            endY = p.y;
                        }
                    } else { // Shooting up
                        // Blocked by bottom face
                        if (p.y + p.height <= startY && p.y + p.height > endY) {
                            endY = p.y + p.height;
                        }
                    }
                }
            }
        }

        return {
            minX: Math.min(startX, endX),
            maxX: Math.max(startX, endX),
            minY: Math.min(startY, endY),
            maxY: Math.max(startY, endY),
            startX, startY, endX, endY
        };
    }

    spawnParticles(x, y, color, count, speed = 10, size = 5, life = 0.5) {
        for (let i = 0; i < count; i++) {
            this.particles.push(new Particle(x, y, color, speed, size, life));
        }
    }

    update(dt) {
        if (this.state !== 'play') return;

        // --- Trigger Detection ---
        if (this.currentLevelData.triggers) {
            this.currentLevelData.triggers.forEach(tr => {
                if (tr.triggered && tr.oneShot) return;

                // Player AABB vs Trigger AABB
                if (this.player.x < tr.x + tr.width &&
                    this.player.x + this.player.width > tr.x &&
                    this.player.y < tr.y + tr.height &&
                    this.player.y + this.player.height > tr.y) {

                    tr.triggered = true;
                    if (tr.bindings) {
                        tr.bindings.forEach(bind => {
                            const trap = this.currentLevelData.traps[bind.trapIndex];
                            if (trap) {
                                if (bind.delay > 0) {
                                    setTimeout(() => {
                                        if (this.state === 'play') trap.dormant = false;
                                    }, bind.delay * 1000);
                                } else {
                                    trap.dormant = false;
                                }
                            }
                        });
                    }
                }
            });
        }

        this.camera.update(dt);
        for (let i = this.particles.length - 1; i >= 0; i--) {
            this.particles[i].update(dt);
            if (this.particles[i].life <= 0) {
                this.particles.splice(i, 1);
            }
        }

        // Apply Movement for Platforms and Traps
        const applyMovement = (obj, isPlatform) => {
            if (!obj.speed && !obj.oscSpeed) return;

            // Initialize base coordinates to avoid drift from oscillation
            if (obj.baseX === undefined) obj.baseX = obj.x;
            if (obj.baseY === undefined) obj.baseY = obj.y;

            // 1. Linear A-to-B Movement
            let deltaX = 0;
            let deltaY = 0;

            let tx = obj.tx || 0;
            let ty = obj.ty || 0;

            if (obj.speed > 0 && (tx !== 0 || ty !== 0)) {
                if (obj.startX === undefined) obj.startX = obj.baseX;
                if (obj.startY === undefined) obj.startY = obj.baseY;
                if (obj.movingForward === undefined) obj.movingForward = true;

                let targetX = obj.movingForward ? obj.startX + tx : obj.startX;
                let targetY = obj.movingForward ? obj.startY + ty : obj.startY;

                let dx = targetX - obj.baseX;
                let dy = targetY - obj.baseY;
                let dist = Math.hypot(dx, dy);
                let moveStep = obj.speed * dt;

                if (dist <= moveStep) {
                    deltaX = dx;
                    deltaY = dy;
                    obj.baseX = targetX;
                    obj.baseY = targetY;
                    obj.movingForward = !obj.movingForward;
                } else {
                    deltaX = (dx / dist) * moveStep;
                    deltaY = (dy / dist) * moveStep;

                    // Collision check for traps against platforms
                    if (!isPlatform) {
                        let willCollide = false;
                        const futureX = obj.baseX + deltaX;
                        const futureY = obj.baseY + deltaY;

                        // Treat traps as AABB for this collision check
                        // traps rotation needs exact AABB mapping
                        const sw = obj.width * (obj.scale || 1);
                        const sh = obj.height * (obj.scale || 1);
                        const minX = futureX - sw / 2;
                        const maxX = futureX + sw / 2;
                        const minY = futureY - sh / 2;
                        const maxY = futureY + sh / 2;

                        for (let p of this.currentLevelData.platforms) {
                            if (minX < p.x + p.width && maxX > p.x &&
                                minY < p.y + p.height && maxY > p.y) {
                                willCollide = true;
                                break;
                            }
                        }

                        if (willCollide) {
                            deltaX = 0;
                            deltaY = 0;
                            obj.movingForward = !obj.movingForward; // Turn around immediately
                        }
                    }

                    obj.baseX += deltaX;
                    obj.baseY += deltaY;
                }
            }

            // 2. Oscillation / Curve Movement
            let ox = 0;
            let oy = 0;
            if (obj.oscSpeed > 0 && (obj.oscX || obj.oscY)) {
                if (obj.oscTime === undefined) obj.oscTime = 0;
                obj.oscTime += dt * obj.oscSpeed;
                ox = Math.sin(obj.oscTime) * (obj.oscX || 0);
                oy = Math.cos(obj.oscTime) * (obj.oscY || 0);
            }

            // 3. Final positional blending
            let oldX = obj.x;
            let oldY = obj.y;
            obj.x = obj.baseX + ox;
            obj.y = obj.baseY + oy;

            let totalDeltaX = obj.x - oldX;
            let totalDeltaY = obj.y - oldY;

            // Move player if standing on platform
            if (isPlatform && this.player.vy >= 0) {
                if (this.player.x + this.player.width > obj.x &&
                    this.player.x < obj.x + obj.width &&
                    Math.abs((this.player.y + this.player.height) - obj.y) < 15) {
                    this.player.x += totalDeltaX;
                    this.player.y += totalDeltaY;
                }
            }
        };

        if (this.currentLevelData.platforms) {
            for (let p of this.currentLevelData.platforms) applyMovement(p, true);
        }
        if (this.currentLevelData.traps) {
            for (let t of this.currentLevelData.traps) {
                if (!t.dormant) applyMovement(t, false);
            }
        }

        this.player.update(this.currentLevelData.platforms, this.currentLevelData.settings, dt);

        // Trap collision logic
        if (!this.player.invulnerable) {
            for (let trap of this.currentLevelData.traps) {
                if (trap.dormant) continue;
                const rotation = (trap.rotation || 0) % 360;
                const isVertical = (rotation === 90 || rotation === 270);

                if (trap.type === 'laser') {
                    const bounds = this.getLaserBounds(trap, this.currentLevelData.platforms);
                    const px = this.player.x + this.player.width / 2;
                    const py = this.player.y + this.player.height / 2;
                    // Check intersection with the dynamic laser bounds
                    if (px >= bounds.minX - this.player.width / 2 && px <= bounds.maxX + this.player.width / 2 &&
                        py >= bounds.minY - this.player.height / 2 && py <= bounds.maxY + this.player.height / 2) {
                        this.player.takeDamage(trap.damage || 20);
                    }
                } else {
                    // Approximate collision for current traps (e.g. spikes)
                    let tWidth = trap.width;
                    let tHeight = trap.height;
                    // Fix incorrect hitbox for vertical wall traps
                    if (isVertical) {
                        tWidth = trap.height;
                        tHeight = trap.width;
                    }
                    const dx = (this.player.x + this.player.width / 2) - trap.x;
                    const dy = (this.player.y + this.player.height / 2) - trap.y;
                    if (Math.abs(dx) < this.player.width / 2 + (tWidth / 2) &&
                        Math.abs(dy) < this.player.height / 2 + (tHeight / 2)) {
                        this.player.takeDamage(trap.damage || 20);
                    }
                }
            }
        }
        this.camera.follow(this.player);
        const ls = this.currentLevelData.settings;
        this.camera.clamp(ls.worldWidth, ls.worldHeight);

        // goals are processed below in the collection loop
        const cond = this.currentLevelData.conditions || { targetCount: 1 };

        // Timer logic
        this.playTimer += dt || (1 / 60);
        const timerEl = document.getElementById('timer-display');

        if (cond.timeLimit > 0) {
            timerEl.classList.remove('hidden');
            const remaining = Math.max(0, cond.timeLimit - this.playTimer);
            timerEl.textContent = '剩余时间: ' + remaining.toFixed(1) + 's';

            if (remaining < 3) timerEl.classList.add('low-time');
            else timerEl.classList.remove('low-time');

            if (this.playTimer > cond.timeLimit) {
                alert("时间到！挑战失败。");
                this.restartLevel();
                return;
            }
        } else {
            timerEl.classList.add('hidden');
        }

        // Goal collection logic
        let allCollected = true;
        for (let g of this.currentLevelData.goals) {
            if (!g.collected) {
                const dx = (this.player.x + this.player.width / 2) - g.x;
                const dy = (this.player.y + this.player.height / 2) - g.y;
                if (Math.hypot(dx, dy) < this.player.width / 2 + 20) {
                    g.collected = true;
                    this.camera.shake(0.2, 5);
                    this.spawnParticles(g.x, g.y, '#FFD700', 30, 12, 4, 0.6);
                    this.collectedGoals++;
                    if (this.state !== 'edit') this.runManager.addCurrency(1);
                    document.getElementById('goal-display').textContent = '目标: ' + this.collectedGoals + ' / ' + cond.targetCount;
                } else {
                    allCollected = false;
                }
            }
        }

        // Facility Interaction Logic
        if (this.currentLevelData.facilities) {
            for (let fac of this.currentLevelData.facilities) {
                if (this.player.x < fac.x + fac.width &&
                    this.player.x + this.player.width > fac.x &&
                    this.player.y < fac.y + fac.height &&
                    this.player.y + this.player.height > fac.y) {

                    if (keys['ArrowDown'] || keys['KeyS']) {
                        if (!fac.interactedTimer || Date.now() - fac.interactedTimer > 1000) {
                            let cost = fac.cost !== undefined ? fac.cost : 10;
                            let amount = fac.amount || 1;

                            if (this.runManager && this.runManager.currentStats.currency >= cost) {
                                // Purchase
                                this.runManager.currentStats.currency -= cost;
                                fac.interactedTimer = Date.now();

                                if (fac.type === 'heal') {
                                    this.player.hp = this.player.maxHp;
                                    this.player.mp = this.player.maxMp;
                                    this.spawnParticles(fac.x + fac.width / 2, fac.y, '#4aefff', 20, 8, 3, 0.5);
                                    uiLayer.appendChild(this.createFloatingText(fac.x + fac.width / 2, fac.y, "MAX RESTORED", "#4aefff"));
                                } else if (fac.type === 'player_upgrade') {
                                    this.runManager.currentStats.playerLevel = (this.runManager.currentStats.playerLevel || 1) + amount;
                                    this.player.maxHp += 20 * amount;
                                    this.player.hp += 20 * amount;
                                    this.player.maxMp += 20 * amount;
                                    this.player.mp += 20 * amount;
                                    this.spawnParticles(fac.x + fac.width / 2, fac.y, '#ffaa00', 20, 8, 3, 0.5);
                                    uiLayer.appendChild(this.createFloatingText(fac.x + fac.width / 2, fac.y, "LEVEL UP", "#ffaa00"));
                                } else if (fac.type === 'card_upgrade') {
                                    if (this.runManager.currentStats.deck && this.runManager.currentStats.deck.length > 0) {
                                        let deck = this.runManager.currentStats.deck;
                                        let cardToUpgrade = deck[Math.floor(Math.random() * deck.length)];
                                        cardToUpgrade.level = (cardToUpgrade.level || 1) + amount;
                                        cardToUpgrade.value = (cardToUpgrade.value || 0) * 1.5;
                                        this.spawnParticles(fac.x + fac.width / 2, fac.y, '#d666ff', 20, 8, 3, 0.5);
                                        uiLayer.appendChild(this.createFloatingText(fac.x + fac.width / 2, fac.y, `UPGRADED: ${cardToUpgrade.name}`, "#d666ff"));
                                    } else {
                                        this.runManager.currentStats.currency += cost;
                                        fac.interactedTimer = 0;
                                        uiLayer.appendChild(this.createFloatingText(fac.x + fac.width / 2, fac.y, "NO CARDS", "#ff0000"));
                                    }
                                }
                                document.getElementById('currency-text').textContent = this.runManager.currentStats.currency;
                                this.camera.shake(0.2, 5);
                            } else {
                                if (!fac.interactedTimer || Date.now() - fac.interactedTimer > 1000) {
                                    fac.interactedTimer = Date.now();
                                    uiLayer.appendChild(this.createFloatingText(fac.x + fac.width / 2, fac.y, "NOT ENOUGH PTS", "#ff0000"));
                                }
                            }
                        }
                    } else {
                        // Prompt
                        if (!fac.promptTimer || Date.now() - fac.promptTimer > 100) {
                            fac.promptTimer = Date.now();
                            const pid = `fac-prompt-${Math.round(fac.x)}-${Math.round(fac.y)}`;
                            if (!document.getElementById(pid)) {
                                const el = this.createFloatingText(fac.x + fac.width / 2, fac.y - 20, "PRESS DOWN TO BUY", "#ffffff");
                                el.id = pid;
                                uiLayer.appendChild(el);
                                // floating text auto removes itself anyway, but we set a tiny inner timeout if needed
                            }
                        }
                    }
                }
            }
        }

        if (this.currentLevelData.items) {
            for (let item of this.currentLevelData.items) {
                if (!item.collected && Math.hypot(this.player.x + this.player.width / 2 - item.x, this.player.y + this.player.height / 2 - item.y) < 30) {
                    item.collected = true;
                    this.camera.shake(0.1, 3);
                    if (item.type === 'hp') {
                        this.spawnParticles(item.x, item.y, '#ff4a4a', 15, 8, 3, 0.4);
                        this.player.hp = Math.min(this.player.hp + 30, this.player.maxHp);
                        uiLayer.appendChild(this.createFloatingText(item.x, item.y, "+30 HP", "#ff4a4a"));
                    } else if (item.type === 'mp') {
                        this.spawnParticles(item.x, item.y, '#4a9eff', 15, 8, 3, 0.4);
                        this.player.mp = Math.min(this.player.mp + 40, this.player.maxMp);
                        uiLayer.appendChild(this.createFloatingText(item.x, item.y, "+40 MP", "#4a9eff"));
                    }
                }
            }
        }

        if (this.collectedGoals >= cond.targetCount) {
            if (!this.currentLevelData.exit.active) {
                console.log("[Trigger] Goals collected! Exit activated.");
            }
            this.currentLevelData.exit.active = true;
        }

        const e = this.currentLevelData.exit;
        if (e && e.active) {
            // Use fallback dimensions if exit w/h not stored (default exit size: 50x80)
            const ew = e.w || 50;
            const eh = e.h || 80;
            if (this.player.x < e.x + ew &&
                this.player.x + this.player.width > e.x &&
                this.player.y < e.y + eh &&
                this.player.y + this.player.height > e.y) {

                e.active = false; // Prevent re-triggering
                const nextIdx = this.levelManager.getNextLevelIndex();

                if (this.state !== 'edit' && this.runManager.runActive) {
                    // Shop transition for Roguelike
                    this.runManager.saveState(this.player);
                    this.runManager.showShop(nextIdx);
                } else {
                    // Normal transition (non-roguelike mode)
                    if (nextIdx !== -1) {
                        this.levelManager.loadLevel(nextIdx);
                    } else {
                        this.win();
                    }
                }
            }
        }
    }

    createFloatingText(x, y, text, color) {
        const el = document.createElement('div');
        el.textContent = text;
        el.style.position = 'absolute';
        el.style.left = (x - this.camera.x) + 'px';
        el.style.top = (y - this.camera.y - 20) + 'px';
        el.style.color = color;
        el.style.fontWeight = 'bold';
        el.style.fontSize = '14px';
        el.style.textShadow = '1px 1px 0 #000';
        el.style.pointerEvents = 'none';
        el.style.transition = 'all 1s ease-out';
        el.style.zIndex = '1000';

        // Animateup
        requestAnimationFrame(() => {
            el.style.transform = 'translateY(-30px)';
            el.style.opacity = '0';
        });

        setTimeout(() => {
            if (el.parentNode) el.parentNode.removeChild(el);
        }, 1000);

        return el;
    }

    draw() {
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        if (this.state === 'play' || this.state === 'shop' || this.state === 'won') {
            this.camera.apply(ctx);
        } else if (this.state === 'edit' && !IS_STANDALONE) {
            ctx.translate(-this.editor.cameraX, -this.editor.cameraY);
        }

        const s = this.currentLevelData.settings;
        ctx.fillStyle = '#2a2a2a';
        ctx.fillRect(0, 0, s.worldWidth, s.worldHeight);

        ctx.shadowBlur = 8;
        ctx.shadowColor = '#00ffff';
        for (let p of this.currentLevelData.platforms) {
            ctx.fillStyle = '#111'; // Dark core
            ctx.fillRect(p.x, p.y, p.width, p.height);

            ctx.strokeStyle = '#00ffff'; // Neon border cyan
            ctx.lineWidth = 2;
            ctx.strokeRect(p.x, p.y, p.width, p.height);
        }
        ctx.shadowBlur = 0; // reset shadow once after all platforms

        // Inner glow pass (no shadow needed)
        for (let p of this.currentLevelData.platforms) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.lineWidth = 1;
            ctx.strokeRect(p.x + 2, p.y + 2, p.width - 4, p.height - 4);
        }

        // Draw Jump Pads
        if (this.currentLevelData.jumppads) {
            const timeSession = Date.now() / 1000;
            for (let jp of this.currentLevelData.jumppads) {
                // Base
                ctx.fillStyle = '#111';
                ctx.fillRect(jp.x, jp.y, jp.width, jp.height);

                // Neon glow effect for jump pads
                ctx.shadowBlur = 10;
                ctx.shadowColor = '#00ffaa';
                ctx.strokeStyle = '#00ffaa';
                ctx.lineWidth = 2;
                ctx.strokeRect(jp.x, jp.y, jp.width, jp.height);
                ctx.shadowBlur = 0;

                // Animated upward arrows
                ctx.save();
                ctx.beginPath();
                ctx.rect(jp.x, jp.y, jp.width, jp.height);
                ctx.clip(); // clip arrows inside the pad

                ctx.strokeStyle = 'rgba(0, 255, 170, 0.6)';
                ctx.lineWidth = 2;
                const arrowSpacing = 15;
                const numArrows = Math.ceil(jp.width / arrowSpacing);
                const offset = (timeSession * 40) % 20; // moving up

                for (let i = 0; i < numArrows; i++) {
                    const ax = jp.x + 10 + i * arrowSpacing;
                    if (ax > jp.x + jp.width - 5) break;

                    // Draw two rows of arrows
                    for (let row = 0; row < 3; row++) {
                        const ay = jp.y + jp.height + offset - row * 10;
                        if (ay > jp.y && ay < jp.y + jp.height) {
                            ctx.beginPath();
                            ctx.moveTo(ax - 4, ay + 4);
                            ctx.lineTo(ax, ay);
                            ctx.lineTo(ax + 4, ay + 4);
                            ctx.stroke();
                        }
                    }
                }
                ctx.restore();
            }
        }

        // Draw Items
        const items = this.currentLevelData.items || [];
        const timeSession = Date.now() / 1000;
        for (let item of items) {
            if (!item.collected) {
                const isHp = item.type === 'hp';
                const mainColor = isHp ? '#ff4a4a' : '#4a9eff';
                const glowColor = isHp ? 'rgba(255, 74, 74, 0.6)' : 'rgba(74, 158, 255, 0.6)';

                // Float animation
                const floatY = item.y + Math.sin(timeSession * 3 + item.x) * 5;

                ctx.save();
                ctx.translate(item.x, floatY);

                // Outer glow
                ctx.shadowBlur = 15;
                ctx.shadowColor = mainColor;

                // Outer pulsing ring
                const pulseScale = 1 + Math.sin(timeSession * 5) * 0.2;
                ctx.beginPath();
                ctx.arc(0, 0, 12 * pulseScale, 0, Math.PI * 2);
                ctx.fillStyle = glowColor;
                ctx.fill();

                // Inner solid core
                ctx.beginPath();
                ctx.arc(0, 0, 8, 0, Math.PI * 2);
                ctx.fillStyle = '#fff';
                ctx.fill();

                ctx.beginPath();
                ctx.arc(0, 0, 6, 0, Math.PI * 2);
                ctx.fillStyle = mainColor;
                ctx.fill();

                // Cross/star inside
                ctx.fillStyle = '#fff';
                if (isHp) {
                    ctx.fillRect(-4, -1, 8, 2);
                    ctx.fillRect(-1, -4, 2, 8);
                } else {
                    ctx.fillRect(-3, -3, 6, 6);
                }

                ctx.restore();
            }
        }

        // Draw Traps
        const traps = this.currentLevelData.traps || [];
        for (let trap of traps) {
            if (trap.dormant) continue;
            ctx.save();
            ctx.translate(trap.x, trap.y);
            ctx.rotate((trap.rotation || 0) * Math.PI / 180);
            ctx.scale(trap.scale || 1, trap.scale || 1);

            if (trap.type === 'spikes') {
                // Detailed Sawtooth
                const spikeWidth = 12;
                const spikeHeight = 16;
                const count = Math.floor(trap.width / spikeWidth);
                const offset = (trap.width - count * spikeWidth) / 2; // center spikes

                // Draw metallic base
                ctx.fillStyle = '#333';
                ctx.fillRect(-trap.width / 2, trap.height / 2 - 4, trap.width, 4);

                // Create gradient ONCE for all spikes (same vertical range)
                const grad = ctx.createLinearGradient(0, trap.height / 2, 0, trap.height / 2 - spikeHeight);
                grad.addColorStop(0, '#555');
                grad.addColorStop(0.5, '#aa0000');
                grad.addColorStop(1, '#ff4a4a');

                ctx.shadowBlur = 6;
                ctx.shadowColor = '#ff4a4a';

                // Draw all spikes in one pass
                for (let i = 0; i < count; i++) {
                    const startX = -trap.width / 2 + offset + i * spikeWidth;
                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.moveTo(startX, trap.height / 2 - 4);
                    ctx.lineTo(startX + spikeWidth / 2, trap.height / 2 - spikeHeight);
                    ctx.lineTo(startX + spikeWidth, trap.height / 2 - 4);
                    ctx.closePath();
                    ctx.fill();
                }
                ctx.shadowBlur = 0;

                // Spike tip highlights (no shadow needed)
                ctx.fillStyle = '#fff';
                for (let i = 0; i < count; i++) {
                    const startX = -trap.width / 2 + offset + i * spikeWidth;
                    ctx.beginPath();
                    ctx.arc(startX + spikeWidth / 2, trap.height / 2 - spikeHeight + 2, 1, 0, Math.PI * 2);
                    ctx.fill();
                }
            } else if (trap.type === 'laser') {
                ctx.restore(); // Pop the standard rotation transform since we draw lasers by world coordinate

                const bounds = this.getLaserBounds(trap, this.currentLevelData.platforms);

                ctx.save(); // Push a new state specifically for laser
                ctx.strokeStyle = '#ff0000';
                ctx.lineWidth = 4 + Math.sin(Date.now() / 100) * 2;
                ctx.shadowBlur = 10;
                ctx.shadowColor = '#ff0000';
                ctx.beginPath();

                const rotation = (trap.rotation || 0) % 360;
                if (rotation === 90 || rotation === 270) {
                    ctx.moveTo(trap.x, bounds.minY);
                    ctx.lineTo(trap.x, bounds.maxY);
                } else {
                    ctx.moveTo(bounds.minX, trap.y);
                    ctx.lineTo(bounds.maxX, trap.y);
                }
                ctx.stroke();
                ctx.restore(); // Restore the isolated laser state

                // Central origin emitter/hub removed as requested by user
                ctx.save(); // Push dummy state to balance the loop's outer ctx.restore()
            }
            ctx.restore();
        }

        // Draw Facilities (Game Mode - Neon Holographic Style)
        if (this.currentLevelData.facilities) {
            for (let fac of this.currentLevelData.facilities) {
                const cx = fac.x + fac.width / 2;
                const cy = fac.y + fac.height / 2;
                const time = Date.now() / 1000;

                ctx.save();
                ctx.translate(cx, cy);

                // Color and Icon selection
                let color = '#ffffff';
                let icon = '';
                if (fac.type === 'heal') { color = '#4aefff'; icon = '✚'; }
                else if (fac.type === 'player_upgrade') { color = '#ffaa00'; icon = '⚔️'; }
                else if (fac.type === 'card_upgrade') { color = '#d666ff'; icon = '🃏'; }

                // Pulsing glow
                ctx.shadowBlur = 15 + Math.sin(time * 3) * 10;
                ctx.shadowColor = color;

                // Draw tech base platform
                ctx.fillStyle = 'rgba(20, 20, 25, 0.9)';
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(-fac.width / 2 + 5, fac.height / 2);
                ctx.lineTo(fac.width / 2 - 5, fac.height / 2);
                ctx.lineTo(fac.width / 2 - 12, fac.height / 2 - 12);
                ctx.lineTo(-fac.width / 2 + 12, fac.height / 2 - 12);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                // Holographic inner projection beam
                ctx.globalCompositeOperation = 'lighter';
                ctx.fillStyle = color;
                ctx.globalAlpha = 0.15 + Math.sin(time * 5) * 0.05;
                ctx.beginPath();
                ctx.moveTo(-fac.width / 2 + 12, fac.height / 2 - 12);
                ctx.lineTo(fac.width / 2 - 12, fac.height / 2 - 12);
                ctx.lineTo(0, -fac.height / 2 - 10);
                ctx.closePath();
                ctx.fill();

                // Floating Geometry & Icon
                ctx.globalCompositeOperation = 'source-over';
                ctx.globalAlpha = 1;
                const floatOffset = Math.sin(time * 2 + fac.x) * 4;
                ctx.translate(0, floatOffset - 15);

                // Rotating neon ring
                ctx.save();
                ctx.rotate(time * 1.5);
                ctx.beginPath();
                ctx.arc(0, 0, 16, 0, Math.PI * 1.5);
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                ctx.stroke();

                // Inner second ring against rotation
                ctx.rotate(-time * 3);
                ctx.beginPath();
                ctx.arc(0, 0, 12, Math.PI, Math.PI * 2.5);
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.restore();

                // Center Icon
                ctx.font = '20px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                // Remove shadow for clean icon text
                ctx.shadowBlur = 0;
                ctx.fillText(icon, 0, 0);

                ctx.restore();

                // Cost overlay (Stars)
                if (fac.cost) {
                    ctx.save();
                    ctx.translate(cx, fac.y - 15 + Math.sin(time * 2 + fac.x) * 4);
                    ctx.fillStyle = '#FFD700';
                    ctx.font = 'bold 12px Arial';
                    ctx.textAlign = 'center';
                    ctx.shadowBlur = 5;
                    ctx.shadowColor = '#000';
                    ctx.fillText(`⭐ ${fac.cost}`, 0, 0);
                    ctx.restore();
                }
            }
        }

        const goals = this.currentLevelData.goals;
        for (let g of goals) {
            if (!g.collected) {
                const floatY = g.y + Math.sin(Date.now() / 500 + g.x) * 8;
                const rot = Date.now() / 1000; // continuous rotation

                ctx.save();
                ctx.translate(g.x, floatY);
                ctx.rotate(rot);

                ctx.shadowBlur = 20;
                ctx.shadowColor = '#FFD700';

                // Draw a faceted gem/coin
                ctx.beginPath();
                ctx.moveTo(0, -18);
                ctx.lineTo(18, 0);
                ctx.lineTo(0, 18);
                ctx.lineTo(-18, 0);
                ctx.closePath();
                ctx.fillStyle = '#FFA500'; // Darker orange base
                ctx.fill();

                // Inner bright diamond
                ctx.beginPath();
                ctx.moveTo(0, -12);
                ctx.lineTo(12, 0);
                ctx.lineTo(0, 12);
                ctx.lineTo(-12, 0);
                ctx.closePath();
                ctx.fillStyle = '#FFD700'; // Bright gold
                ctx.fill();

                // Highlight
                ctx.beginPath();
                ctx.moveTo(0, -6);
                ctx.lineTo(6, 0);
                ctx.lineTo(0, 6);
                ctx.lineTo(-6, 0);
                ctx.closePath();
                ctx.fillStyle = '#FFF';
                ctx.fill();

                ctx.restore();
            }
        }

        const e = this.currentLevelData.exit;
        if (e && (e.active || this.state === 'edit')) {
            const timeExit = Date.now() / 1000;
            ctx.save();
            ctx.translate(e.x, e.y);

            ctx.shadowBlur = 20;
            ctx.shadowColor = e.active ? '#00ffaa' : '#555';

            // Draw portal frame
            ctx.strokeStyle = e.active ? '#00ffaa' : '#666';
            ctx.lineWidth = 4;
            ctx.strokeRect(0, 0, e.w, e.h);

            if (e.active) {
                // Draw digital matrix/energy effect inside
                ctx.beginPath();
                ctx.rect(0, 0, e.w, e.h);
                ctx.clip(); // Restrict internal drawing to portal bounds

                // Scanning lines
                const scanlineY = (timeExit * 100) % e.h;
                ctx.fillStyle = 'rgba(0, 255, 170, 0.4)';
                ctx.fillRect(0, scanlineY, e.w, 10);

                // Glowing border pulse
                const pulse = 0.1 + Math.abs(Math.sin(timeExit * 3)) * 0.3;
                ctx.fillStyle = `rgba(0, 255, 170, ${pulse})`;
                ctx.fillRect(0, 0, e.w, e.h);

                // "DATA" or Tech particles floating up
                for (let i = 0; i < 5; i++) {
                    const py = (e.h - ((timeExit * 40 + i * 20) % e.h));
                    const px = 10 + (i * 12) % (e.w - 20);
                    ctx.fillStyle = '#fff';
                    ctx.fillRect(px, py, 2, 8);
                }
            } else {
                ctx.fillStyle = 'rgba(100, 100, 100, 0.3)';
                ctx.fillRect(0, 0, e.w, e.h);
                // "LOCKED" indicator
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 10px Arial';
                ctx.textAlign = 'center';
                ctx.fillText("LOCKED", e.w / 2, e.h / 2 + 4);
            }
            ctx.restore();
        }

        if (this.state !== 'edit') {
            this.player.draw(ctx);
            for (let p of this.particles) p.draw(ctx);
        }

        ctx.restore();

        if (this.editor) this.editor.draw(ctx);

        // Update HUD (Roguelike Stats) - throttled to every 3 frames
        if (this.state !== 'edit') {
            if (!this._hudFrame) this._hudFrame = 0;
            this._hudFrame++;
            if (this._hudFrame % 3 === 0) {
                const hpPercent = (this.player.hp / this.player.maxHp) * 100;
                const mpPercent = (this.player.mp / this.player.maxMp) * 100;

                document.getElementById('hp-bar-fill').style.width = hpPercent + '%';
                document.getElementById('mp-bar-fill').style.width = mpPercent + '%';

                if (this.runManager && this.runManager.currentStats) {
                    document.getElementById('level-text').textContent = this.runManager.currentStats.playerLevel || 1;
                }

                document.getElementById('hp-text').textContent = Math.ceil(this.player.hp) + '/' + this.player.maxHp;
                document.getElementById('mp-text').textContent = Math.ceil(this.player.mp) + '/' + this.player.maxMp;

                // Update Currency
                if (this.runManager && this.runManager.runActive) {
                    document.getElementById('currency-text').textContent = this.runManager.currentStats.currency;
                    document.getElementById('currency-display').classList.remove('hidden');
                } else {
                    document.getElementById('currency-display').classList.add('hidden');
                }
            }
        }
    }

    loop(timestamp) {
        const dt = (timestamp - this.lastTimestamp) / 1000 || 0;
        this.lastTimestamp = timestamp;

        this.update(dt);
        this.draw();
        requestAnimationFrame(this.loop);
    }
}

// --- INITIALIZATION ---
const game = new Game();

// --- UI EVENT LISTENERS ---
document.getElementById('btn-edit-mode').addEventListener('click', () => {
    game.editor.toggle();
});

document.getElementById('btn-new-level').addEventListener('click', () => {
    game.levelManager.createNewLevel();
    updateDashboard();
});

document.getElementById('btn-save-level').addEventListener('click', () => {
    const d = game.currentLevelData;
    game.levelManager.saveCurrentLevelState(
        d.platforms,
        d.goals,
        d.exit,
        d.spawn,
        d.settings,
        d.conditions,
        d.flow,
        d.traps,
        d.triggers,
        d.jumppads
    );
    alert('关卡已保存！');
});

document.getElementById('btn-clear-level').addEventListener('click', () => {
    if (confirm('确定要清空当前关卡并重置所有物块位置吗？')) {
        const s = game.currentLevelData.settings;
        game.currentLevelData.platforms = [];
        game.currentLevelData.traps = [];
        game.currentLevelData.triggers = [];
        game.currentLevelData.jumppads = [];
        // Reset mandatory objects to clean defaults based on world size
        game.currentLevelData.goals = [{ x: s.worldWidth * 0.8, y: s.worldHeight * 0.8 }];
        game.currentLevelData.exit = { x: s.worldWidth - 100, y: s.worldHeight - 100, w: 50, h: 50, active: false };
        game.currentLevelData.spawn = { x: 100, y: s.worldHeight - 100 };

        // Update player position to match new spawn
        game.player.x = game.currentLevelData.spawn.x;
        game.player.y = game.currentLevelData.spawn.y;

        // Clear selection
        if (game.editor) {
            game.editor.selectedObject = null;
            game.editor.selectedType = null;
        }
    }
});

document.getElementById('btn-play-test').addEventListener('click', () => {
    game.startPlayTest();
});

document.getElementById('btn-stop-test').addEventListener('click', () => {
    game.stopPlayTest();
});

document.getElementById('btn-export').addEventListener('click', () => {
    game.levelManager.exportLevels();
});

document.getElementById('btn-export-standalone').addEventListener('click', () => {
    game.levelManager.exportStandaloneGame();
});

document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('file-input').click();
});

document.getElementById('file-input').addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        game.levelManager.importLevels(e.target.files[0]);
    }
});

document.getElementById('grid-snap').addEventListener('change', (e) => {
    game.editor.snap = e.target.checked;
});

document.getElementById('btn-settings').addEventListener('click', () => {
    game.editor.updateSettingsUI();
    document.getElementById('level-settings-panel').classList.remove('hidden');
});

document.getElementById('btn-close-settings').addEventListener('click', () => {
    game.editor.applySettingsFromUI();
    document.getElementById('level-settings-panel').classList.add('hidden');
});

document.getElementById('btn-blueprint').addEventListener('click', () => {
    game.blueprintEditor.toggle();
});

document.getElementById('btn-close-blueprint').addEventListener('click', () => {
    game.blueprintEditor.toggle();
});

const tools = ['cursor', 'platform', 'goal', 'exit', 'spawn', 'delete', 'item-hp', 'item-mp', 'trigger'];
tools.forEach(t => {
    document.getElementById('tool-' + t).addEventListener('click', (e) => {
        game.editor.tool = t;
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
    });
});

document.getElementById('btn-win-next').addEventListener('click', () => {
    const nextIdx = game.levelManager.getNextLevelIndex();
    if (nextIdx !== -1) {
        game.levelManager.loadLevel(nextIdx);
    } else {
        alert("恭喜！你已完成了所有关卡！");
        game.state = 'play';
        winScreen.classList.add('hidden');
    }
});

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

function updateDashboard() {
    const list = document.getElementById('level-list');
    list.innerHTML = '';
    game.levelManager.levels.forEach((l, i) => {
        const div = document.createElement('div');
        div.className = 'level-item ' + (i === game.levelManager.currentLevelIndex ? 'active' : '');

        const nameSpan = document.createElement('span');
        nameSpan.textContent = l.name;
        nameSpan.style.cursor = 'pointer';
        div.draggable = true;
        div.ondragstart = (e) => {
            e.dataTransfer.setData('text/plain', i);
            e.dataTransfer.effectAllowed = 'move';
        };
        nameSpan.onmousedown = () => game.levelManager.loadLevel(i);
        nameSpan.ondblclick = (e) => {
            e.stopPropagation();
            const newName = prompt('重命名关卡:', l.name);
            if (newName) game.levelManager.renameLevel(i, newName);
        };
        nameSpan.title = "双击重命名";
        div.appendChild(nameSpan);

        const controlSpan = document.createElement('span');
        controlSpan.style.float = 'right';

        const upBtn = document.createElement('button');
        upBtn.textContent = '↑';
        upBtn.style.padding = '2px 5px';
        upBtn.style.fontSize = '10px';
        upBtn.onclick = (e) => { e.stopPropagation(); game.levelManager.moveLevelUp(i); };

        const downBtn = document.createElement('button');
        downBtn.textContent = '↓';
        downBtn.style.padding = '2px 5px';
        downBtn.style.fontSize = '10px';
        downBtn.onclick = (e) => { e.stopPropagation(); game.levelManager.moveLevelDown(i); };

        const delBtn = document.createElement('button');
        delBtn.textContent = '×';
        delBtn.style.padding = '2px 5px';
        delBtn.style.fontSize = '10px';
        delBtn.style.background = '#822';
        delBtn.onclick = (e) => { e.stopPropagation(); game.levelManager.deleteLevel(i); };

        controlSpan.appendChild(upBtn);
        controlSpan.appendChild(downBtn);
        controlSpan.appendChild(delBtn);
        div.appendChild(controlSpan);

        list.appendChild(div);
    });
}

canvas.addEventListener('mousedown', (e) => {
    // Only spawn platforms in play mode AND when NOT in the editor
    if (game.state === 'play' && !game.editor.active) {
        // Only handle left (0) and right (2) clicks for platform placement
        if (e.button !== 0 && e.button !== 2) return;

        const cost = game.currentLevelData.settings.platformCost || 10;

        // MP Check
        if (game.player.consumeMp(cost)) {
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            const worldX = mx + game.camera.x;
            const worldY = my + game.camera.y;

            // Simple overlap check to prevent wasting MP on invalid placements?
            // For now, let's just place it. Overlap check should arguably happen before MP use, 
            // but the current simple logic doesn't have overlap check here (it was added to standalone but not here??)
            // Wait, looking at previous context, I see I added overlap check to STANDALONE but maybe not here?
            // actually, let's align them.

            // Left click: Horizontal (100x20), Right click: Vertical (20x100)
            let bw = 100;
            let bh = 20;
            if (e.button === 2) {
                bw = 20;
                bh = 100;
            }

            game.currentLevelData.platforms.push({
                x: worldX - bw / 2,
                y: worldY - bh / 2,
                width: bw,
                height: bh,
                color: '#888'
            });

            // Visual/Audio cue for success?
        } else {
            // Not enough MP
            console.log("Not enough MP!");
            // Optional: Visual cue (flash MP bar red?)
            const mpBar = document.getElementById('mp-bar-fill');
            if (mpBar) {
                mpBar.parentElement.style.borderColor = 'red';
                setTimeout(() => mpBar.parentElement.style.borderColor = 'rgba(255, 255, 255, 0.2)', 200);
            }
        }
    }
});

// Initialize Dashboard UI after game is fully constructed and inject AI levels
if (typeof window.IS_STANDALONE === 'undefined' || !window.IS_STANDALONE) {
    if (typeof game !== 'undefined' && game.levelManager) {
        let saveNeeded = false;

        // Level 1: Trust Fall
        if (!game.levelManager.levels.find(l => l.name === "致命信赖")) {
            game.levelManager.levels.push({
                name: "致命信赖",
                settings: { ...defaultSettings, worldWidth: 800, worldHeight: 2000 },
                platforms: [
                    { x: 350, y: 150, width: 100, height: 20, color: '#888' }, // Spawn platform
                    { x: 200, y: 1950, width: 400, height: 50, color: '#888' } // Bottom safety platform
                ],
                goals: [{ x: 400, y: 1900 }],
                traps: [
                    { type: 'spikes', x: 400, y: 1940, width: 800, height: 40, rotation: 0, scale: 1, damage: 100, dormant: false }
                ],
                enemies: [],
                exit: { x: 400, y: 1900, w: 50, h: 50, active: false },
                spawn: { x: 400, y: 100 },
                conditions: { timeLimit: 0, targetCount: 1 },
                flow: { nextType: 'linear', targets: [] },
                triggers: [
                    { x: 300, y: 1000, width: 200, height: 200, oneShot: true, triggered: false, bindings: [{ trapIndex: 0, delay: 0 }] }
                ]
            });
            saveNeeded = true;
        }

        // Level 2: Resource Trial
        if (!game.levelManager.levels.find(l => l.name === "资源绝境")) {
            game.levelManager.levels.push({
                name: "资源绝境",
                settings: { ...defaultSettings, worldWidth: 1600, worldHeight: 800, mpRegen: 0.05, platformCost: 20 },
                platforms: [
                    { x: 50, y: 300, width: 100, height: 20, color: '#888' },
                    { x: 1450, y: 300, width: 100, height: 20, color: '#888' }
                ],
                goals: [{ x: 1500, y: 250 }],
                traps: [
                    { type: 'spikes', x: 800, y: 750, width: 1600, height: 100, rotation: 0, scale: 1, damage: 100, dormant: false }
                ],
                enemies: [],
                exit: { x: 1500, y: 250, w: 50, h: 50, active: false },
                spawn: { x: 100, y: 250 },
                conditions: { timeLimit: 0, targetCount: 1 },
                flow: { nextType: 'linear', targets: [] },
                triggers: []
            });
            saveNeeded = true;
        }

        // Level 3: Matrix Symphony
        if (!game.levelManager.levels.find(l => l.name === "矩阵交响曲")) {
            game.levelManager.levels.push({
                name: "矩阵交响曲",
                settings: { ...defaultSettings, worldWidth: 1200, worldHeight: 800 },
                platforms: [
                    { x: 50, y: 300, width: 100, height: 20, color: '#888' },
                    { x: 300, y: 300, width: 100, height: 20, color: '#888', speed: 100, tx: 200, ty: 0 },
                    { x: 700, y: 300, width: 100, height: 20, color: '#888', speed: 80, tx: 0, ty: 150 },
                    { x: 1000, y: 450, width: 150, height: 20, color: '#888' }
                ],
                goals: [{ x: 400, y: 250 }, { x: 850, y: 400 }],
                traps: [
                    { type: 'laser', x: 600, y: 200, width: 10, height: 400, onInterval: 2, offInterval: 1.5, rotation: 0, scale: 1, damage: 50, dormant: false }
                ],
                enemies: [],
                exit: { x: 1050, y: 400, w: 50, h: 50, active: false },
                spawn: { x: 100, y: 250 },
                conditions: { timeLimit: 0, targetCount: 2 },
                flow: { nextType: 'linear', targets: [] },
                triggers: []
            });
            saveNeeded = true;
        }

        if (saveNeeded) {
            game.levelManager.saveToStorage();
        }
        updateDashboard();
    }
}
