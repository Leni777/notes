<?php
// Připojení k MySQL. Tabulky se při prvním použití založí samy podle server/schema.sql.
declare(strict_types=1);

function db(): PDO
{
    static $pdo = null;
    if ($pdo) {
        return $pdo;
    }
    $c = env('db');
    $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $c['host'], (int) ($c['port'] ?? 3306), $c['name']);
    $pdo = new PDO($dsn, $c['user'], $c['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::ATTR_STRINGIFY_FETCHES => false,
    ]);
    $pdo->exec("SET time_zone = '+00:00'");  // CURRENT_TIMESTAMP (created_at…) vždy v UTC, i když má server jiné pásmo
    return $pdo;
}

function ensure_schema(): void
{
    $sql = file_get_contents(__DIR__ . '/../schema.sql');
    $sql = preg_replace('/--.*$/m', '', $sql);
    foreach (array_filter(array_map('trim', explode(';', $sql))) as $stmt) {
        db()->exec($stmt);
    }
}

/** Je výjimka "tabulka neexistuje"? Pak stačí založit schéma a zopakovat požadavek. */
function is_missing_table(Throwable $e): bool
{
    return $e instanceof PDOException && ($e->getCode() === '42S02' || strpos($e->getMessage(), '1146') !== false);
}

function q(string $sql, array $params = []): PDOStatement
{
    $st = db()->prepare($sql);
    $st->execute(array_values($params));
    return $st;
}

function q_all(string $sql, array $params = []): array
{
    return q($sql, $params)->fetchAll();
}

function q_one(string $sql, array $params = []): ?array
{
    $r = q($sql, $params)->fetch();
    return $r === false ? null : $r;
}

function last_id(): int
{
    return (int) db()->lastInsertId();
}

/** Více příkazů v jedné transakci. */
function tx(callable $fn)
{
    $pdo = db();
    if ($pdo->inTransaction()) {
        return $fn();
    }
    $pdo->beginTransaction();
    try {
        $res = $fn();
        $pdo->commit();
        return $res;
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

function kv_get(string $name): ?string
{
    $r = q_one('SELECT value FROM notes_kv WHERE name = ?', [$name]);
    return $r ? $r['value'] : null;
}

function kv_set(string $name, ?string $value): void
{
    q('INSERT INTO notes_kv (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)', [$name, $value]);
}

/** Zapíše jen, když hodnota ještě neexistuje; vrátí platnou hodnotu (i při souběhu dvou požadavků). */
function kv_init(string $name, string $value): string
{
    q('INSERT IGNORE INTO notes_kv (name, value) VALUES (?, ?)', [$name, $value]);
    return (string) kv_get($name);
}
