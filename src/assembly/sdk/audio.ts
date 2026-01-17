// TinyForge SDK - Audio System
// Sound effects and music playback functions
//
// IMPORTANT: Browser Autoplay Policy
// Audio cannot play until after a user interaction (click, key press, etc.)
// This is a browser security feature that cannot be bypassed.
//
// Best Practice:
// - Don't call playMusic() in init() - it will fail silently
// - Call playMusic() after user clicks start button or begins gameplay
// - Sound effects work the same way - require user interaction first

/**
 * Play a sound effect by ID
 * Sound effects can overlap and play simultaneously
 * 
 * ⚠️ Requires prior user interaction (click/keypress) due to browser autoplay policy
 * 
 * @param id Sound effect ID (corresponds to assets/sfx/{id}-*.wav file)
 * @param volume Volume level (0.0 to 1.0, default: 1.0)
 * 
 * @example
 * ```ts
 * playSfx(0, 1.0);   // Plays sfx/0-jump.wav at full volume
 * playSfx(1, 0.5);   // Plays sfx/1-shoot.wav at half volume
 * ```
 */
@external("env", "audio.playSfx")
export declare function playSfx(id: u32, volume: f32): void;

/**
 * Play background music by ID
 * Music loops continuously until stopped. Playing new music stops the previous track
 * 
 * ⚠️ Requires prior user interaction (click/keypress) due to browser autoplay policy
 * Call this AFTER user clicks start button, not in init()
 * 
 * @param id Music track ID (corresponds to assets/music/{id}-*.mp3 file)
 * @param volume Volume level (0.0 to 1.0, default: 1.0)
 * 
 * @example
 * ```ts
 * // ❌ WRONG - Called in init(), before user interaction
 * export function init() {
 *   playMusic(0, 0.7);  // Will fail silently
 * }
 * 
 * // ✅ CORRECT - Called after user clicks start button
 * export function update() {
 *   if (startButtonPressed) {
 *     playMusic(0, 0.7);  // Works!
 *   }
 * }
 * ```
 */
@external("env", "audio.playMusic")
export declare function playMusic(id: u32, volume: f32): void;

/**
 * Stop currently playing music
 * Does not affect sound effects
 */
@external("env", "audio.stopMusic")
export declare function stopMusic(): void;
