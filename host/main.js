const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d");

const wasm = await WebAssembly.instantiateStreaming(
  fetch("../cart/cartridge.wasm"),
  {}
);

const { memory, init, update, draw, WIDTH, HEIGHT, FB_PTR } =
  wasm.instance.exports;

console.log(memory.buffer.byteLength); // → 1048576

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
