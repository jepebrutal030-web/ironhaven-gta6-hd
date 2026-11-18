// Keyboard + mouse input: edge-triggered presses, pointer lock, mouse deltas.
export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.mouseDX = 0; this.mouseDY = 0;
    this.locked = false;
    this.clicked = false;
    this.onKey = null; // synchronous key callback (set by the game for edge actions)
    window.addEventListener('keydown', (e) => { if (e.repeat) return; this.keys.add(e.code); this.pressed.add(e.code); if (this.onKey) this.onKey(e.code); });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('mousemove', (e) => { if (this.locked) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; } });
    window.addEventListener('mousedown', (e) => { if (e.button === 0) this.clicked = true; });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement != null; });
  }
  down(code) { return this.keys.has(code); }
  wasPressed(code) { return this.pressed.has(code); }
  axis() {
    let x = 0, y = 0;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    if (this.down('KeyW') || this.down('ArrowUp')) y += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) y -= 1;
    return { x, y };
  }
  consumeMouse() { const dx = this.mouseDX, dy = this.mouseDY; this.mouseDX = 0; this.mouseDY = 0; return { dx, dy }; }
  consumeClick() { const c = this.clicked; this.clicked = false; return c; }
  endFrame() { this.pressed.clear(); }
  lock(el) { try { el.requestPointerLock(); } catch { /* noop */ } }
  unlock() { try { document.exitPointerLock(); } catch { /* noop */ } }
}
