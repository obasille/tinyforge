<?php
// The AI proxy of the deployed editor (https://tf.basille.net/__tf/ai/...).
// The same routes as the dev server's (apps/editor/vite/ai-proxy.ts), so the
// AI panel works the same way, plus a login. The Anthropic key stays on the
// server, in a config file written by `pnpm ai:setup`; it is never sent to
// the browser.
//
//   GET  /__tf/ai/status                 { providers, login?, session?, reason? }
//   POST /__tf/ai/login                  { password }: sets the session cookie
//   POST /__tf/ai/logout                 clears it
//   POST /__tf/ai/anthropic/v1/messages  forwarded to the Anthropic API with the key, streamed
//
// Every request needs HTTPS, the X-TinyForge header (another site cannot add
// it without a CORS preflight, which is never granted) and, when the browser
// sends one, this site's Origin. The session is an HMAC-signed cookie
// (HttpOnly, Secure, SameSite=Strict), so scripts cannot read it and other
// sites cannot send it. Only the models below are forwarded, and requests and
// failed logins are rate-limited.
//
// Written by apps/editor/vite/site-headers.ts at build time (the model list
// comes from packages/editor-core/src/ai/models.ts). No library.

declare(strict_types=1);

const MODELS = /*MODELS*/ [];
const DEFAULT_MODEL = /*DEFAULT_MODEL*/ '';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const COOKIE = 'tf_ai';
const SESSION_SECONDS = 30 * 24 * 3600;
const MAX_REQUESTS_PER_HOUR = 300;
const MAX_LOGIN_FAILURES_PER_HOUR = 10;
const MAX_BODY = 32 * 1024 * 1024;
/**
 * Some hosts (PHP-FPM behind Apache) hold the output until about 8 KB have
 * built up, so a streamed reply would arrive in chunks of about 100 words.
 * When nothing has gone out for FLUSH_MS, the proxy pads the stream with an
 * SSE comment line (which clients ignore) up to the next FLUSH_BYTES, so the
 * host sends what it has. Set 'stream_flush_bytes' => 0 in the config to turn
 * it off, or to the host's buffer size.
 */
const FLUSH_BYTES = 8192;
const FLUSH_MS = 200;
const SETUP = 'AI is not set up on this server. Run pnpm ai:setup on your computer.';

final class HttpError extends Exception
{
    public function __construct(public readonly int $status, string $message)
    {
        parent::__construct($message);
    }
}

function send_json(int $status, array $body): void
{
    http_response_code($status);
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    echo json_encode($body, JSON_UNESCAPED_SLASHES);
}

function send_text(int $status, string $message): void
{
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    echo $message;
}

/** The config file's path, or null. Outside the web root when the host allows it. */
function config_path(): ?string
{
    $root = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''), '/');
    $candidates = [
        getenv('TINYFORGE_AI_CONFIG') ?: null,
        dirname($root) . '/tinyforge-ai.php',
        $root . '/.private/tinyforge-ai.php',
    ];
    foreach ($candidates as $path) {
        if ($path !== null && is_file($path)) return $path;
    }
    return null;
}

/** The settings from `pnpm ai:setup`: anthropic_key, session_secret, password. */
function load_config(): ?array
{
    $path = config_path();
    if ($path === null) return null;
    $config = require $path;
    if (!is_array($config) || empty($config['anthropic_key']) || empty($config['session_secret'])) return null;
    $config['state_file'] = dirname($path) . '/tinyforge-ai-state.json';
    return $config;
}

function header_value(string $name): ?string
{
    $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    return isset($_SERVER[$key]) ? (string) $_SERVER[$key] : null;
}

/** HTTPS, the X-TinyForge header, and this site's Origin. */
function check_request(array $config): void
{
    $https = ($_SERVER['HTTPS'] ?? '') === 'on' || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    if (!$https && empty($config['allow_http'])) throw new HttpError(403, 'HTTPS only');
    if (header_value('X-TinyForge') !== '1') throw new HttpError(403, 'Missing x-tinyforge header');
    $origin = header_value('Origin');
    $host = (string) ($_SERVER['HTTP_HOST'] ?? '');
    if ($origin !== null && $origin !== "https://$host" && !(!empty($config['allow_http']) && $origin === "http://$host")) {
        throw new HttpError(403, 'AI routes answer only the editor itself');
    }
}

function b64url(string $bytes): string
{
    return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
}

function sign(array $config, string $payload): string
{
    return b64url(hash_hmac('sha256', $payload, (string) $config['session_secret'], true));
}

