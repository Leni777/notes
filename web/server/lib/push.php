<?php
// Upozornění přes Web Push (RFC 8030/8291/8292) bez knihoven: VAPID podpis ES256 a šifrování aes128gcm
// jen pomocí OpenSSL, které má PHP na hostingu vždy.
declare(strict_types=1);

/** Hlavička DER pro veřejný klíč P-256 (SubjectPublicKeyInfo), za ní následuje 65 bajtů bodu. */
const P256_SPKI_PREFIX = '3059301306072a8648ce3d020106082a8648ce3d030107034200';

/** Klíče VAPID: vygenerují se při prvním použití a uloží do databáze. */
function vapid_keys(): array
{
    $raw = kv_get('vapid');
    if (!$raw) {
        $k = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
        if (!$k || !openssl_pkey_export($k, $pem)) {
            throw new RuntimeException('OpenSSL neumí vytvořit klíč: ' . openssl_error_string());
        }
        $raw = kv_init('vapid', json_encode(['private_pem' => $pem, 'public' => b64url(ec_public_raw($k))]));
    }
    return json_decode($raw, true);
}

/** Veřejný klíč jako nekomprimovaný bod 0x04 || X || Y (65 bajtů). */
function ec_public_raw($key): string
{
    $d = openssl_pkey_get_details($key);
    return "\x04" . str_pad($d['ec']['x'], 32, "\0", STR_PAD_LEFT) . str_pad($d['ec']['y'], 32, "\0", STR_PAD_LEFT);
}

function ec_public_from_raw(string $raw)
{
    if (strlen($raw) !== 65 || $raw[0] !== "\x04") {
        throw new HttpError(400, 'Neplatný klíč zařízení');
    }
    $pem = "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode(hex2bin(P256_SPKI_PREFIX) . $raw), 64, "\n") . "-----END PUBLIC KEY-----\n";
    $k = openssl_pkey_get_public($pem);
    if (!$k) {
        throw new HttpError(400, 'Neplatný klíč zařízení');
    }
    return $k;
}

/** Podpis ECDSA z OpenSSL (DER) → 64 bajtů r || s, jak ho chce JWT. */
function der_to_jose(string $der): string
{
    $pos = 2;
    if (ord($der[1]) & 0x80) {
        $pos += ord($der[1]) & 0x7f;
    }
    $out = '';
    for ($i = 0; $i < 2; $i++) {
        $len = ord($der[$pos + 1]);
        $int = ltrim(substr($der, $pos + 2, $len), "\0");
        $out .= str_pad($int, 32, "\0", STR_PAD_LEFT);
        $pos += 2 + $len;
    }
    return $out;
}

function vapid_header(string $endpoint, array $keys, ?int $now = null): string
{
    $p = parse_url($endpoint);
    $aud = $p['scheme'] . '://' . $p['host'] . (isset($p['port']) ? ':' . $p['port'] : '');
    $head = b64url('{"typ":"JWT","alg":"ES256"}');
    $claims = b64url((string) json_encode(['aud' => $aud, 'exp' => ($now ?? time()) + 12 * 3600,
        'sub' => (string) env('vapid_subject', 'mailto:notes@makuderovi.cz')], JSON_UNESCAPED_SLASHES));
    if (!openssl_sign("$head.$claims", $der, openssl_pkey_get_private($keys['private_pem']), OPENSSL_ALGO_SHA256)) {
        throw new RuntimeException('Nepodařilo se podepsat VAPID');
    }
    return 'vapid t=' . "$head.$claims." . b64url(der_to_jose($der)) . ', k=' . $keys['public'];
}

/**
 * Zašifruje zprávu pro zařízení (RFC 8291, aes128gcm, jeden záznam).
 * $salt a $serverKey jen pro testy, jinak náhodné.
 */
