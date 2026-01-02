// Fantasy Console SDK - Console Logging
// Output functions for debugging and monitoring

/**
 * Log a message to the HTML console panel
 * @param msg String literal to log (no allocations)
 */
@external("env", "console.log")
export declare function log(msg: string): void;

/**
 * Log a warning message to the HTML console panel
 * @param msg String literal to log (no allocations)
 */
@external("env", "console.warn")
export declare function warn(msg: string): void;

/**
 * Log an error message to the HTML console panel
 * @param msg String literal to log (no allocations)
 */
@external("env", "console.error")
export declare function error(msg: string): void;
