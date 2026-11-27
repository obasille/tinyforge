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
//   GET  /__tf/ai/github/tree            the project's files on the web branch (made from
//                                        the base branch the first time): { head, files }
//   GET  /__tf/ai/github/blob/<sha>      a file's bytes, by Git blob SHA (never changes)
//   POST /__tf/ai/github/commit          { base, message, changes: [{ path, content? }] }: one
//                                        commit on the web branch; 409 when it moved
//
// The GitHub token stays here too. Only writable project paths (games/<name>/,
// assets/<kind>/) can be committed, only to the web branch, and never with
// force: a branch that moved since `base` is a conflict, not an overwrite.
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
const GITHUB_API = 'https://api.github.com';
/** Where project paths live in the repository (packages/engine/tooling/compile-game.ts). */
const REPO_DIRS = [
    'games/' => 'packages/engine/assembly/games/',
    'engine/sdk/' => 'packages/engine/assembly/sdk/',
    'engine/memory-map.ts' => 'packages/engine/memory-map.ts',
    'assets/sprites/' => 'assets/sprites/',
    'assets/sfx/' => 'assets/sfx/',
    'assets/music/' => 'assets/music/',
];
const MAX_COMMIT_FILES = 200;

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
function check_request(array $config, bool $needHeader = true): void
{
    $https = ($_SERVER['HTTPS'] ?? '') === 'on' || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    if (!$https && empty($config['allow_http'])) throw new HttpError(403, 'HTTPS only');
    if ($needHeader && header_value('X-TinyForge') !== '1') throw new HttpError(403, 'Missing x-tinyforge header');
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

// ---- GitHub: the project on the web branch ----

function github_ready(array $config): bool
{
    return !empty($config['github_token']) && !empty($config['github_repo'])
        && preg_match('#^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$#', (string) $config['github_repo']) === 1;
}

function github_branch(array $config): string
{
    return (string) ($config['github_branch'] ?? 'web');
}

/** A GitHub API call. Returns [status, decoded body]; raw bytes when $raw. */
function github(array $config, string $method, string $path, ?array $body = null, bool $raw = false): array
{
    $ch = curl_init(((string) ($config['github_api'] ?? GITHUB_API)) . $path);
    $headers = [
        'Authorization: Bearer ' . $config['github_token'],
        'Accept: ' . ($raw ? 'application/vnd.github.raw' : 'application/vnd.github+json'),
        'X-GitHub-Api-Version: 2022-11-28',
        'User-Agent: TinyForge-editor',
    ];
    if ($body !== null) $headers[] = 'Content-Type: application/json';
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_TIMEOUT => 120,
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    $out = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($out === false) throw new HttpError(502, 'Could not reach GitHub');
    if ($raw) return [$status, $out];
    return [$status, json_decode((string) $out, true)];
}

/** GitHub refused: say why in a few words, never echo the response. */
function github_fail(int $status, string $what): HttpError
{
    if ($status === 401) return new HttpError(502, "GitHub refused the token ($what). Run pnpm ai:setup with a valid one.");
    if ($status === 403 || $status === 429) return new HttpError(503, "GitHub limit reached or access denied ($what). Try again later.");
    if ($status === 404) return new HttpError(502, "GitHub: not found ($what). Check the repository and the token's access.");
    return new HttpError(502, "GitHub error $status ($what)");
}

/** The web branch's head commit, made from the base branch if it does not exist. */
function github_head(array $config): string
{
    $repo = $config['github_repo'];
    $branch = rawurlencode(github_branch($config));
    [$status, $ref] = github($config, 'GET', "/repos/$repo/git/ref/heads/$branch");
    if ($status === 200) return (string) $ref['object']['sha'];
    if ($status !== 404) throw github_fail($status, 'read the branch');
    $base = rawurlencode((string) ($config['github_base'] ?? 'master'));
    [$status, $baseRef] = github($config, 'GET', "/repos/$repo/git/ref/heads/$base");
    if ($status !== 200) throw github_fail($status, 'read the base branch');
    $sha = (string) $baseRef['object']['sha'];
    [$status] = github($config, 'POST', "/repos/$repo/git/refs", ['ref' => 'refs/heads/' . github_branch($config), 'sha' => $sha]);
    if ($status !== 201 && $status !== 422) throw github_fail($status, 'create the branch');
    return $status === 201 ? $sha : github_head($config);
}

/** The project path of a repository path, or null. */
function project_path(string $repoPath): ?string
{
    foreach (REPO_DIRS as $project => $repo) {
        if ($repoPath === $repo && !str_ends_with($repo, '/')) return $project;
        if (str_ends_with($repo, '/') && str_starts_with($repoPath, $repo)) {
            $p = $project . substr($repoPath, strlen($repo));
            return valid_project_path($p) ? $p : null;
        }
    }
    return null;
}

/** The repository path of a project path, or null. */
function repo_path(string $projectPath): ?string
{
    if (!valid_project_path($projectPath)) return null;
    foreach (REPO_DIRS as $project => $repo) {
        if ($projectPath === $project && !str_ends_with($project, '/')) return $repo;
        if (str_ends_with($project, '/') && str_starts_with($projectPath, $project)) {
            return $repo . substr($projectPath, strlen($project));
        }
    }
    return null;
}

/** packages/engine/tooling/project-layout.ts isProjectPath. */
function valid_project_path(string $p): bool
{
    if ($p === '' || strlen($p) > 512 || str_contains($p, '\\') || preg_match('/[\x00-\x1f\x7f]/', $p)) return false;
    foreach (explode('/', $p) as $segment) {
        if ($segment === '' || $segment[0] === '.') return false;
    }
    return true;
}

/** project-layout.ts isWritablePath: games/<name>/... and assets/<kind>/... only. */
function writable_path(string $p): bool
{
    if (!valid_project_path($p)) return false;
    $parts = explode('/', $p);
    if ($parts[0] === 'games') return count($parts) >= 3 && preg_match('/^[A-Za-z0-9_-]+$/', $parts[1]) === 1;
    if ($parts[0] === 'assets') return count($parts) >= 3 && in_array($parts[1], ['sprites', 'sfx', 'music'], true);
    return false;
}

function github_route(array $config, string $route, string $method): void
{
    if (!logged_in($config)) throw new HttpError(401, 'Log in first');
    if (!github_ready($config)) throw new HttpError(503, 'Saving to GitHub is not set up. Run pnpm ai:setup with EDITOR_GITHUB_TOKEN.');
    $repo = $config['github_repo'];

    if ($route === 'tree' && $method === 'GET') {
        $head = github_head($config);
        [$status, $tree] = github($config, 'GET', "/repos/$repo/git/trees/$head?recursive=1");
        if ($status !== 200) throw github_fail($status, 'list the files');
        $files = [];
        foreach ($tree['tree'] ?? [] as $item) {
            if (($item['type'] ?? '') !== 'blob') continue;
            $p = project_path((string) $item['path']);
            if ($p !== null) $files[] = ['path' => $p, 'size' => (int) ($item['size'] ?? 0), 'sha' => (string) $item['sha']];
        }
        send_json(200, ['head' => $head, 'truncated' => !empty($tree['truncated']), 'files' => $files]);
        return;
    }

    if (str_starts_with($route, 'blob/') && $method === 'GET') {
        $sha = substr($route, strlen('blob/'));
        if (!preg_match('/^[0-9a-f]{40}$/', $sha)) throw new HttpError(400, 'Bad blob id');
        [$status, $bytes] = github($config, 'GET', "/repos/$repo/git/blobs/$sha", null, true);
        if ($status !== 200) throw github_fail($status, 'read a file');
        http_response_code(200);
        header('Content-Type: application/octet-stream');
        // A blob's id is its content's hash: it never changes.
        header('Cache-Control: private, max-age=31536000, immutable');
        echo $bytes;
        return;
    }

    if ($route === 'commit' && $method === 'POST') {
        rate_limit($config, 'commits', 120);
        $input = json_decode(read_body(), true);
        if (!is_array($input) || !is_string($input['base'] ?? null) || !is_array($input['changes'] ?? null)) {
            throw new HttpError(400, 'Expected { base, message, changes }');
        }
        $base = $input['base'];
        if (!preg_match('/^[0-9a-f]{40}$/', $base)) throw new HttpError(400, 'Bad base commit');
        $changes = $input['changes'];
        if (count($changes) === 0 || count($changes) > MAX_COMMIT_FILES) throw new HttpError(400, 'Between 1 and ' . MAX_COMMIT_FILES . ' files per commit');

        // Someone else committed since the editor read the branch: never overwrite.
        $head = github_head($config);
        if ($head !== $base) {
            send_json(409, ['error' => 'The web branch changed since the editor read it.', 'head' => $head]);
            return;
        }
        [$status, $commit] = github($config, 'GET', "/repos/$repo/git/commits/$base");
        if ($status !== 200) throw github_fail($status, 'read the commit');

        $tree = [];
        $blobs = [];
        foreach ($changes as $change) {
            $path = is_array($change) ? (string) ($change['path'] ?? '') : '';
            if (!writable_path($path)) throw new HttpError(403, "Not writable: " . substr($path, 0, 100));
            $repoPath = repo_path($path);
            if (array_key_exists('content', $change) && $change['content'] !== null) {
                [$status, $blob] = github($config, 'POST', "/repos/$repo/git/blobs", ['content' => (string) $change['content'], 'encoding' => 'base64']);
                if ($status !== 201) throw github_fail($status, 'store a file');
                $blobs[$path] = (string) $blob['sha'];
                $tree[] = ['path' => $repoPath, 'mode' => '100644', 'type' => 'blob', 'sha' => $blobs[$path]];
            } else {
                $tree[] = ['path' => $repoPath, 'mode' => '100644', 'type' => 'blob', 'sha' => null];
            }
        }
        [$status, $newTree] = github($config, 'POST', "/repos/$repo/git/trees", ['base_tree' => $commit['tree']['sha'], 'tree' => $tree]);
        if ($status !== 201) throw github_fail($status, 'build the commit');
        // Nothing changed (the files were already like this): no empty commit.
        if ($newTree['sha'] === $commit['tree']['sha']) {
            send_json(200, ['head' => $base, 'blobs' => (object) $blobs]);
            return;
        }
        $message = substr(trim((string) ($input['message'] ?? '')), 0, 2000) ?: 'Edit from the TinyForge editor';
        [$status, $newCommit] = github($config, 'POST', "/repos/$repo/git/commits", [
            'message' => $message,
            'tree' => $newTree['sha'],
            'parents' => [$base],
        ]);
        if ($status !== 201) throw github_fail($status, 'commit');
        $branch = rawurlencode(github_branch($config));
        [$status] = github($config, 'PATCH', "/repos/$repo/git/refs/heads/$branch", ['sha' => $newCommit['sha'], 'force' => false]);
        if ($status === 422) {
            send_json(409, ['error' => 'The web branch changed while saving.', 'head' => github_head($config)]);
            return;
        }
        if ($status !== 200) throw github_fail($status, 'move the branch');
        send_json(200, ['head' => (string) $newCommit['sha'], 'blobs' => (object) $blobs]);
        return;
    }
    throw new HttpError(404, 'Not found');
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
    // A game Worker fetches assets by URL and cannot add the header. Blobs are
    // the repository's own (public) file contents, and still need the login.
    $isBlob = $method === 'GET' && str_starts_with($route, 'github/blob/');
    check_request($config, !$isBlob);

    if ($route === 'status' && $method === 'GET') {
        if (!logged_in($config)) {
            send_json(200, ['providers' => [], 'login' => 'password']);
            return;
        }
        $status = [
            'providers' => [['id' => 'anthropic', 'models' => MODELS, 'defaultModel' => DEFAULT_MODEL]],
            'session' => true,
        ];
        if (github_ready($config)) {
            $status['github'] = ['repo' => $config['github_repo'], 'branch' => github_branch($config)];
        }
        send_json(200, $status);
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
    if (str_starts_with($route, 'github/')) {
        github_route($config, substr($route, strlen('github/')), $method);
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
