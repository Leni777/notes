<?php
// Pomocné funkce: JSON odpovědi, chyby, časy v UTC.
declare(strict_types=1);

final class HttpError extends Exception
{
    public int $status;
    public array $data;

    /** $data se přidá do JSON odpovědi (např. aktuální dokument při souběžné úpravě). */
    public function __construct(int $status, string $message, array $data = [])
    {
        parent::__construct($message);
        $this->status = $status;
        $this->data = $data;
    }
}

function json_out($data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function utc(): DateTimeZone
{
    static $z = null;
    return $z ??= new DateTimeZone('UTC');
}





function today_local(string $tz): string
{
    return (new DateTimeImmutable('now', new DateTimeZone($tz)))->format('Y-m-d');
}


/** Teď v UTC ve formátu sloupců DATETIME. */
function now_utc(): string
{
    return gmdate('Y-m-d H:i:s');
}

/** UTC DATETIME z databáze → ISO 8601 se Z (pro prohlížeč). */
function utc_iso(?string $dt): ?string
{
    return $dt === null ? null : str_replace(' ', 'T', $dt) . 'Z';
}


/** Tělo požadavku (čte se jen jednou). */
function raw_body(): string
{
    static $raw = null;
    return $raw ??= (string) file_get_contents('php://input');
}

function read_json(): array
{
    $data = json_decode(raw_body(), true);
    if (!is_array($data)) {
        throw new HttpError(400, 'Neplatný JSON');
    }
    return $data;
}

function b64url(string $bin): string
{
    return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
}

function b64url_decode(string $s): string
{
    return (string) base64_decode(strtr($s, '-_', '+/'));
}
