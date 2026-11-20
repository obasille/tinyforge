# tools

Third-party binaries used by repo scripts.

## wasm-objdump.exe

`wasm-objdump` from the [WebAssembly Binary Toolkit (WABT)](https://github.com/WebAssembly/wabt).
It prints the sections, imports, exports and function names of a `.wasm` file.

**Used by:** `scripts/check-alloc.js` (`pnpm check:alloc <game>`). The script
builds a debug version of a game, runs `wasm-objdump -x` on it, and looks for
allocation symbols (`__new`, `__alloc`, `__realloc`, `__free`, `memory.grow`,
`malloc`) to confirm the game does no dynamic allocation.

**Platform:** Windows x64 only. On Windows the script uses this copy; on
macOS/Linux it runs `wasm-objdump` from your PATH (install WABT with your
package manager, e.g. `brew install wabt` or `apt install wabt`).

**Version:** WABT 1.0.39 (version string embedded in the binary). Build paths
inside it point to WABT's GitHub Actions release build for Windows. To update, download the
Windows archive from https://github.com/WebAssembly/wabt/releases and replace
`wasm-objdump.exe` with the one in its `bin/` folder.