/** A signed cookie value that expires. */
function session_token(array $config): string
{
    $payload = b64url(json_encode(['exp' => time() + SESSION_SECONDS]));
    return $payload . '.' . sign($config, $payload);
}

function logged_in(array $config): bool
{
    $token = (string) ($_COOKIE[COOKIE] ?? '');
    $parts = explode('.', $token);
    if (count($parts) !== 2 || !hash_equals(sign($config, $parts[0]), $parts[1])) return false;
    $data = json_decode((string) base64_decode(strtr($parts[0], '-_', '+/')), true);
    return is_array($data) && is_int($data['exp'] ?? null) && $data['exp'] > time();
}

function set_cookie(array $config, string $value, int $expires): void
{
    setcookie(COOKIE, $value, [
        'expires' => $expires,
        'path' => '/__tf/ai/',
        'secure' => empty($config['allow_http']),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

/**
 * Count an event of `kind` and refuse when there were `limit` in the last hour.
 * The state file sits next to the config, locked while it is read and written.
 */
function rate_limit(array $config, string $kind, int $limit, bool $count = true): void
{
    $file = fopen($config['state_file'], 'c+');
    if ($file === false) throw new HttpError(500, 'Cannot write the rate limit state');
    try {
        flock($file, LOCK_EX);
        $state = json_decode((string) stream_get_contents($file), true) ?: [];
        $since = time() - 3600;
        $events = array_values(array_filter($state[$kind] ?? [], fn($t) => is_int($t) && $t > $since));
        if (count($events) >= $limit) throw new HttpError(429, 'Too many requests; try again later');
        if ($count) $events[] = time();
        $state[$kind] = $events;
        ftruncate($file, 0);
        rewind($file);
        fwrite($file, json_encode($state));
    } finally {
        flock($file, LOCK_UN);
        fclose($file);
    }
}

function forget_failures(array $config): void
{
    $file = fopen($config['state_file'], 'c+');
    if ($file === false) return;
    flock($file, LOCK_EX);
    $state = json_decode((string) stream_get_contents($file), true) ?: [];
    unset($state['login']);
    ftruncate($file, 0);
    rewind($file);
    fwrite($file, json_encode($state));
    flock($file, LOCK_UN);
    fclose($file);
}

function read_body(): string
{
    $length = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($length > MAX_BODY) throw new HttpError(413, 'Request too large');
    $body = (string) file_get_contents('php://input');
    if ($length > 0 && $body === '') throw new HttpError(413, 'Request too large for this server (post_max_size)');
    return $body;
}

function check_password(array $config, string $password): bool
{
    $p = $config['password'] ?? null;
    if (!is_array($p)) return false;
    $hash = hash_pbkdf2('sha256', $password, (string) base64_decode((string) $p['salt']), (int) $p['iterations'], 32, true);
    return hash_equals((string) base64_decode((string) $p['hash']), $hash);
}

/** Send the request to Anthropic and stream the reply back as it arrives. */
function forward(array $config, string $body): void
{
    $headers = [
        'content-type: application/json',
        'x-api-key: ' . $config['anthropic_key'],
    ];
    $version = header_value('anthropic-version');
    $headers[] = 'anthropic-version: ' . ($version !== null && preg_match('/^\d{4}-\d{2}-\d{2}$/', $version) ? $version : '2023-06-01');
    $beta = header_value('anthropic-beta');
    if ($beta !== null && preg_match('/^[a-z0-9-]+(,[a-z0-9-]+)*$/', $beta)) $headers[] = "anthropic-beta: $beta";

    // No buffering or compression anywhere between here and the browser.
    @ini_set('zlib.output_compression', '0');
    if (function_exists('apache_setenv')) {
        @apache_setenv('no-gzip', '1');
        @apache_setenv('no-brotli', '1');
    }
    while (ob_get_level() > 0) ob_end_flush();
    @set_time_limit(0);
    header('Cache-Control: no-store');
    header('X-Accel-Buffering: no');

    $flushBytes = (int) ($config['stream_flush_bytes'] ?? FLUSH_BYTES);
    $stream = ['sse' => false, 'pending' => '', 'sent' => 0, 'last' => microtime(true)];

    $ch = curl_init((string) ($config['anthropic_url'] ?? ANTHROPIC_URL));
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_TIMEOUT => 900,
        // Only these response headers go back to the page.
        CURLOPT_HEADERFUNCTION => function ($ch, string $line) use (&$stream): int {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m)) {
                http_response_code((int) $m[1]);
            } elseif (preg_match('/^(content-type|retry-after|request-id):\s*(.+?)\s*$/i', $line, $m)) {
                header($m[1] . ': ' . $m[2]);
                if (strtolower($m[1]) === 'content-type' && str_starts_with(strtolower($m[2]), 'text/event-stream')) {
                    $stream['sse'] = true;
                }
            }
            return strlen($line);
        },
        CURLOPT_WRITEFUNCTION => function ($ch, string $data) use (&$stream, $flushBytes): int {
            if (!$stream['sse'] || $flushBytes <= 0) {
                echo $data;
            } else {
                // Whole events only, so padding never lands inside one.
                $stream['pending'] .= $data;
                $end = strrpos($stream['pending'], "\n\n");
                if ($end !== false) {
                    $out = substr($stream['pending'], 0, $end + 2);
                    $stream['pending'] = substr($stream['pending'], $end + 2);
                    $now = microtime(true);
                    if (($now - $stream['last']) * 1000 >= FLUSH_MS) {
                        $fill = $flushBytes - (($stream['sent'] + strlen($out)) % $flushBytes);
                        if ($fill >= 3) $out .= ':' . str_repeat(' ', $fill - 2) . "\n";
                        $stream['last'] = $now;
                    }
                    $stream['sent'] += strlen($out);
                    echo $out;
                }
            }
            flush();
            // Stop the upstream request when the page goes away.
            return connection_aborted() ? 0 : strlen($data);
        },
    ]);
    $ok = curl_exec($ch);
    if ($stream['pending'] !== '') {
        echo $stream['pending'];
        flush();
    }
    if ($ok === false && !headers_sent() && !connection_aborted()) {
        send_text(502, 'Could not reach the Anthropic API');
    }
    curl_close($ch);
}

