// La computadora del lobby: una pantalla con páginas (inicio, nombre, color, cosméticos, cursos).
// Solo lógica y dibujo en un canvas 2D; quien la use decide cómo se pulsa (mouse, dedo o manos en VR).
// Sin DOM: se prueba en Node (test/computer.test.mjs).
import { visibleCatalog, PALETTE, NAME_MAX, MODELS } from './cosmetics.js';

export const SCREEN = { W: 1024, H: 597 };

const KEY_ROWS = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
const TITLES = { home: 'COMPUTADORA', name: 'TU NOMBRE', color: 'ELIGE TU COLOR', model: 'MODELO DEL ROBOT', cosmetics: 'COSMÉTICOS', courses: 'CURSOS' };
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const fmt = (t) => (t == null ? '--' : t.toFixed(1) + ' s');

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class Computer {
  /**
   * @param {object} o
   * @param {import('./cosmetics.js').Profile} o.profile
   * @param {Record<string, any>} o.courses
   * @param {{teleport: (target: 'noob'|'pro'|'spawn') => void, changed: (what: string) => void}} o.actions
   */
  constructor({ profile, courses, actions }) {
    this.profile = profile;
    this.courses = courses;
    this.actions = actions;
    this.page = 'home';
    this.nameBuf = '';
    this.msg = '';
    this.hover = -1;
    this.dirty = true;
    this.buttons = [];
    this.build();
  }

  go(page) {
    this.page = page;
    this.msg = '';
    if (page === 'name') this.nameBuf = this.profile.name || '';
    this.build();
  }

  say(text) {
    this.msg = text;
    this.dirty = true;
  }

  build() {
    const B = [];
    const add = (b) => B.push({ color: '#2f4aa8', ...b });
    const back = () => add({ id: 'back', x: 52, y: 470, w: 220, h: 70, label: 'VOLVER', color: '#5a647f', onPress: () => this.go('home') });
    const P = this.profile;

    switch (this.page) {
      case 'home': {
        const items = [
          ['name', 'NOMBRE', '#2f5bd6'], ['color', 'COLOR', '#8a5cff'],
          ['model', 'MODELO', '#d6456b'], ['cosmetics', 'COSMÉTICOS', '#e08a1e'],
          ['courses', 'CURSOS', '#1fa971'],
        ];
        items.forEach(([page, label, color], i) => add({
          id: 'go-' + page, x: 52 + (i % 2) * 480, y: 104 + Math.floor(i / 2) * 135, w: i === 4 ? 920 : 440, h: 120,
          label, color, fs: 42, onPress: () => this.go(page),
        }));
        break;
      }
      case 'name': {
        KEY_ROWS.forEach((row, r) => {
          const kw = 84, gap = 8, rowW = row.length * kw + (row.length - 1) * gap;
          const x0 = (SCREEN.W - rowW) / 2;
          [...row].forEach((ch, i) => add({
            id: 'key-' + ch, x: x0 + i * (kw + gap), y: 190 + r * 70, w: kw, h: 62, label: ch, fs: 32, color: '#2a3763',
            onPress: () => { if (this.nameBuf.length < NAME_MAX) { this.nameBuf += ch; this.dirty = true; } },
          }));
        });
        back();
        add({ id: 'del', x: 402, y: 470, w: 220, h: 70, label: 'BORRAR', color: '#b8442f', onPress: () => { this.nameBuf = this.nameBuf.slice(0, -1); this.dirty = true; } });
        add({
          id: 'ok', x: 752, y: 470, w: 220, h: 70, label: 'LISTO', color: '#1fa971',
          onPress: () => {
            if (!this.nameBuf.trim()) return this.say('Escribe al menos una letra');
            P.setName(this.nameBuf.trim());
            this.actions.changed('name');
            this.go('home');
            this.say('Nombre guardado: ' + P.name);
          },
        });
        break;
      }
      case 'color': {
        PALETTE.forEach((c, i) => add({
          id: 'color-' + hex(c), x: 72 + (i % 6) * 150, y: 120 + Math.floor(i / 6) * 160, w: 130, h: 130,
          label: '', swatch: hex(c), active: P.color === c,
          onPress: () => { P.setColor(c); this.actions.changed('color'); this.build(); },
        }));
        back();
        break;
      }
      case 'model': {
        MODELS.forEach((m, i) => add({
          id: 'model-' + m.id, x: 52, y: 115 + i * 150, w: 920, h: 130,
          label: m.name, sub: P.model === m.id ? 'PUESTO · ' + m.desc : m.desc, fs: 40,
          color: P.model === m.id ? '#1fa971' : '#2f4aa8', active: P.model === m.id,
          onPress: () => { P.setModel(m.id); this.actions.changed('model'); this.say('Modelo: ' + m.name); this.build(); },
        }));
        back();
        break;
      }
      case 'cosmetics': {
        visibleCatalog(P).slice(0, 6).forEach((it, i) => {
          const owned = P.owned.has(it.id), worn = P.isEquipped(it.id);
          add({
            id: 'item-' + it.id, x: 52 + (i % 2) * 480, y: 110 + Math.floor(i / 2) * 110, w: 440, h: 96,
            label: it.name,
            sub: worn ? 'EQUIPADO · pulsa para quitar' : owned ? 'Tuyo · pulsa para equipar' : it.price + ' monedas',
            color: worn ? '#1fa971' : owned ? '#2f4aa8' : P.coins >= it.price ? '#e08a1e' : '#3a4261',
            onPress: () => {
              const r = P.toggle(it.id);
              if (r.ok) this.say(r.equipped === false ? it.name + ' quitado' : it.name + ' equipado');
              else if (r.reason === 'coins') return this.say('Te faltan ' + r.missing + ' monedas. Gánalas en los cursos');
              this.actions.changed('cos');
              this.build();
            },
          });
        });
        back();
        add({ id: 'clear', x: 302, y: 470, w: 300, h: 70, label: 'QUITAR TODO', color: '#b8442f', onPress: () => { P.unequipAll(); this.actions.changed('cos'); this.build(); } });
        break;
      }
      case 'courses': {
        const info = (c) => `Mejor: ${fmt(P.best[c.id])} · Premio: ${c.reward.first} monedas la 1.ª vez, ${c.reward.repeat} después`;
        const list = Object.values(this.courses);
        list.forEach((c, i) => add({
          id: 'tp-' + c.id, x: 52, y: 110 + i * 105, w: 920, h: 92,
          label: 'IR AL ' + c.name, sub: info(c), color: hex(c.color).replace(/^#(..)(..)(..)$/, (_, r, g, b) => '#' + [r, g, b].map((h) => Math.round(parseInt(h, 16) * 0.6).toString(16).padStart(2, '0')).join('')),
          onPress: () => { this.actions.teleport(c.id); this.say('Teletransportado: ' + c.name); },
        }));
        add({ id: 'tp-spawn', x: 52, y: 110 + list.length * 105, w: 920, h: 80, label: 'VOLVER A LA APARICIÓN', color: '#3a4261', onPress: () => { this.actions.teleport('spawn'); this.say('Teletransportado a la aparición'); } });
        back();
        break;
      }
    }
    this.buttons = B;
    this.hover = -1;
    this.dirty = true;
  }

  indexAt(u, v) {
    const x = u * SCREEN.W, y = v * SCREEN.H;
    for (let i = this.buttons.length - 1; i >= 0; i--) {
      const b = this.buttons[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return i;
    }
    return -1;
  }

  /** Pulsa en (u, v) con u, v en 0..1. Devuelve true si había un botón. */
  pressAt(u, v) {
    const i = this.indexAt(u, v);
    if (i < 0) return false;
    this.buttons[i].onPress();
    this.dirty = true;
    return true;
  }

  /** Pulsa un botón por su id (para pruebas). */
  press(id) {
    const b = this.buttons.find((x) => x.id === id);
    if (!b) throw new Error('No hay botón ' + id + ' en la página ' + this.page);
    b.onPress();
    this.dirty = true;
  }

  /** Marca el botón bajo (u, v). Devuelve true si hay uno. */
  hoverAt(u, v) {
    const i = this.indexAt(u, v);
    if (i !== this.hover) { this.hover = i; this.dirty = true; }
    return i >= 0;
  }

  clearHover() {
    if (this.hover !== -1) { this.hover = -1; this.dirty = true; }
  }

  footer() {
    if (this.msg) return this.msg;
    const P = this.profile;
    if (this.page === 'home') return 'Jugador: ' + (P.name || '(sin nombre)');
    if (this.page === 'cosmetics') return 'Gana monedas completando los cursos';
    if (this.page === 'name') return 'Apunta o toca las letras';
    return '';
  }

  draw(ctx) {
    const { W, H } = SCREEN;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0c1226';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#16224a';
    ctx.fillRect(0, 0, W, 84);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = 'bold 40px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(TITLES[this.page], 36, 44);
    ctx.textAlign = 'right';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillStyle = '#ffd23d';
    ctx.fillText(this.profile.coins + ' monedas', W - 36, 44);

    if (this.page === 'name') {
      roundRect(ctx, 52, 104, 920, 66, 12);
      ctx.fillStyle = '#05080f';
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.font = 'bold 40px sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(this.nameBuf + '_', W / 2, 138);
    }

    this.buttons.forEach((b, i) => {
      roundRect(ctx, b.x, b.y, b.w, b.h, 14);
      ctx.fillStyle = b.swatch || b.color;
      ctx.fill();
      if (i === this.hover) {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fill();
      }
      if (b.active) {
        ctx.lineWidth = 7;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
      if (b.label) {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${b.fs || 34}px sans-serif`;
        ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 - (b.sub ? 16 : 0));
      }
      if (b.sub) {
        ctx.font = '22px sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillText(b.sub, b.x + b.w / 2, b.y + b.h / 2 + 20);
      }
    });

    ctx.textAlign = 'center';
    ctx.font = '26px sans-serif';
    ctx.fillStyle = '#b9c3e6';
    ctx.fillText(this.footer(), W / 2, H - 28);
    this.dirty = false;
  }
}
