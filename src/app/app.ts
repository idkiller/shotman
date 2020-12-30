import * as PIXI from 'pixi.js';
import * as Hammer from 'hammerjs';

interface Point {
    x: number;
    y: number;
}

interface Rect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

interface MonsterRange {
    index: number;
    range: number;
}

function intersect(a: PIXI.Rectangle, b:PIXI.Rectangle) {
    return a.x + a.width > b.x && a.x < b.x + b.width && a.y + a.height > b.y && a.y < b.y + b.height;

}

class BulletInfo {
    public sprite: PIXI.AnimatedSprite;
    public range: number;
    private target: Point;
    private speed: number;
    
    constructor(sprite: PIXI.AnimatedSprite, range: number, speed: number, target: Point) {
        this.sprite = sprite;
        this.range = range;
        this.target = target;
        this.speed = speed;
    }

    public moveToTarget() {
        let dx = this.sprite.x - this.target.x;
        let dy = this.sprite.y - this.target.y;
        let D = Math.sqrt(Math.pow(dx, 2) + Math.pow(dy, 2));
        let dd = this.speed/D;

        this.sprite.x -= dd * dx;
        this.sprite.y -= dd * dy;

        this.range = dd >= 1 ? 0 : this.range - this.speed;
    }
}

class ClosePointHeap {
    private ranges: Array<MonsterRange>;
    constructor() {
        this.clear();
    }

    public clear() {
        this.ranges = [];
    }

    public push(p: MonsterRange) {
        let i = this.ranges.length;
        this.ranges.push(p);

        let parentIndex = Math.max(0, Math.floor((i + 1) / 2 - 1));
        const pushedVal = this.ranges[i].range;

        while (i > 0 && this.ranges[parentIndex].range > pushedVal) {
            parentIndex = Math.max(0, Math.floor((i + 1) / 2 - 1));
            this.swap(i, parentIndex);
            i = parentIndex;
        }
    }

    public pop() {
        if (this.ranges.length <= 1) return this.ranges.pop();

        const ret = this.ranges[0];
        let tmp = this.ranges.pop();
        this.ranges[0] = tmp;
        let i = 0;
        while (true) {
            let rightIndex = (i + 1) * 2;
            let leftIndex = (i + 1) * 2 - 1;
            let lowest = rightIndex;
            if (leftIndex >= this.ranges.length && rightIndex >= this.ranges.length) {
                break;
            }

            if (leftIndex >= this.ranges.length) lowest = rightIndex;
            if (rightIndex >= this.ranges.length) lowest = leftIndex;
            if (!(leftIndex >= this.ranges.length) && !(rightIndex >= this.ranges.length)) {
                lowest = this.ranges[rightIndex].range < this.ranges[leftIndex].range ? rightIndex : leftIndex;
            }
            if (this.ranges[i].range > this.ranges[lowest].range) {
                this.swap(i, lowest);
                i = lowest;
            }
            else
            {
                break;
            }
        }
        return ret;
    }

    public isEmpty() {
        return this.ranges.length <= 0;
    }

    private swap(a: number, b: number) {
        let tmp = this.ranges[b];
        this.ranges[b] = this.ranges[a];
        this.ranges[a] = tmp;
    }
}

const PanFlagLeft = 1;
const PanFlagRight = 2;
const PanFlagUp = 4;
const PanFlagDown = 8;

const PanEvents = {
    'panleft': PanFlagLeft,
    'panright': PanFlagRight,
    'panup': PanFlagUp,
    'pandown': PanFlagDown
};

export class GameApp {

    private app: PIXI.Application;

    private monsterKeys: Array<string>;
    private models: { [id: string] : Array<PIXI.Texture> };
    private monsters: Array<PIXI.AnimatedSprite>;
    private mage: PIXI.AnimatedSprite;

    private bulletModels: { [id: string] : Array<PIXI.Texture> };
    private bullets: Array<BulletInfo>;
    private bulletNumbers: number = 1;
    private bulletDelay: number = 90;
    private bulletDelayRemain: number;

    private spawnRange: number = 300;
    private spawningTime: number = 60;
    private remainSpaingTime: number;

    private validPoints: Array<Point>;
    private step: number = 10;

    private monsterStep: number = 1;

    private monsterHeap: ClosePointHeap;

    private mc: HammerManager;