function handle(): void
{
    $path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
    $at = strpos($path, '/__tf/ai/');
    $route = $at === false ? '' : substr($path, $at + strlen('/__tf/ai/'));
    $method = (string) ($_SERVER['REQUEST_METHOD'] ?? 'GET');

    $config = load_config();
    if ($config === null) {
        if ($route === 'status' && $method === 'GET') {
            send_json(200, ['providers' => [], 'reason' => SETUP]);
            return;
        }
        throw new HttpError(503, SETUP);
    }
    check_request($config);

    if ($route === 'status' && $method === 'GET') {
        if (!logged_in($config)) {
            send_json(200, ['providers' => [], 'login' => 'password']);
            return;
        }
        send_json(200, [
            'providers' => [['id' => 'anthropic', 'models' => MODELS, 'defaultModel' => DEFAULT_MODEL]],
            'session' => true,
        ]);
        return;
    }
    if ($route === 'login' && $method === 'POST') {
        rate_limit($config, 'login', MAX_LOGIN_FAILURES_PER_HOUR, false);
        $input = json_decode(read_body(), true);
        $password = is_array($input) ? (string) ($input['password'] ?? '') : '';
        if (!check_password($config, $password)) {
            rate_limit($config, 'login', MAX_LOGIN_FAILURES_PER_HOUR);
            throw new HttpError(401, 'Wrong password');
        }
        forget_failures($config);
        set_cookie($config, session_token($config), time() + SESSION_SECONDS);
        send_json(200, ['ok' => true]);
        return;
    }
    if ($route === 'logout' && $method === 'POST') {
        set_cookie($config, '', time() - 3600);
        send_json(200, ['ok' => true]);
        return;
    }
    if ($route === 'anthropic/v1/messages' && $method === 'POST') {
        if (!logged_in($config)) throw new HttpError(401, 'Log in to use the AI');
        rate_limit($config, 'requests', MAX_REQUESTS_PER_HOUR);
        $body = read_body();
        $request = json_decode($body, true);
        if (!is_array($request)) throw new HttpError(400, 'Invalid JSON');
        $model = $request['model'] ?? null;
        if (!is_string($model) || !in_array($model, MODELS, true)) {
            throw new HttpError(400, 'Model not allowed: ' . (is_string($model) ? substr($model, 0, 60) : 'none'));
        }
        forward($config, $body);
        return;
    }
    throw new HttpError(404, 'Not found');
}

try {
    handle();
} catch (HttpError $e) {
    if (!headers_sent()) send_text($e->status, $e->getMessage());
} catch (Throwable $e) {
    // Never echo details: they could hold a path or a setting.
    if (!headers_sent()) send_text(500, 'AI proxy error');
}
