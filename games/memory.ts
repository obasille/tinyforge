// Memory Map
// This defines the fixed memory layout shared between host and cartridge

export const FB_START: usize    = 0x000000;  // Framebuffer start
export const FB_SIZE: usize     = 307200;    // 320×240×4 bytes

export const RAM_START: usize   = 0x04B000;  // Game RAM start
export const RAM_SIZE: usize    = 262144;    // 256 KB

export const SAVE_START: usize  = 0x08B000;  // Save data start
export const SAVE_SIZE: usize   = 65536;     // 64 KB

export const DEBUG_START: usize = 0x09B000;  // Debug/tooling start
export const DEBUG_SIZE: usize  = 65536;     // 64 KB
