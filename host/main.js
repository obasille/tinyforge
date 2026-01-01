const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d");

const memory = new WebAssembly.Memory({
  initial: 16,   // 16 × 64 KB = 1 MB
  maximum: 16    // fixed, no growth
});
console.log(memory.buffer.byteLength); // → 1048576

const wasm = await WebAssembly.instantiateStreaming(
  fetch("../cart/cartridge.wasm"),
  {
    env: { memory }
  }
);

const { init, update, draw, WIDTH, HEIGHT, FB_PTR } =
  wasm.instance.exports;

// Create a Uint8ClampedArray that points to the framebuffer in WASM memory
// Note: UInt8ClampedArray type is required by ImageData
const fb = new Uint8ClampedArray(
  memory.buffer,
  FB_PTR,
  WIDTH * HEIGHT * 4
);

const image = new ImageData(fb, WIDTH, HEIGHT);

init();

function frame() {
  update();
  draw();
  ctx.putImageData(image, 0, 0);
  requestAnimationFrame(frame);
}

frame();