function push_encrypt(string $payload, string $uaPublicB64, string $authB64, ?string $salt = null, $serverKey = null): string
{
    $uaPublic = b64url_decode($uaPublicB64);
    $auth = b64url_decode($authB64);
    if (strlen($auth) !== 16) {
        throw new HttpError(400, 'Neplatný klíč zařízení (auth)');
    }
    $serverKey ??= openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
    $asPublic = ec_public_raw($serverKey);
    $shared = openssl_pkey_derive(ec_public_from_raw($uaPublic), $serverKey, 32);
    if ($shared === false) {
        throw new RuntimeException('ECDH selhalo: ' . openssl_error_string());
    }
    $salt ??= random_bytes(16);
    $ikm = hash_hkdf('sha256', $shared, 32, "WebPush: info\0" . $uaPublic . $asPublic, $auth);
    $cek = hash_hkdf('sha256', $ikm, 16, "Content-Encoding: aes128gcm\0", $salt);
    $nonce = hash_hkdf('sha256', $ikm, 12, "Content-Encoding: nonce\0", $salt);
    $cipher = openssl_encrypt($payload . "\x02", 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag);
    if ($cipher === false) {
        throw new RuntimeException('Šifrování selhalo');
    }
    return $salt . pack('N', 4096) . chr(strlen($asPublic)) . $asPublic . $cipher . $tag;
}

/** Odešle zprávu jednomu zařízení. Vrací HTTP kód push služby (201 = doručeno, 404/410 = zařízení už neexistuje). */
function push_send(array $sub, array $message, int $ttl = 86400): array
{
    $body = push_encrypt((string) json_encode($message, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $sub['p256dh'], $sub['auth']);
    $ch = curl_init($sub['endpoint']);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => [
            'Authorization: ' . vapid_header($sub['endpoint'], vapid_keys()),
            'Content-Encoding: aes128gcm',
            'Content-Type: application/octet-stream',
            "TTL: $ttl",
            'Urgency: high',
        ],
        CURLOPT_POSTFIELDS => $body,
    ]);
    $resp = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    return ['code' => $code, 'body' => $resp === false ? $err : substr((string) $resp, 0, 300)];
}

/** Pošle zprávu na zařízení vybraných uživatelů; neplatná zařízení smaže. */
function push_to_users(array $userIds, array $message): array
{
    $userIds = array_values(array_unique(array_map('intval', $userIds)));
    if (!$userIds) {
        return [];
    }
    $qs = implode(',', array_fill(0, count($userIds), '?'));
    $res = [];
    foreach (q_all("SELECT * FROM notes_push_subs WHERE user_id IN ($qs)", $userIds) as $s) {
        $r = push_send($s, $message);
        if ($r['code'] >= 200 && $r['code'] < 300) {
            q('UPDATE notes_push_subs SET last_ok = ?, last_error = NULL WHERE id = ?', [now_utc(), $s['id']]);
        } elseif ($r['code'] === 404 || $r['code'] === 410) {
            q('DELETE FROM notes_push_subs WHERE id = ?', [$s['id']]);
        } else {
            q('UPDATE notes_push_subs SET last_error = ? WHERE id = ?', [mb_substr($r['code'] . ' ' . $r['body'], 0, 300), $s['id']]);
        }
        $res[] = ['id' => (int) $s['id'], 'code' => $r['code']] + ($r['code'] >= 300 || $r['code'] === 0 ? ['error' => $r['body']] : []);
    }
    return $res;
}

function push_subscribe(array $in, int $userId): void
{
    $endpoint = $in['endpoint'] ?? null;
    $p256dh = $in['keys']['p256dh'] ?? null;
    $auth = $in['keys']['auth'] ?? null;
    if (!is_string($endpoint) || !preg_match('#^https://#', $endpoint) || !is_string($p256dh) || !is_string($auth)) {
        throw new HttpError(400, 'Neplatné přihlášení k upozorněním');
    }
    ec_public_from_raw(b64url_decode($p256dh));  // kontrola klíče
    q('INSERT INTO notes_push_subs (user_id, endpoint_hash, endpoint, p256dh, auth, ua) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth = VALUES(auth), ua = VALUES(ua), last_error = NULL',
        [$userId, hash('sha256', $endpoint), $endpoint, $p256dh, $auth, mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 200)]);
}

function push_unsubscribe(array $in): void
{
    if (is_string($in['endpoint'] ?? null)) {
        q('DELETE FROM notes_push_subs WHERE endpoint_hash = ?', [hash('sha256', $in['endpoint'])]);
    }
}

function my_devices(): int
{
    return (int) q_one('SELECT COUNT(*) AS n FROM notes_push_subs WHERE user_id = ?', [my_id()])['n'];
}
