// App state: garment choice, placed designs, guides. Undo history + localStorage autosave.

const STORAGE_KEY = 'ttc-singlet-lab:v1';

let nextId = 1;
export const newId = () => `d${Date.now().toString(36)}${(nextId++).toString(36)}`;

// The layout a fresh session starts with comes from the design pack (js/designs/load.js).
let makeDefaults = () => [];
export function setDefaultDesigns(fn) {
  makeDefaults = fn;
}

export function defaultDesigns() {
  return makeDefaults().map((d) => ({ id: newId(), visible: true, flip: false, ...d }));
}

export function defaultState() {
  return {
    version: 1,
    garment: { style: 'miler-base-singlet', size: 'L', color: 'Black' },
    overlays: { safe: true, logo: true, grid: true },
    safeMargin: 2, // keep heat away from the bonded seams and hems
    press: { w: 38, h: 38 }, // 15 x 15 in heat press platen
    designs: defaultDesigns(),
  };
}

export class Store {
  constructor() {
    this.state = this.load() || defaultState();
    this.selectedId = null;
    this.listeners = new Set();
    this.past = [];
    this.future = [];
    this.lastSnapshot = this.snapshot();
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (s?.version !== 1 || !Array.isArray(s.designs)) return null;
      delete s.bib;
      delete s.overlays?.bib;
      return { ...defaultState(), ...s };
    } catch {
      return null;
    }
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      /* private mode or full storage: autosave is a convenience only */
    }
  }

  snapshot() {
    const { garment, designs } = this.state;
    return JSON.stringify({ garment, designs });
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(reason = 'change') {
    for (const fn of this.listeners) fn(reason, this);
  }

  // Record an undo step if anything changed since the last one.
  commit() {
    const snap = this.snapshot();
    if (snap === this.lastSnapshot) return;
    this.past.push(this.lastSnapshot);
    if (this.past.length > 80) this.past.shift();
    this.future = [];
    this.lastSnapshot = snap;
    this.save();
  }

  restore(snap) {
    const s = JSON.parse(snap);
    const garmentChanged = JSON.stringify(s.garment) !== JSON.stringify(this.state.garment);
    Object.assign(this.state, s);
    this.lastSnapshot = snap;
    if (!this.state.designs.some((d) => d.id === this.selectedId)) this.selectedId = null;
    this.save();
    this.emit(garmentChanged ? 'garment' : 'designs');
  }

  undo() {
    this.commit();
    if (!this.past.length) return;
    this.future.push(this.lastSnapshot);
    this.restore(this.past.pop());
  }

  redo() {
    if (!this.future.length) return;
    this.past.push(this.lastSnapshot);
    this.restore(this.future.pop());
  }

  get selected() {
    return this.state.designs.find((d) => d.id === this.selectedId) || null;
  }

  select(id) {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.emit('select');
  }

  update(id, patch, { commit = true } = {}) {
    const d = this.state.designs.find((x) => x.id === id);
    if (!d) return;
    Object.assign(d, patch);
    this.emit('designs');
    if (commit) this.commit();
  }

  add(design) {
    const d = { id: newId(), visible: true, flip: false, rot: 0, ...design };
    this.state.designs.push(d);
    this.selectedId = d.id;
    this.emit('designs');
    this.commit();
    return d;
  }

  remove(id) {
    this.state.designs = this.state.designs.filter((d) => d.id !== id);
    if (this.selectedId === id) this.selectedId = null;
    this.emit('designs');
    this.commit();
  }

  move(id, delta) {
    const list = this.state.designs;
    const i = list.findIndex((d) => d.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.emit('designs');
    this.commit();
  }

  setGarment(patch) {
    Object.assign(this.state.garment, patch);
    this.emit('garment');
    this.commit();
  }

  setOverlay(key, value) {
    this.state.overlays[key] = value;
    this.save();
    this.emit('overlays');
  }

  replaceAll(state) {
    this.state = { ...defaultState(), ...state };
    this.selectedId = null;
    this.commit();
    this.emit('garment');
  }
}
