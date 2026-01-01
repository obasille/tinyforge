const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d");

const memory = new WebAssembly.Memory({
  initial: 16,   // 16 × 64 KB = 1 MB
  maximum: 16    // fixed, no growth
});

const wasm = await WebAssembly.instantiateStreaming(
  fetch("../cart/cartridge.wasm"),
  {
    env: { memory }
  }
);

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

const TICK_HZ = 60;
const DT = 1000 / TICK_HZ; // ms

let last = performance.now();
let acc = 0;

function frame(now) {
  acc += now - last;
  last = now;

  while (acc >= DT) {
    update(inputMask);
    acc -= DT;
  }

  draw();
  ctx.putImageData(image, 0, 0);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
