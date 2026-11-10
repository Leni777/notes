<?php
// API appky Poznámky. Volá se jako server/index.php?r=/api/<cesta>&další=parametry
// (na WEDOS kořenový .htaccess posílá neexistující cesty na index.html, proto přes skutečný soubor).
declare(strict_types=1);

require __DIR__ . '/lib/util.php';
require __DIR__ . '/lib/db.php';
require __DIR__ . '/lib/auth.php';
require __DIR__ . '/lib/docs.php';
require __DIR__ . '/lib/push.php';

/** Konfigurace ze server/env.json (není v gitu, na hosting se nahrává zvlášť). */
function env(string $key, $default = null)
{
    static $env = null;
    if ($env === null) {
        $env = json_decode((string) @file_get_contents(getenv('NOTES_ENV') ?: __DIR__ . '/env.json'), true);
        if (!is_array($env)) {
            throw new RuntimeException('Chybí nebo je poškozený server/env.json');
        }
        if (getenv('NOTES_DB_NAME')) {  // lokální testy proti samostatné databázi
            $env['db']['name'] = getenv('NOTES_DB_NAME');
        }
    }
    return $env[$key] ?? $default;
}

function tz(): string
{
    return (string) env('timezone', 'Europe/Prague');
}

$routes = [];
function route(string $method, string $path, callable $h): void
{
    global $routes;
    $routes[] = [$method, '#^' . preg_replace('#:(\w+)#', '(?P<$1>[^/]+)', $path) . '$#', $h];
}

// ------------------------------------------------------------------ přihlášení

route('POST', '/api/login', function () {
    $in = read_json();
    $user = check_login(is_string($in['login'] ?? null) ? $in['login'] : '', is_string($in['password'] ?? null) ? $in['password'] : '');
    set_session_cookie($user);
    return ['user' => user_public($user)];
});

route('POST', '/api/logout', function () {
    clear_session_cookie();
    return ['ok' => true];
});

route('GET', '/api/me', function () {
    $me = me();
    sync_env_users();
    return ['user' => user_public($me), 'users' => all_users(), 'today' => today_local(tz()),
        'push' => ['key' => vapid_keys()['public'], 'devices' => my_devices()]];
});

route('PUT', '/api/me/password', function () {
    $in = read_json();
    $u = change_password(is_string($in['old'] ?? null) ? $in['old'] : '', is_string($in['new'] ?? null) ? $in['new'] : '');
    set_session_cookie($u);  // na tomto zařízení zůstat přihlášený, ostatní se odhlásí
    return ['ok' => true];
});

// ------------------------------------------------------------------ strom, složky

route('GET', '/api/tree', function () {
    me();
    return tree();
});

route('POST', '/api/folders', function () {
    me();
    return ['folder' => folder_create(read_json())];
});

route('PUT', '/api/folders/:id', function ($p) {
    me();
    return ['folder' => folder_update(int_id($p['id'], 'id'), read_json())];
});

route('DELETE', '/api/folders/:id', function ($p) {
    me();
    folder_delete(int_id($p['id'], 'id'));
    return ['ok' => true];
});

route('POST', '/api/folders/:id/restore', function ($p) {
    me();
    return ['folder' => folder_restore(int_id($p['id'], 'id'))];
});

// ------------------------------------------------------------------ dokumenty

route('POST', '/api/docs', function () {
    me();
    return ['doc' => doc_create(read_json())];
});

route('GET', '/api/docs/:id', function ($p) {
    me();
    return ['doc' => doc_full(int_id($p['id'], 'id'))];
});

route('PUT', '/api/docs/:id', function ($p) {
    me();
    return ['doc' => doc_update(int_id($p['id'], 'id'), read_json())];
});

route('DELETE', '/api/docs/:id', function ($p) {
    me();
    doc_delete(int_id($p['id'], 'id'));
    return ['ok' => true];
});

route('POST', '/api/docs/:id/restore', function ($p) {
    me();
    return ['doc' => doc_restore(int_id($p['id'], 'id'))];
});

route('POST', '/api/docs/:id/duplicate', function ($p) {
    me();
    return ['doc' => doc_duplicate(int_id($p['id'], 'id'))];
});

route('POST', '/api/docs/:id/ping', function ($p) {
    me();
    $in = json_decode(raw_body(), true);
    return ['doc' => doc_ping(int_id($p['id'], 'id'), !empty($in['editing']))];
});

