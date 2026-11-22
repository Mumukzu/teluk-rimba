// Teluk Rimba — keyboard + pointer input. Held keys steer; one-shot presses
// (start, pause, enter/exit vehicle) are queued as flags and taken once.
export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_ENTER = 4;
export const ACTION_HORN = 8;

const FORWARD = new Set(['KeyW', 'ArrowUp']);
const BACK = new Set(['KeyS', 'ArrowDown']);
const LEFT = new Set(['KeyA', 'ArrowLeft']);
const RIGHT = new Set(['KeyD', 'ArrowRight']);
const RUN = new Set(['ShiftLeft', 'ShiftRight']);
const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const ENTER = new Set(['KeyE']);
const HORN = new Set(['KeyH']);

export function createInput(canvas) {
  const keys = new Set();
  let actions = 0;
  let dragDX = 0, dragDY = 0, wheel = 0;

  window.addEventListener('keydown', (e) => {
    if (CONFIRM.has(e.code)) { if (!e.repeat) actions |= ACTION_CONFIRM; }
    else if (PAUSE.has(e.code)) { if (!e.repeat) actions |= ACTION_PAUSE; }
    else if (ENTER.has(e.code)) { if (!e.repeat) actions |= ACTION_ENTER; }
    else if (HORN.has(e.code)) { if (!e.repeat) actions |= ACTION_HORN; }
    else if (FORWARD.has(e.code) || BACK.has(e.code) || LEFT.has(e.code) || RIGHT.has(e.code) || RUN.has(e.code)) {
      keys.add(e.code);
    } else return;
    e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dragDX += e.clientX - lastX; dragDY += e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
  });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('wheel', (e) => { wheel += e.deltaY; e.preventDefault(); }, { passive: false });

  const has = (set) => { for (const k of set) if (keys.has(k)) return true; return false; };
  return {
    get forward() { return has(FORWARD); },
    get back() { return has(BACK); },
    get left() { return has(LEFT); },
    get right() { return has(RIGHT); },
    get run() { return has(RUN); },
    takeActions() { const a = actions; actions = 0; return a; },
    takeDrag() { const d = { dx: dragDX, dy: dragDY }; dragDX = 0; dragDY = 0; return d; },
    takeWheel() { const w = wheel; wheel = 0; return w; },
  };
}
