const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d");

const memory = new WebAssembly.Memory({
  initial: 16,   // 16 × 64 KB = 1 MB
  maximum: 16    // fixed, no growth
});

const wasm = await (async () => {
  try {
    const instance = await WebAssembly.instantiateStreaming(
      fetch("../cart/cartridge.wasm"),
      {
        env: { memory }
      }
    );
    
    // Validate required exports
    const required = ['init', 'update', 'draw', 'WIDTH', 'HEIGHT'];
    const missing = required.filter(name => !instance.instance.exports[name]);
    
    if (missing.length > 0) {
      const error = `Cartridge missing required exports: ${missing.join(', ')}`;
      document.body.innerHTML = `<pre style="color:red;padding:20px;">${error}</pre>`;
      throw new Error(error);
    }
    
    return instance;
  } catch (e) {
    document.body.innerHTML = `<pre style="color:red;padding:20px;">Failed to load cartridge:\n${e}</pre>`;
    throw e;
  }
})();

const { init, update, draw, WIDTH, HEIGHT } =
  wasm.instance.exports;

// Create a Uint8ClampedArray that points to the framebuffer in WASM memory
// Note: UInt8ClampedArray type is required by ImageData
const fb = new Uint8ClampedArray(
  memory.buffer,
  0,
  WIDTH * HEIGHT * 4
);

const image = new ImageData(fb, WIDTH, HEIGHT);

const KEYMAP = {
  ArrowUp:    1 << 0,
  ArrowDown:  1 << 1,
  ArrowLeft:  1 << 2,
  ArrowRight: 1 << 3,
  KeyZ:       1 << 4,
  KeyX:       1 << 5,
  Enter:      1 << 6
};

let inputMask = 0;
let prevInputMask = 0;

window.addEventListener("keydown", e => {
  if (KEYMAP[e.code]) {
    inputMask |= KEYMAP[e.code];
    e.preventDefault();
  }
});

window.addEventListener("keyup", e => {
  if (KEYMAP[e.code]) {
    inputMask &= ~KEYMAP[e.code];
    e.preventDefault();
  }
});

init();

// === Fixed Timestep Loop ===

// This ensures deterministic game logic regardless of actual frame rate
const TICK_HZ = 60;                    // Target simulation rate (60 updates per second)
const DT = 1000 / TICK_HZ;             // Delta time per update (16.67ms)
const MAX_UPDATES = 5;                 // Safety cap to prevent spiral of death

let last = performance.now();          // Last frame timestamp
let acc = 0;                           // Time accumulator for fixed timestep

// === Dev Tools ===
let fps = 60;
let frameCount = 0;
let lastFpsUpdate = performance.now();

const fpsEl = document.getElementById('fps');
const updatesEl = document.getElementById('updates');
const accEl = document.getElementById('acc');
const inputEl = document.getElementById('input');

// Pause game when tab is hidden, resume when visible
// This stops the animation loop entirely to save CPU when tab is in background
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    // Tab hidden - animation loop will stop naturally
  } else {
    // Tab visible - restart animation loop
    last = performance.now();          // Reset reference time on resume
    acc = 0;                           // Clear accumulated time
    requestAnimationFrame(frame);      // Restart the loop
  }
});

function frame(now) {
  // Accumulate time since last frame
  acc += now - last;
  last = now;

  // Run fixed timestep updates
  // This loop ensures update() is called at exactly TICK_HZ frequency
  // Multiple updates may occur per frame if rendering is slow
  let updates = 0;
  while (acc >= DT && updates < MAX_UPDATES) {
    update(inputMask, prevInputMask);  // Game logic update
    prevInputMask = inputMask;         // Track previous input state
    acc -= DT;                         // Consume one timestep
    updates++;
  }
  
  // If we hit the update cap, skip frames rather than spiraling
  // This prevents the game from freezing while trying to catch up
  if (updates >= MAX_UPDATES) {
    console.warn("Max updates reached, skipping frames");
    acc = 0;                           // Reset to prevent runaway
  }

  // Render current state (runs at display refresh rate)
  draw();
  ctx.putImageData(image, 0, 0);

  // Update FPS counter
  frameCount++;
  if (now - lastFpsUpdate >= 1000) {
    fps = Math.round(frameCount * 1000 / (now - lastFpsUpdate));
    frameCount = 0;
    lastFpsUpdate = now;
  }

  // Update dev tools panel
  fpsEl.textContent = fps;
  updatesEl.textContent = updates;
  accEl.textContent = Math.round(acc);
  inputEl.textContent = '0x' + inputMask.toString(16).padStart(2, '0').toUpperCase();

  // Continue the loop only if document is still visible
  if (!document.hidden) {
    requestAnimationFrame(frame);
  }
}

requestAnimationFrame(frame);