    private moveX: number;
    private moveY: number;

    constructor(parent: HTMLElement, width: number, height: number) {
        this.app = new PIXI.Application({width, height, backgroundColor : 0x000000});
        this.models = {};
        this.monsters = [];
        this.bullets = [];
        this.bulletModels = {};
        this.validPoints = [];
        this.updateValidPoints(width, height);

        this.monsterHeap = new ClosePointHeap();

        parent.replaceChild(this.app.view, parent.lastElementChild); // Hack for parcel HMR

        this.mc = new Hammer.Manager(this.app.view, {
            recognizers: [
                [Hammer.Pan, {direction: Hammer.DIRECTION_ALL, threshold: 5}]
            ]
        });
        this.mc.on('panmove', (ev: HammerInput) => {
            this.moveX = -Math.cos(ev.angle * Math.PI / 180) * this.step;
            this.moveY = -Math.sin(ev.angle * Math.PI / 180) * this.step;
        });

        // init Pixi loader
        let loader = new PIXI.Loader();

        // Add user player assets
        loader.add('spritesheet', 'texture.json');

        // Load assets
        loader.load(this.onAssetsLoaded.bind(this));
    }

    private onAssetsLoaded() {
        this.models['mage'] = this.loadSprite('mage', 2);
        this.models['ghost'] = this.loadSprite('ghost', 4);
        this.models['umaro'] = this.loadSprite('umaro', 4);
        this.models['redstar'] = this.loadSprite('redstar', 4);
        this.monsterKeys = ['ghost', 'umaro', 'redstar'];
        this.bulletModels['bullet'] = this.loadSprite('bullet', 2);

        this.reset();

        this.remainSpaingTime = this.spawningTime;
        this.bulletDelayRemain = this.bulletDelay;
        this.app.ticker.add((time: number) => {
            if (--this.remainSpaingTime === 0) {
                this.spawn();
                this.remainSpaingTime = this.spawningTime;
            }
            if (!this.monsterMoves()) {
                this.end();
                return;
            }
            
            this.shoot();
        });
    }

    private end() {
        console.log('GAME OVER');
        const style = new PIXI.TextStyle({
            fontFamily: 'Arial',
            fontSize: 60,
            fontStyle: 'italic',
            fontWeight: 'bold',
            fill: ['#ffffff', '#ff3333'], // gradient
            stroke: '#4a1850',
            strokeThickness: 5,
            dropShadow: true,
            dropShadowColor: '#000000',
            dropShadowBlur: 4,
            dropShadowAngle: Math.PI / 6,
            dropShadowDistance: 6,
            lineJoin: 'round'
        });
        const gameOver = new PIXI.Text('GAME OVER', style);
        gameOver.anchor.set(0.5);
        gameOver.x = this.app.screen.width / 2;
        gameOver.y = this.app.screen.height / 2;
        this.app.stage.addChild(gameOver);

        const gameOverRect = gameOver.getBounds();)

        const style2 = new PIXI.TextStyle({
            fontFamily: 'Arial',
            fontSize: 40,
            fontWeight: 'bold',
            fill: ['#ffffff', '#00ff99'], // gradient
            stroke: '#4a1850',
            strokeThickness: 5,
            dropShadow: true,
            dropShadowColor: '#000000',
            dropShadowBlur: 4,
            dropShadowAngle: Math.PI / 6,
            dropShadowDistance: 6,
            lineJoin: 'round'
        });
        const restart = new PIXI.Text('Restart?', style2)
        restart.anchor.set(0.5);
        restart.x = gameOver.x;
        restart.y = gameOverRect.bottom + 20;
        this.app.stage.addChild(restart);
        restart.interactive = true;
        restart.buttonMode = true;
        restart.on('pointerdown', () => this.reset());

