// TinyForge SDK - Console Logging
// Output functions for debugging and monitoring

/**
 * Log a message to the HTML console panel
 * @param msg String literal to log (no allocations)
 */
// @ts-expect-error AssemblyScript decorator
@external("env", "console.log")
export declare function log(msg: string): void;

/**
 * Log a message with integer parameters
 * Use {} as placeholders for parameters
 * @param msg String literal with {} placeholders
 * @example logi("Score: {}, Lives: {}", score, lives)
 */
// @ts-expect-error AssemblyScript decorator
@external("env", "console.logi")
export declare function logi(
  msg: string,
  p1?: i64,
  p2?: i64,
  p3?: i64,
  p4?: i64
): void;

/**
 * Log a message with floating-point parameters
 * Use {} as placeholders for parameters
 * @param msg String literal with {} placeholders
 * @example logf("Position: ({}, {})", x, y)
 */
// @ts-expect-error AssemblyScript decorator
@external("env", "console.logf")
export declare function logf(
  msg: string,
  p1?: f64,
  p2?: f64,
  p3?: f64,
  p4?: f64
): void;

/**
 * Log a warning message to the HTML console panel
 * @param msg String literal to log (no allocations)
 */
// @ts-expect-error AssemblyScript decorator
@external("env", "console.warn")
export declare function warn(msg: string): void;

/**
 * Log a warning with integer parameters
 * Use {} as placeholders for parameters
 * @param msg String literal with {} placeholders
 * @example warni("Low health: {}", health)
 */
// @ts-expect-error AssemblyScript decorator
@external("env", "console.warni")
export declare function warni(
  msg: string,
  p1?: i64,
  p2?: i64,
  p3?: i64,
  p4?: i64
): void;

/**
 * Log a warning with floating-point parameters
 * Use {} as placeholders for parameters
 * @param msg String literal with {} placeholders
 * @example warnf("Low speed: {}", velocity)
 */
// @ts-expect-error AssemblyScript decorator
@external("env", "console.warnf")
export declare function warnf(
  msg: string,
  p1?: f64,
  p2?: f64,
  p3?: f64,
  p4?: f64
): void;

/**
 * Log an error message to the HTML console panel
 * @param msg String literal to log (no allocations)
 */
// @ts-expect-error AssemblyScript decorator
@external("env", "console.error")
export declare function error(msg: string): void;

/**
 * Log an error with integer parameters
 * Use {} as placeholders for parameters
 * @param msg String literal with {} placeholders
 * @example errori("Invalid state: {}", state)
 */
// @ts-expect-error AssemblyScript decorator
@external("env", "console.errori")
export declare function errori(
  msg: string,
  p1?: i64,
  p2?: i64,
  p3?: i64,
  p4?: i64
): void;

/**
 * Log an error with floating-point parameters
 * Use {} as placeholders for parameters
 * @param msg String literal with {} placeholders
 * @example errorf("Invalid position: {}", x)
 */
// @ts-expect-error AssemblyScript decorator
@external("env", "console.errorf")
export declare function errorf(
  msg: string,
  p1?: f64,
  p2?: f64,
  p3?: f64,
  p4?: f64
): void;
