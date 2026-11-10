<?php
// Přihlášení jménem a heslem (podepsaná cookie na rok) a token pro plánovač upozornění.
// Uživatelé jsou v server/env.json („users“) – odtud se při přihlášení zapíšou do tabulky notes_users.
// Heslo změněné v appce platí, dokud se v env.json nenastaví novější (make_env.py, „zapomenuté heslo“).
declare(strict_types=1);

const SESSION_COOKIE = 'nts';
const SESSION_DAYS = 365;

/** Cesta appky z URL požadavku: /notes/server/index.php → /notes/ (lokálně /). */
function app_base_path(): string
{
    $u = (string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    $pos = strpos($u, '/server/index.php');
    return $pos === false ? '/' : substr($u, 0, $pos) . '/';
}

/** Otisk hesla v cookie: po změně hesla přestanou platit přihlášení na ostatních zařízeních. */
function password_mark(array $user): string
{
    return substr(hash('sha256', (string) $user['password_hash']), 0, 12);
}

function set_session_cookie(array $user): void
{
    $payload = b64url((string) json_encode(['u' => (int) $user['id'], 'p' => password_mark($user), 'exp' => time() + SESSION_DAYS * 86400]));
    $sig = b64url(hash_hmac('sha256', $payload, env('session_secret'), true));
    setcookie(SESSION_COOKIE, "$payload.$sig", [
        'expires' => time() + SESSION_DAYS * 86400,
        'path' => app_base_path(),  // na app.makuderovi.cz sdílí doménu víc appek
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function clear_session_cookie(): void
{
    setcookie(SESSION_COOKIE, '', ['expires' => 1, 'path' => app_base_path(), 'secure' => true, 'httponly' => true, 'samesite' => 'Lax']);
}

/** Přihlášený uživatel podle cookie, nebo null. */
function session_user(): ?array
{
    static $done = false;
    static $user = null;
    if (!$done) {
        $user = session_user_load();
        $done = true;  // až po úspěšném dotazu (při prvním spuštění se tabulky zakládají a požadavek opakuje)
    }
    return $user;
}

function session_user_load(): ?array
{
    $parts = explode('.', (string) ($_COOKIE[SESSION_COOKIE] ?? ''));
    if (count($parts) !== 2) {
        return null;
    }
    [$payload, $sig] = $parts;
    $expected = b64url(hash_hmac('sha256', $payload, env('session_secret'), true));
    if (!hash_equals($expected, $sig)) {
        return null;
    }
    $data = json_decode(b64url_decode($payload), true);
    if (!is_array($data) || !is_int($data['u'] ?? null) || !is_numeric($data['exp'] ?? null) || $data['exp'] < time()) {
        return null;
    }
    $user = q_one('SELECT * FROM notes_users WHERE id = ?', [$data['u']]);
    return $user && hash_equals(password_mark($user), (string) ($data['p'] ?? '')) ? $user : null;
}

function me(): array
{
    $u = session_user();
    if (!$u) {
        throw new HttpError(401, 'Nepřihlášeno');
    }
    return $u;
}

function my_id(): int
{
    return (int) me()['id'];
}

/** Veřejné údaje o uživateli (bez hesla). */
function user_public(array $u): array
{
    return ['id' => (int) $u['id'], 'login' => $u['login'], 'name' => $u['name'], 'female' => (bool) $u['female'], 'color' => $u['color']];
}

function all_users(): array
{
    return array_map('user_public', q_all('SELECT * FROM notes_users ORDER BY id'));
}

/** Uživatel z env.json → tabulka (založí ho, nebo převezme novější heslo, jméno a barvu). */
function sync_env_user(string $login): ?array
{
    $users = env('users', []);
    $e = is_array($users) ? ($users[$login] ?? null) : null;
    $row = q_one('SELECT * FROM notes_users WHERE login = ?', [$login]);
    if (!is_array($e) || empty($e['password_hash'])) {
        return $row;
    }
    $at = gmdate('Y-m-d H:i:s', strtotime((string) ($e['password_at'] ?? '2000-01-01T00:00:00Z')) ?: 0);
    $name = mb_substr((string) ($e['name'] ?? ucfirst($login)), 0, 60);
    $female = !empty($e['female']) ? 1 : 0;
    $color = preg_match('/^#[0-9a-f]{6}$/i', (string) ($e['color'] ?? '')) ? strtolower($e['color']) : '#c2185b';
    if (!$row) {
        q('INSERT IGNORE INTO notes_users (login, name, female, color, password_hash, password_at) VALUES (?, ?, ?, ?, ?, ?)',
            [$login, $name, $female, $color, $e['password_hash'], $at]);
    } else {
        q('UPDATE notes_users SET name = ?, female = ?, color = ? WHERE id = ?', [$name, $female, $color, $row['id']]);
        if ($at > $row['password_at']) {
            q('UPDATE notes_users SET password_hash = ?, password_at = ? WHERE id = ?', [$e['password_hash'], $at, $row['id']]);
        }
    }
    return q_one('SELECT * FROM notes_users WHERE login = ?', [$login]);
}

/** Všechny uživatele z env.json do tabulky (aby byli vidět i ti, kdo se ještě nepřihlásili). */
function sync_env_users(): void
{
    $users = env('users', []);
    if (is_array($users)) {
        foreach (array_keys($users) as $login) {
            sync_env_user((string) $login);
        }
    }
}

/** Ochrana proti hádání hesla: max. 10 chybných pokusů za 15 minut. Vrací přihlášeného uživatele. */
function check_login(string $login, string $password): array
{
    $raw = kv_get('login_fail');
    $fail = $raw ? json_decode($raw, true) : null;
    if (!is_array($fail) || time() - (int) ($fail['since'] ?? 0) > 15 * 60) {
        $fail = ['n' => 0, 'since' => time()];
    }
    if ($fail['n'] >= 10) {
        throw new HttpError(429, 'Příliš mnoho pokusů, zkus to za chvíli.');
    }
    $login = mb_strtolower(trim($login));
    $user = $login !== '' && preg_match('/^[a-z0-9._-]{1,40}$/', $login) ? sync_env_user($login) : null;
    if (!$user || !password_verify($password, (string) $user['password_hash'])) {
        $fail['n']++;
        kv_set('login_fail', json_encode($fail));
        throw new HttpError(401, 'Špatné jméno nebo heslo');
    }
    kv_set('login_fail', null);
    return $user;
}

function change_password(string $old, string $new): array
{
    $u = me();
    if (!password_verify($old, (string) $u['password_hash'])) {
        throw new HttpError(400, 'Současné heslo nesedí');
    }
    if (mb_strlen($new) < 6) {
        throw new HttpError(400, 'Nové heslo musí mít aspoň 6 znaků');
    }
    q('UPDATE notes_users SET password_hash = ?, password_at = ? WHERE id = ?', [password_hash($new, PASSWORD_DEFAULT), now_utc(), $u['id']]);
    return q_one('SELECT * FROM notes_users WHERE id = ?', [$u['id']]);
}

/** Token z hlavičky X-Api-Token, Authorization: Bearer, nebo z ?token= (cron umí jen adresu). */
function request_token(): string
{
    $h = (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
    if (preg_match('/^Bearer\s+(.+)$/i', trim($h), $m)) {
        return trim($m[1]);
    }
    $x = trim((string) ($_SERVER['HTTP_X_API_TOKEN'] ?? ''));
    if ($x !== '') {
        return $x;
    }
    return is_string($_GET['token'] ?? null) ? trim($_GET['token']) : '';
}

function require_token(string $envKey): void
{
    $expected = (string) env($envKey, '');
    if ($expected === '') {
        throw new HttpError(503, 'Token není nastavený');
    }
    $got = request_token();
    if ($got === '' || !hash_equals($expected, $got)) {
        throw new HttpError(401, 'Neplatný token');
    }
}