        this.app.stop();
    }
    private reset() {

        if (this.app.stage.children.length > 0) {
            this.app.stage.removeChildren();
        }
        if (this.monsters.length > 0) {
            this.monsters.forEach(m => m.destroy());
            this.monsters = [];
        }
        if (this.mage) {
            this.mage.destroy();
            this.mage = null;
        }

        this.app.start();

        const mage = new PIXI.AnimatedSprite(this.models['mage']);
        mage.x = this.app.screen.width / 2;
        mage.y = this.app.screen.height / 2;
        mage.anchor.set(0.5);
        this.app.stage.addChild(mage);
        mage.animationSpeed = 0.16;
        mage.play();
        this.mage = mage;
    }

    private shoot() {
        let bulletCount = 0;
        if (--this.bulletDelayRemain === 0) {
            while (!this.monsterHeap.isEmpty()) {
                if (bulletCount++ >= this.bulletNumbers) {
                    break;
                }
    
                const rangeInfo = this.monsterHeap.pop();
                const monster = this.monsters[rangeInfo.index];
    
                const sprite = new PIXI.AnimatedSprite(this.bulletModels['bullet']);
                sprite.x = this.mage.x;
                sprite.y = this.mage.y;
                sprite.anchor.set(0.5);
                const bullet = new BulletInfo(
                    sprite,
                    500,
                    8,
                    {x: monster.x, y: monster.y}
                );
                this.app.stage.addChild(sprite);
                this.bullets.push(bullet);
            }
            this.bulletDelayRemain = this.bulletDelay;
        }
        
        let j, i = this.bullets.length;
        while (i--) {
            j = this.monsters.length;
            while (j--) {
                if (intersect(this.bullets[i].sprite.getBounds(), this.monsters[j].getBounds())) {
                    this.monsters[j].destroy();
                    this.monsters.splice(j, 1);
                    this.bullets[i].range = 0;
                }
            }
            if (this.bullets[i].range <= 0) {
                this.bullets[i].sprite.destroy();
                this.bullets.splice(i, 1);
            }
            else
            {
                this.bullets[i].moveToTarget();
            }
        }
    }

    private monsterMoves() {
        this.monsterHeap.clear();
        for (let i =0; i<this.monsters.length; i++) {
            const m = this.monsters[i];
            m.x += this.moveX;
            m.y += this.moveY;
            const range = this.moveToMage({x: m.x, y: m.y}, this.monsterStep);
            m.x = range[0].x;
            m.y = range[0].y;
            const b = m.getBounds();
            if (intersect(this.mage.getBounds(), b)) {
                return false;
            }
            this.monsterHeap.push({index: i, range: range[1]});
        }
        this.moveX = this.moveY = 0;
        return true;
    }

    private moveToMage(p: Point, d: number) : [Point, number] {
        let dx = p.x - this.mage.x;
        let dy = p.y - this.mage.y;
        let D = Math.sqrt(Math.pow(dx, 2) + Math.pow(dy, 2));
        let dd = d/D;
        return [{x: p.x - dd * dx, y: p.y - dd * dy}, D];
    }

    private loadSprite(name: string, n: number) {
        const textures = [];
        for (let i=0; i<n; i++)
        {
            const texture = PIXI.Texture.from(`${name}-${i}.png`);
            textures.push(texture);
        }
        return textures;
    }

    private spawn() {
        let p = this.validPoints[Math.floor(Math.random() * this.validPoints.length)];

        let mi = Math.floor(Math.random() * this.monsterKeys.length);
        const monster = new PIXI.AnimatedSprite(this.models[this.monsterKeys[mi]]);
        this.monsters.push(monster);
        monster.anchor.set(0.5);
        monster.animationSpeed = 0.16;
        monster.x = p.x;
        monster.y = p.y;
        this.app.stage.addChild(monster);
        monster.play();
        //console.log(`spawned!! ${this.mage.x}, ${this.mage.y} / ${monster.x}, ${monster.y} / ${this.app.stage.width}, ${this.app.stage.height} /  ${xr}, ${yr}`);
    }

    private updateValidPoints(width: number, height: number) {
        let center: Point = {
            x: width / 2,
            y: height / 2
        };
        let safe : Rect = {
            left: center.x - this.spawnRange,
            top: center.y - this.spawnRange,
            right: center.x + this.spawnRange,
            bottom: center.y + this.spawnRange
        };
        this.validPoints = [];
        let x, y;
        for (x = 0; x < width; x+=10) {
            if (safe.left <= x && x < safe.right) {
                for (y = 0; y < safe.top; y+=10) {
                    this.validPoints.push({x: x, y: y});
                }
                for (y = safe.bottom; y < height; y+=10) {
                    this.validPoints.push({x: x, y: y});
                }
            }
            else {
                for (y = 0; y < height; y+= 10) {
                    this.validPoints.push({x: x, y: y});
                }
            }
        }
    }
}
