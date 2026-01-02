// TinyForge SDK - Audio System
// Sound effects and music playback functions

/**
 * Play a sound effect by ID
 * Sound effects can overlap and play simultaneously
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
export declare function playSfx(id: u8, volume: f32): void;

/**
 * Play background music by ID
 * Music loops continuously until stopped. Playing new music stops the previous track
 * 
 * @param id Music track ID (corresponds to assets/music/{id}-*.mp3 file)
 * @param volume Volume level (0.0 to 1.0, default: 1.0)
 * 
 * @example
 * ```ts
 * playMusic(0, 0.7);  // Plays music/0-title-theme.mp3 at 70% volume
 * ```
 */
@external("env", "audio.playMusic")
export declare function playMusic(id: u8, volume: f32): void;

/**
 * Stop currently playing music
 * Does not affect sound effects
 */
@external("env", "audio.stopMusic")
export declare function stopMusic(): void;
