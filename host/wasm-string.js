// AssemblyScript String Helper
// Reads strings from AssemblyScript WASM memory
// /!\ DOESN'T WORK!! /!\
// Copied from: lib/loader/index.js
// https://github.com/AssemblyScript/assemblyscript/blob/5a125c75a6edf34dee77609b6654c17fd61c8ada/lib/loader/index.js

// Runtime header offsets
const ID_OFFSET = -8;
const SIZE_OFFSET = -4;

// Runtime ids
const STRING_ID = 2;

const STRING_SMALLSIZE = 192;  // break-even point in V8
const STRING_CHUNKSIZE = 1024; // mitigate stack overflow

const utf16 = new TextDecoder("utf-16le", { fatal: true });

/**
 * Reads a string from AssemblyScript memory
 * @param {WebAssembly.Memory} memory - The WASM memory instance
 * @param {number} ptr - Pointer to the string in WASM memory
 * @returns {string | null} The decoded string, or null if ptr is 0
 */
export function readASString(memory, ptr) {
    if (!ptr) return null;
    const buffer = memory.buffer;
    const id = new Uint32Array(buffer)[ptr + ID_OFFSET >>> 2];
    if (id !== STRING_ID) throw Error(`not a string: ${ptr}`);
    return getStringImpl(buffer, ptr);
}

/** Gets a string from memory. */
function getStringImpl(buffer, ptr) {
  let len = new Uint32Array(buffer)[ptr + SIZE_OFFSET >>> 2] >>> 1;
  const wtf16 = new Uint16Array(buffer, ptr, len);
  if (len <= STRING_SMALLSIZE) return String.fromCharCode(...wtf16);
  try {
    return utf16.decode(wtf16);
  } catch {
    let str = "", off = 0;
    while (len - off > STRING_CHUNKSIZE) {
      str += String.fromCharCode(...wtf16.subarray(off, off += STRING_CHUNKSIZE));
    }
    return str + String.fromCharCode(...wtf16.subarray(off));
  }
}