route('POST', '/api/docs/:id/leave', function ($p) {
    me();
    doc_leave(int_id($p['id'], 'id'));
    return ['ok' => true];
});

route('GET', '/api/docs/:id/revisions', function ($p) {
    me();
    return ['revisions' => revisions(int_id($p['id'], 'id'))];
});

route('GET', '/api/revisions/:id', function ($p) {
    me();
    return ['revision' => revision(int_id($p['id'], 'id'))];
});

route('POST', '/api/revisions/:id/restore', function ($p) {
    me();
    return ['doc' => revision_restore(int_id($p['id'], 'id'))];
});

route('GET', '/api/search', function () {
    me();
    return ['results' => search(is_string($_GET['q'] ?? null) ? $_GET['q'] : '')];
});

// ------------------------------------------------------------------ koš

route('GET', '/api/trash', function () {
    me();
    return trash();
});

route('DELETE', '/api/trash/docs/:id', function ($p) {
    me();
    doc_purge(int_id($p['id'], 'id'));
    return ['ok' => true];
});

route('DELETE', '/api/trash/folders/:id', function ($p) {
    me();
    folder_purge(int_id($p['id'], 'id'));
    return ['ok' => true];
});

route('DELETE', '/api/trash', function () {
    me();
    return ['deleted' => trash_empty()];
});

// ------------------------------------------------------------------ obrázky

route('POST', '/api/images', function () {
    me();
    return image_upload();
});

route('GET', '/api/img/:id', function ($p) {
    image_serve(int_id($p['id'], 'id'));
    return null;  // odpověď už je odeslaná (soubor)
});

// ------------------------------------------------------------------ záloha

route('GET', '/api/backup', function () {
    me();
    header('Content-Disposition: attachment; filename="poznamky-zaloha-' . today_local(tz()) . '.json"');
    return backup();
});

// ------------------------------------------------------------------ upozornění

route('POST', '/api/push/subscribe', function () {
    push_subscribe(read_json(), my_id());
    return ['ok' => true, 'devices' => my_devices()];
});

route('POST', '/api/push/unsubscribe', function () {
    me();
    push_unsubscribe(read_json());
    return ['ok' => true, 'devices' => my_devices()];
});

route('POST', '/api/push/test', function () {
    me();
    return ['results' => push_to_users([my_id()], ['title' => 'Poznámky', 'body' => 'Upozornění fungují 🎉', 'tag' => 'test', 'url' => './#/nastaveni'])];
});

route('GET', '/api/push/status', function () {
    me();
    return ['devices' => q_all('SELECT id, ua, created_at, last_ok, last_error FROM notes_push_subs WHERE user_id = ? ORDER BY id', [my_id()]),
        'cron' => json_decode((string) kv_get('cron_last'), true)];
});

// plánovač (cron-job.org každých pár minut, token v adrese); quiet = kolik sekund klidu po poslední úpravě
route('GET', '/api/cron', function () {
    require_token('cron_token');
    $quiet = isset($_GET['quiet']) && ctype_digit((string) $_GET['quiet']) ? (int) $_GET['quiet'] : 180;
    return run_notifications($quiet);
});

// ------------------------------------------------------------------ obsluha požadavku

function handle(): void
{
    global $routes;
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $path = is_string($_GET['r'] ?? null) ? $_GET['r'] : '';
    foreach ($routes as [$m, $re, $h]) {
        if ($m === $method && preg_match($re, $path, $mm)) {
            $params = array_filter($mm, 'is_string', ARRAY_FILTER_USE_KEY);
            try {
                $out = $h($params);
            } catch (PDOException $e) {
                if (!is_missing_table($e)) {
                    throw $e;
                }
                ensure_schema();  // první spuštění: založit tabulky a zkusit znovu
                $out = $h($params);
            }
            if ($out !== null) {
                json_out($out);
            }
            return;
        }
    }
    throw new HttpError(404, 'Nenalezeno');
}

try {
    handle();
} catch (HttpError $e) {
    json_out(['error' => $e->getMessage()] + $e->data, $e->status);
} catch (Throwable $e) {
    error_log('notes: ' . $e);
    json_out(['error' => 'Chyba serveru'] + (has_session_safe() ? ['detail' => get_class($e) . ': ' . $e->getMessage()] : []), 500);
}

/** Podrobnosti chyby jen pro přihlášené. */
function has_session_safe(): bool
{
    try {
        return session_user() !== null;
    } catch (Throwable $e) {
        return false;
    }
}
