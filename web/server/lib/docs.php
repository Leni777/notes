<?php
// Dokumenty a složky: strom, úpravy s hlídáním souběžných změn, historie verzí, koš, hledání, přítomnost.
declare(strict_types=1);

const REVISION_WINDOW = 600;   // úpravy jednoho člověka v rámci 10 minut tvoří jednu verzi v historii
const PRESENCE_SECONDS = 20;   // „má dokument otevřený“ = ozval se během posledních 20 s
const MAX_BODY = 4000000;      // 4 MB textu

function clean_name($v, string $what = 'Název'): string
{
    if (!is_string($v)) {
        throw new HttpError(400, "Chybí $what");
    }
    $v = trim((string) preg_replace('/\s+/u', ' ', $v));
    if ($v === '') {
        throw new HttpError(400, "$what nesmí být prázdný");
    }
    return mb_substr($v, 0, 200);
}

function clean_body($v): string
{
    if (!is_string($v)) {
        throw new HttpError(400, 'Chybí text dokumentu');
    }
    if (strlen($v) > MAX_BODY) {
        throw new HttpError(413, 'Dokument je příliš dlouhý');
    }
    return str_replace(["\r\n", "\r"], "\n", $v);
}

function int_id($v, string $what): int
{
    if (is_int($v) && $v > 0) {
        return $v;
    }
    if (is_string($v) && ctype_digit($v) && (int) $v > 0) {
        return (int) $v;
    }
    throw new HttpError(400, "Neplatné $what");
}

// ------------------------------------------------------------------ složky

/** Složky podle id (i smazané). */
function folders_by_id(): array
{
    $by = [];
    foreach (q_all('SELECT id, parent_id, name, created_by, created_at, deleted_at, deleted_by FROM notes_folders ORDER BY id') as $f) {
        $by[(int) $f['id']] = $f;
    }
    return $by;
}

/** id složek, které nejsou v koši – ani samy, ani žádná nadřazená. */
function live_folder_ids(?array $by = null): array
{
    $by ??= folders_by_id();
    $live = [];
    foreach ($by as $id => $f) {
        $ok = true;
        $seen = [];
        $cur = $f;
        while ($cur) {
            if ($cur['deleted_at'] !== null || isset($seen[(int) $cur['id']])) {
                $ok = false;
                break;
            }
            $seen[(int) $cur['id']] = true;
            $cur = $cur['parent_id'] !== null ? ($by[(int) $cur['parent_id']] ?? null) : null;
        }
        if ($ok) {
            $live[$id] = true;
        }
    }
    return $live;
}

/** Složka dokumentu pro výpis: živá složka, null = kořen, false = dokument je ve smazané složce (v koši). */
function doc_folder(?int $fid, array $by, array $live)
{
    if ($fid === null || !isset($by[$fid])) {
        return null;  // bez složky, nebo složka už neexistuje → kořen
    }
    return isset($live[$fid]) ? $fid : false;
}

/** id živé složky z požadavku, null = kořen. */
function opt_folder($v): ?int
{
    if ($v === null || $v === '' || $v === 0) {
        return null;
    }
    $id = int_id($v, 'id složky');
    if (!isset(live_folder_ids()[$id])) {
        throw new HttpError(404, 'Složka neexistuje');
    }
    return $id;
}

function folder_out(array $f): array
{
    return ['id' => (int) $f['id'], 'parent_id' => $f['parent_id'] === null ? null : (int) $f['parent_id'], 'name' => $f['name'],
        'created_by' => $f['created_by'] === null ? null : (int) $f['created_by'], 'created_at' => utc_iso($f['created_at'])];
}

function live_folder(int $id): array
{
    $by = folders_by_id();
    if (!isset($by[$id]) || !isset(live_folder_ids($by)[$id])) {
        throw new HttpError(404, 'Složka neexistuje');
    }
    return $by[$id];
}

function folder_create(array $in): array
{
    $name = clean_name($in['name'] ?? null, 'Název složky');
    $parent = opt_folder($in['parent_id'] ?? null);
    q('INSERT INTO notes_folders (parent_id, name, created_by, created_at) VALUES (?, ?, ?, ?)', [$parent, $name, my_id(), now_utc()]);
    return folder_out(live_folder(last_id()));
}

function folder_update(int $id, array $in): array
{
    $f = live_folder($id);
    if (array_key_exists('name', $in)) {
        q('UPDATE notes_folders SET name = ? WHERE id = ?', [clean_name($in['name'], 'Název složky'), $id]);
    }
    if (array_key_exists('parent_id', $in)) {
        $p = opt_folder($in['parent_id']);
        $by = folders_by_id();
        for ($cur = $p, $i = 0; $cur !== null && $i < 100; $i++) {  // ne do sebe ani do své podsložky
            if ($cur === $id) {
                throw new HttpError(400, 'Složku nejde přesunout do sebe samé');
            }
            $cur = $by[$cur]['parent_id'] !== null ? (int) $by[$cur]['parent_id'] : null;
        }
        q('UPDATE notes_folders SET parent_id = ? WHERE id = ?', [$p, $id]);
    }
    return folder_out(live_folder($id));
}

/** Smazání složky = do koše i se vším, co obsahuje (obnovit jde celá). */
function folder_delete(int $id): void
{
    live_folder($id);
    q('UPDATE notes_folders SET deleted_at = ?, deleted_by = ? WHERE id = ?', [now_utc(), my_id(), $id]);
}

function folder_restore(int $id): array
{
    $by = folders_by_id();
    $f = $by[$id] ?? null;
    if (!$f || $f['deleted_at'] === null) {
        throw new HttpError(404, 'Složka v koši není');
    }
    q('UPDATE notes_folders SET deleted_at = NULL, deleted_by = NULL WHERE id = ?', [$id]);
    $by[$id]['deleted_at'] = null;
    $parent = $f['parent_id'] !== null ? (int) $f['parent_id'] : null;
    if ($parent !== null && !isset(live_folder_ids($by)[$parent])) {  // nadřazená složka je pryč → do kořene
        q('UPDATE notes_folders SET parent_id = NULL WHERE id = ?', [$id]);
    }
    return folder_out(live_folder($id));
}

/** Složka a všechny podsložky (id). */
function folder_subtree(int $id, array $by): array
{
    $out = [$id];
    for ($i = 0; $i < count($out); $i++) {
        foreach ($by as $fid => $f) {
            if ($f['parent_id'] !== null && (int) $f['parent_id'] === $out[$i] && !in_array($fid, $out, true)) {
                $out[] = $fid;
            }
        }
    }
    return $out;
}

/** Smazat natrvalo (jen z koše): složku, podsložky a všechny dokumenty v nich. */
function folder_purge(int $id): void
{
    $by = folders_by_id();
    if (!isset($by[$id]) || isset(live_folder_ids($by)[$id])) {
        throw new HttpError(404, 'Složka v koši není');
    }
    $ids = folder_subtree($id, $by);
    $qs = implode(',', array_fill(0, count($ids), '?'));
    foreach (q_all("SELECT id FROM notes_docs WHERE folder_id IN ($qs)", $ids) as $d) {
        doc_purge_rows((int) $d['id']);
    }
    q("DELETE FROM notes_folders WHERE id IN ($qs)", $ids);
}

// ------------------------------------------------------------------ dokumenty

const DOC_META_COLS = 'id, folder_id, title, version, pinned, created_by, created_at, updated_by, updated_at, deleted_at, deleted_by';

function doc_meta(array $d, $folder = 'auto'): array
{
    $fid = $d['folder_id'] === null ? null : (int) $d['folder_id'];
    $out = ['id' => (int) $d['id'], 'folder_id' => $folder === 'auto' ? $fid : $folder, 'title' => $d['title'], 'version' => (int) $d['version'],
        'pinned' => (bool) $d['pinned'],
        'created_by' => $d['created_by'] === null ? null : (int) $d['created_by'], 'created_at' => utc_iso($d['created_at']),
        'updated_by' => $d['updated_by'] === null ? null : (int) $d['updated_by'], 'updated_at' => utc_iso($d['updated_at'])];
    if (array_key_exists('head', $d)) {
        $out['preview'] = md_plain((string) $d['head'], 140);
        $out['len'] = (int) $d['len'];
    }
    if ($d['deleted_at'] ?? null) {
        $out['deleted_at'] = utc_iso($d['deleted_at']);
        $out['deleted_by'] = $d['deleted_by'] === null ? null : (int) $d['deleted_by'];
    }
    return $out;
}

/** Celý strom: živé složky a dokumenty (bez textu, jen začátek pro náhled). */
function tree(): array
{
    $by = folders_by_id();
    $live = live_folder_ids($by);
    $folders = [];
    foreach ($by as $id => $f) {
        if (isset($live[$id])) {
            $folders[] = folder_out($f);
        }
    }
    $docs = [];
    foreach (q_all('SELECT ' . DOC_META_COLS . ', LEFT(body, 400) AS head, CHAR_LENGTH(body) AS len FROM notes_docs WHERE deleted_at IS NULL') as $d) {
        $fid = doc_folder($d['folder_id'] === null ? null : (int) $d['folder_id'], $by, $live);
        if ($fid !== false) {
            $docs[] = doc_meta($d, $fid);
        }
    }
    return ['folders' => $folders, 'docs' => $docs];
}

/** Řádek dokumentu (i se smazanými, když $deleted). */
function doc_row(int $id, bool $deleted = false, bool $lock = false): array
{
    $d = q_one('SELECT * FROM notes_docs WHERE id = ?' . ($lock ? ' FOR UPDATE' : ''), [$id]);
    if (!$d || (!$deleted && $d['deleted_at'] !== null)) {
        throw new HttpError(404, 'Dokument neexistuje (možná ho někdo smazal)');
    }
    return $d;
}

/** Dokument i s textem, cestou ke složce a tím, kdo ho má otevřený. */
function doc_full(int $id): array
{
    $d = doc_row($id, true);
    $by = folders_by_id();
    $live = live_folder_ids($by);
    $fid = doc_folder($d['folder_id'] === null ? null : (int) $d['folder_id'], $by, $live);
    $out = doc_meta($d, $fid === false ? null : $fid);
    $out['body'] = $d['body'];
    $out['in_trash'] = $d['deleted_at'] !== null || $fid === false;
    $out['others'] = presence_others($id);
    return $out;
}

function doc_create(array $in): array
{
    $title = array_key_exists('title', $in) && $in['title'] !== null ? clean_name($in['title']) : 'Bez názvu';
    $folder = opt_folder($in['folder_id'] ?? null);
    $body = array_key_exists('body', $in) ? clean_body($in['body']) : '';
    $me = my_id();
    $now = now_utc();
    $id = tx(function () use ($title, $folder, $body, $me, $now) {
        q('INSERT INTO notes_docs (folder_id, title, body, version, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?)',
            [$folder, $title, $body, $me, $now, $me, $now]);
        $id = last_id();
        q('INSERT INTO notes_revisions (doc_id, user_id, version, title, body, started_at, saved_at) VALUES (?, ?, 1, ?, ?, ?, ?)',
            [$id, $me, $title, $body, $now, $now]);
        q("INSERT INTO notes_changes (doc_id, user_id, kind, base_title, base_body, started_at, last_at) VALUES (?, ?, 'create', NULL, '', ?, ?)",
            [$id, $me, $now, $now]);
        return $id;
    });
    return doc_full($id);
}

/**
 * Úprava dokumentu. Text se uloží jen tehdy, když base_version odpovídá aktuální verzi – jinak 409
 * s aktuálním dokumentem a prohlížeč změny sloučí (merge.js) a pošle znovu.
 */
function doc_update(int $id, array $in): array
{
    $me = my_id();
    $now = now_utc();
    tx(function () use ($id, $in, $me, $now) {
        $d = doc_row($id, false, true);
        $title = $d['title'];
        $body = $d['body'];
        $touched = false;
        if (array_key_exists('title', $in)) {
            $t = clean_name($in['title']);
            if ($t !== $d['title']) {
                q('UPDATE notes_docs SET title = ? WHERE id = ?', [$t, $id]);
                $title = $t;
                $touched = true;
            }
        }
        if (array_key_exists('body', $in)) {
            $new = clean_body($in['body']);
            $base = $in['base_version'] ?? null;
            if (!is_int($base)) {
                throw new HttpError(400, 'Chybí base_version');
            }
            if ($base !== (int) $d['version']) {
                throw new HttpError(409, 'Dokument mezitím upravil někdo jiný', ['doc' => doc_full($id)]);
            }
            if ($new !== $d['body']) {
                q('UPDATE notes_docs SET body = ?, version = version + 1 WHERE id = ?', [$new, $id]);
                $body = $new;
                $touched = true;
            }
        }
        if (array_key_exists('folder_id', $in)) {
            q('UPDATE notes_docs SET folder_id = ? WHERE id = ?', [opt_folder($in['folder_id']), $id]);
        }
        if (array_key_exists('pinned', $in)) {
            q('UPDATE notes_docs SET pinned = ? WHERE id = ?', [$in['pinned'] ? 1 : 0, $id]);
        }
        if ($touched) {
            q('UPDATE notes_docs SET updated_by = ?, updated_at = ? WHERE id = ?', [$me, $now, $id]);
            $version = (int) q_one('SELECT version FROM notes_docs WHERE id = ?', [$id])['version'];
            save_revision($id, $me, $version, $title, $body, $now);
            track_change($id, $me, $d['title'], $d['body'], $now);
        }
    });
    $d = doc_row($id);
    return doc_meta($d);
}

/** Historie: úpravy stejného člověka do 10 minut od poslední uložené verze se přidají k ní. */
function save_revision(int $docId, int $userId, int $version, string $title, string $body, string $now): void
{
    $last = q_one('SELECT id, user_id, saved_at FROM notes_revisions WHERE doc_id = ? ORDER BY id DESC LIMIT 1', [$docId]);
    if ($last && (int) $last['user_id'] === $userId && strtotime($last['saved_at'] . ' UTC') >= strtotime($now . ' UTC') - REVISION_WINDOW) {
        q('UPDATE notes_revisions SET version = ?, title = ?, body = ?, saved_at = ? WHERE id = ?', [$version, $title, $body, $now, $last['id']]);
    } else {
        q('INSERT INTO notes_revisions (doc_id, user_id, version, title, body, started_at, saved_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$docId, $userId, $version, $title, $body, $now, $now]);
    }
}

/** Pro upozornění: úpravy jednoho člověka se sčítají, dokud plánovač upozornění neodešle. */
function track_change(int $docId, int $userId, string $baseTitle, string $baseBody, string $now): void
{
    $open = q_one('SELECT id FROM notes_changes WHERE doc_id = ? AND user_id = ? AND sent_at IS NULL ORDER BY id DESC LIMIT 1', [$docId, $userId]);
    if ($open) {
        q('UPDATE notes_changes SET last_at = ? WHERE id = ?', [$now, $open['id']]);
    } else {
        q("INSERT INTO notes_changes (doc_id, user_id, kind, base_title, base_body, started_at, last_at) VALUES (?, ?, 'edit', ?, ?, ?, ?)",
            [$docId, $userId, $baseTitle, $baseBody, $now, $now]);
    }
}

function doc_duplicate(int $id): array
{
    $d = doc_row($id);
    $by = folders_by_id();
    $fid = doc_folder($d['folder_id'] === null ? null : (int) $d['folder_id'], $by, live_folder_ids($by));
    return doc_create(['title' => mb_substr($d['title'], 0, 190) . ' (kopie)', 'body' => $d['body'], 'folder_id' => $fid ?: null]);
}

function doc_delete(int $id): void
{
    doc_row($id);
    q('UPDATE notes_docs SET deleted_at = ?, deleted_by = ? WHERE id = ?', [now_utc(), my_id(), $id]);
    q('DELETE FROM notes_presence WHERE doc_id = ?', [$id]);
}

/** Obnovit z koše; když je jeho složka pryč (nebo v koši), vrátí se do kořene. */
function doc_restore(int $id): array
{
    $d = doc_row($id, true);
    $by = folders_by_id();
    $fid = doc_folder($d['folder_id'] === null ? null : (int) $d['folder_id'], $by, live_folder_ids($by));
    q('UPDATE notes_docs SET deleted_at = NULL, deleted_by = NULL, folder_id = ? WHERE id = ?', [$fid ?: null, $id]);
    return doc_meta(doc_row($id));
}

/** Smazat natrvalo (jen z koše). */
function doc_purge(int $id): void
{
    $d = doc_row($id, true);
    $by = folders_by_id();
    if ($d['deleted_at'] === null && doc_folder($d['folder_id'] === null ? null : (int) $d['folder_id'], $by, live_folder_ids($by)) !== false) {
        throw new HttpError(400, 'Natrvalo jde smazat jen dokument z koše');
    }
    doc_purge_rows($id);
}

function doc_purge_rows(int $id): void
{
    // obrázky smazat jen ty, které nepoužívá jiný dokument (kopie dokumentu má stejné obrázky)
    foreach (q_all('SELECT id, file FROM notes_images WHERE doc_id = ?', [$id]) as $img) {
        $used = q_one('SELECT id FROM notes_docs WHERE id <> ? AND body LIKE ? LIMIT 1', [$id, '%img/' . $img['id'] . ')%']);
        if ($used) {
            q('UPDATE notes_images SET doc_id = ? WHERE id = ?', [$used['id'], $img['id']]);
            continue;
        }
        @unlink(data_dir() . '/img/' . $img['file']);
        q('DELETE FROM notes_images WHERE id = ?', [$img['id']]);
    }
    foreach (['notes_revisions', 'notes_changes', 'notes_presence'] as $t) {
        q("DELETE FROM $t WHERE doc_id = ?", [$id]);
    }
    q('DELETE FROM notes_docs WHERE id = ?', [$id]);
}

// ------------------------------------------------------------------ koš

function trash(): array
{
    $by = folders_by_id();
    $live = live_folder_ids($by);
    $folders = [];
    foreach ($by as $id => $f) {
        // jen složky smazané samy za sebe (jejich podsložky jsou v koši s nimi)
        $parentLive = $f['parent_id'] === null || !isset($by[(int) $f['parent_id']]) || isset($live[(int) $f['parent_id']]);
        if ($f['deleted_at'] !== null && $parentLive) {
            $sub = folder_subtree($id, $by);
            $qs = implode(',', array_fill(0, count($sub), '?'));
            $n = (int) q_one("SELECT COUNT(*) AS n FROM notes_docs WHERE deleted_at IS NULL AND folder_id IN ($qs)", $sub)['n'];
            $folders[] = folder_out($f) + ['deleted_at' => utc_iso($f['deleted_at']), 'deleted_by' => $f['deleted_by'] === null ? null : (int) $f['deleted_by'], 'docs' => $n];
        }
    }
    $docs = array_map(fn($d) => doc_meta($d),
        q_all('SELECT ' . DOC_META_COLS . ', LEFT(body, 400) AS head, CHAR_LENGTH(body) AS len FROM notes_docs WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC'));
    return ['folders' => $folders, 'docs' => $docs];
}

function trash_empty(): int
{
    $t = trash();
    foreach ($t['folders'] as $f) {
        folder_purge($f['id']);
    }
    foreach (q_all('SELECT id FROM notes_docs WHERE deleted_at IS NOT NULL') as $d) {
        doc_purge_rows((int) $d['id']);
    }
    return count($t['folders']) + count($t['docs']);
}

// ------------------------------------------------------------------ historie verzí

function revisions(int $docId): array
{
    doc_row($docId, true);
    return array_map(fn($r) => ['id' => (int) $r['id'], 'user_id' => $r['user_id'] === null ? null : (int) $r['user_id'], 'version' => (int) $r['version'],
        'title' => $r['title'], 'len' => (int) $r['len'], 'started_at' => utc_iso($r['started_at']), 'saved_at' => utc_iso($r['saved_at'])],
        q_all('SELECT id, user_id, version, title, CHAR_LENGTH(body) AS len, started_at, saved_at FROM notes_revisions WHERE doc_id = ? ORDER BY id DESC LIMIT 300', [$docId]));
}

function revision(int $id): array
{
    $r = q_one('SELECT * FROM notes_revisions WHERE id = ?', [$id]);
    if (!$r) {
        throw new HttpError(404, 'Verze neexistuje');
    }
    // předchozí verze (pro zobrazení změn)
    $prev = q_one('SELECT body FROM notes_revisions WHERE doc_id = ? AND id < ? ORDER BY id DESC LIMIT 1', [$r['doc_id'], $id]);
    return ['id' => (int) $r['id'], 'doc_id' => (int) $r['doc_id'], 'user_id' => $r['user_id'] === null ? null : (int) $r['user_id'],
        'version' => (int) $r['version'], 'title' => $r['title'], 'body' => $r['body'], 'prev_body' => $prev['body'] ?? null,
        'started_at' => utc_iso($r['started_at']), 'saved_at' => utc_iso($r['saved_at'])];
}

/** Vrátit dokument k dřívější verzi (text; aktuální stav zůstane v historii). */
function revision_restore(int $id): array
{
    $r = q_one('SELECT doc_id, body FROM notes_revisions WHERE id = ?', [$id]);
    if (!$r) {
        throw new HttpError(404, 'Verze neexistuje');
    }
    $d = doc_row((int) $r['doc_id']);
    return doc_update((int) $r['doc_id'], ['body' => $r['body'], 'base_version' => (int) $d['version']]);
}

// ------------------------------------------------------------------ přítomnost

function presence_others(int $docId): array
{
    $since = gmdate('Y-m-d H:i:s', time() - PRESENCE_SECONDS);
    $me = session_user();
    return array_map(fn($r) => ['user_id' => (int) $r['user_id'], 'editing' => (bool) $r['editing']],
        q_all('SELECT user_id, editing FROM notes_presence WHERE doc_id = ? AND user_id <> ? AND seen_at >= ?', [$docId, $me ? (int) $me['id'] : 0, $since]));
}

/** Dokument je otevřený: zapsat přítomnost a vrátit aktuální verzi a kdo další ho má otevřený. */
function doc_ping(int $id, bool $editing): array
{
    $d = q_one('SELECT ' . DOC_META_COLS . ' FROM notes_docs WHERE id = ?', [$id]);
    if (!$d) {
        throw new HttpError(404, 'Dokument neexistuje');
    }
    q('INSERT INTO notes_presence (doc_id, user_id, editing, seen_at) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE editing = VALUES(editing), seen_at = VALUES(seen_at)', [$id, my_id(), $editing ? 1 : 0, now_utc()]);
    $by = folders_by_id();
    $fid = doc_folder($d['folder_id'] === null ? null : (int) $d['folder_id'], $by, live_folder_ids($by));
    return doc_meta($d, $fid === false ? null : $fid) + ['in_trash' => $d['deleted_at'] !== null || $fid === false, 'others' => presence_others($id)];
}

function doc_leave(int $id): void
{
    q('DELETE FROM notes_presence WHERE doc_id = ? AND user_id = ?', [$id, my_id()]);
}

// ------------------------------------------------------------------ hledání

/** Malá písmena bez diakritiky; každý znak zůstane jedním znakem (pozice sedí s původním textem). */
function fold(string $s): string
{
    static $map = null;
    $map ??= array_combine(
        preg_split('//u', 'áäčďéěëíňóöřšťúůüýžľĺŕàâèêîôûçñ', -1, PREG_SPLIT_NO_EMPTY),
        preg_split('//u', 'aacdeeeinoorstuuuyzllraaeeioucn', -1, PREG_SPLIT_NO_EMPTY)
    );
    return strtr(mb_strtolower($s), $map);
}

function search(string $q): array
{
    $words = array_values(array_filter(preg_split('/\s+/u', trim($q)) ?: [], fn($w) => $w !== ''));
    if (!$words || mb_strlen(implode('', $words)) < 2) {
        return [];
    }
    $words = array_slice($words, 0, 6);
    $where = [];
    $params = [];
    foreach ($words as $w) {
        $like = '%' . addcslashes($w, '%_\\') . '%';
        $where[] = '(title LIKE ? OR body LIKE ?)';  // utf8mb4_unicode_ci: bez ohledu na velikost písmen a diakritiku
        array_push($params, $like, $like);
    }
    $rows = q_all('SELECT ' . DOC_META_COLS . ', body FROM notes_docs WHERE deleted_at IS NULL AND ' . implode(' AND ', $where) . ' ORDER BY updated_at DESC LIMIT 60', $params);
    $by = folders_by_id();
    $live = live_folder_ids($by);
    $out = [];
    foreach ($rows as $d) {
        $fid = doc_folder($d['folder_id'] === null ? null : (int) $d['folder_id'], $by, $live);
        if ($fid === false) {
            continue;
        }
        $out[] = doc_meta($d, $fid) + ['snippet' => snippet(md_plain((string) $d['body'], 0), $words)];
        if (count($out) >= 40) {
            break;
        }
    }
    return $out;
}

/** Úryvek textu kolem prvního nalezeného slova. */
function snippet(string $plain, array $words): string
{
    $f = fold($plain);
    $pos = null;
    foreach ($words as $w) {
        $p = mb_strpos($f, fold($w));
        if ($p !== false && ($pos === null || $p < $pos)) {
            $pos = $p;
        }
    }
    if ($pos === null) {
        return mb_substr($plain, 0, 140);
    }
    $start = max(0, $pos - 50);
    return ($start > 0 ? '…' : '') . mb_substr($plain, $start, 150) . ($start + 150 < mb_strlen($plain) ? '…' : '');
}

// ------------------------------------------------------------------ Markdown → čistý text (náhledy, upozornění)

/** Jeden řádek Markdownu bez značek. null = řádek bez textu (oddělovač tabulky, čára, ```). */
function md_line_plain(string $l): ?string
{
    if (preg_match('/^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*(:?-{2,}:?)?\s*\|?\s*$/', $l) || preg_match('/^\s*([-*_])(\s*\1){2,}\s*$/', $l) || preg_match('/^\s*(```|~~~)/', $l)) {
        return null;
    }
    $l = (string) preg_replace('/^\s*(#{1,6}\s+|(>\s?)+|[-*+]\s+\[[ xX]\]\s+|\d+[.)]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/u', '', $l);
    $l = (string) preg_replace('/!\[([^\]]*)\]\([^)]*\)/u', '🖼 $1', $l);
    $l = (string) preg_replace('/\[([^\]]*)\]\([^)]*\)/u', '$1', $l);
    $l = str_replace(['**', '__', '~~', '`', '<br>'], ['', '', '', '', ' '], $l);
    $l = (string) preg_replace('/(?<![\p{L}\p{N}\\\\])[*_](?=\S)|(?<=\S)(?<!\\\\)[*_](?![\p{L}\p{N}])/u', '', $l);
    if (preg_match('/^\s*\|.*\|\s*$/u', $l)) {  // řádek tabulky
        $l = (string) preg_replace('/\s*(?<!\\\\)\|\s*/u', ' · ', trim(trim($l), '|'));
    }
    $l = (string) preg_replace('/\\\\([\\\\`*_{}\[\]()#+\-.!|~>])/', '$1', $l);
    $l = trim($l, " \t·");
    return $l === '' ? null : $l;
}

/** Text bez značek, řádky spojené „ · “; $max = 0 bez zkrácení. */
function md_plain(string $md, int $max = 160): string
{
    $lines = [];
    foreach (explode("\n", $md) as $l) {
        $p = md_line_plain($l);
        if ($p !== null) {
            $lines[] = $p;
        }
        if ($max && mb_strlen(implode(' · ', $lines)) > $max) {
            break;
        }
    }
    $s = implode(' · ', $lines);
    return $max && mb_strlen($s) > $max ? rtrim(mb_substr($s, 0, $max - 1)) . '…' : $s;
}

// ------------------------------------------------------------------ obrázky

function data_dir(): string
{
    $d = getenv('NOTES_DATA_DIR') ?: (string) env('data_dir', '');
    return rtrim($d !== '' ? $d : dirname(__DIR__, 2) . '/data', '/');
}

const IMAGE_TYPES = [IMAGETYPE_JPEG => ['image/jpeg', 'jpg'], IMAGETYPE_PNG => ['image/png', 'png'], IMAGETYPE_GIF => ['image/gif', 'gif'], IMAGETYPE_WEBP => ['image/webp', 'webp']];

/** Nahrání obrázku: tělo požadavku = soubor. Uloží se do data/img/ (z webu nepřístupné). */
function image_upload(): array
{
    $me = my_id();
    $docId = isset($_GET['doc']) ? int_id($_GET['doc'], 'id dokumentu') : null;
    if ($docId !== null) {
        doc_row($docId);
    }
    $data = raw_body();
    if ($data === '') {
        throw new HttpError(400, 'Prázdný soubor');
    }
    if (strlen($data) > 15 * 1024 * 1024) {
        throw new HttpError(413, 'Obrázek je moc velký (víc než 15 MB)');
    }
    $info = @getimagesizefromstring($data);
    if (!$info || !isset(IMAGE_TYPES[$info[2]])) {
        throw new HttpError(400, 'Tohle není obrázek (JPEG, PNG, GIF nebo WebP)');
    }
    [$mime, $ext] = IMAGE_TYPES[$info[2]];
    $dir = data_dir() . '/img';
    if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) {
        throw new RuntimeException("Nejde vytvořit složku $dir");
    }
    if (!is_file(data_dir() . '/.htaccess')) {  // pojistka: data/ jsou z webu zakázaná už v app/.htaccess
        @file_put_contents(data_dir() . '/.htaccess', "Require all denied\n");
    }
    $file = bin2hex(random_bytes(12)) . '.' . $ext;
    if (file_put_contents("$dir/$file", $data) !== strlen($data)) {
        throw new RuntimeException('Obrázek se nepodařilo uložit');
    }
    $name = is_string($_GET['name'] ?? null) ? mb_substr(trim($_GET['name']), 0, 200) : null;
    q('INSERT INTO notes_images (doc_id, user_id, file, mime, size, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [$docId, $me, $file, $mime, strlen($data), $name, now_utc()]);
    $id = last_id();
    return ['id' => $id, 'src' => "img/$id", 'width' => $info[0], 'height' => $info[1]];
}

function image_serve(int $id): void
{
    me();
    $img = q_one('SELECT file, mime FROM notes_images WHERE id = ?', [$id]);
    $path = $img ? data_dir() . '/img/' . $img['file'] : '';
    if (!$img || !is_file($path)) {
        throw new HttpError(404, 'Obrázek neexistuje');
    }
    header('Content-Type: ' . $img['mime']);
    header('Content-Length: ' . filesize($path));
    header('Cache-Control: private, max-age=31536000, immutable');  // obsah se pod stejným id nikdy nemění
    header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'none'");
    readfile($path);
}

// ------------------------------------------------------------------ upozornění na změny

/** Řádky, které v novém textu přibyly (bez značek), a počet smazaných. */
function line_changes(string $before, string $after): array
{
    $count = [];
    foreach (explode("\n", $before) as $l) {
        $p = md_line_plain($l);
        if ($p !== null) {
            $count[$p] = ($count[$p] ?? 0) + 1;
        }
    }
    $added = [];
    foreach (explode("\n", $after) as $l) {
        $p = md_line_plain($l);
        if ($p === null) {
            continue;
        }
        if (($count[$p] ?? 0) > 0) {
            $count[$p]--;
        } else {
            $added[] = $p;
        }
    }
    return [$added, array_sum($count)];
}

function plural_cs(int $n, string $one, string $few, string $many): string
{
    return $n === 1 ? $one : ($n >= 2 && $n <= 4 ? $few : $many);
}

/** Text upozornění („Roman upravil „Dovolená 2027““ + co přibylo), null = nic podstatného se nezměnilo. */
function change_message(array $c, array $d, ?array $u): ?array
{
    $who = $u['name'] ?? 'Někdo';
    $a = !empty($u['female']) ? 'a' : '';
    [$added, $removed] = line_changes((string) ($c['base_body'] ?? ''), (string) $d['body']);
    if ($c['kind'] === 'create') {
        $title = "$who vytvořil$a „{$d['title']}“";
    } elseif ($added || $removed) {
        $title = "$who upravil$a „{$d['title']}“";
    } elseif ($c['base_title'] !== null && $c['base_title'] !== $d['title']) {
        return ['title' => "$who přejmenoval$a „{$c['base_title']}“", 'body' => "Nový název: {$d['title']}", 'tag' => 'doc-' . $d['id'], 'url' => './#/d/' . $d['id']];
    } else {
        return null;
    }
    if ($added) {
        $body = implode(' · ', array_map(fn($l) => mb_strlen($l) > 60 ? mb_substr($l, 0, 59) . '…' : $l, array_slice($added, 0, 3)));
        if (count($added) > 3) {
            $body .= ' a ' . (count($added) - 3) . ' ' . plural_cs(count($added) - 3, 'další', 'další', 'dalších');
        }
        $body = '+ ' . $body;
    } elseif ($removed) {
        $body = "smazal$a $removed " . plural_cs($removed, 'řádek', 'řádky', 'řádků');
    } else {
        $body = 'Zatím prázdný dokument';
    }
    return ['title' => $title, 'body' => $body, 'tag' => 'doc-' . $d['id'], 'url' => './#/d/' . $d['id']];
}

/**
 * Plánovač (cron): úpravy, u kterých je už $quiet sekund klid, pošle ostatním jako upozornění.
 * Kdo má dokument právě otevřený, upozornění nedostane (vidí změny živě).
 */
function run_notifications(int $quiet = 180): array
{
    $users = [];
    foreach (q_all('SELECT * FROM notes_users') as $u) {
        $users[(int) $u['id']] = $u;
    }
    $rows = q_all('SELECT * FROM notes_changes WHERE sent_at IS NULL AND last_at <= ? ORDER BY id LIMIT 30', [gmdate('Y-m-d H:i:s', time() - $quiet)]);
    $out = [];
    foreach ($rows as $c) {
        if (q('UPDATE notes_changes SET sent_at = ? WHERE id = ? AND sent_at IS NULL', [now_utc(), $c['id']])->rowCount() === 0) {
            continue;  // souběžný běh plánovače
        }
        $d = q_one('SELECT id, title, body, deleted_at FROM notes_docs WHERE id = ?', [$c['doc_id']]);
        if (!$d || $d['deleted_at'] !== null) {
            continue;
        }
        $msg = change_message($c, $d, $users[(int) $c['user_id']] ?? null);
        if (!$msg) {
            continue;
        }
        $present = array_map(fn($r) => (int) $r['user_id'],
            q_all('SELECT user_id FROM notes_presence WHERE doc_id = ? AND seen_at >= ?', [$d['id'], gmdate('Y-m-d H:i:s', time() - 60)]));
        $to = array_values(array_filter(array_keys($users), fn($id) => $id !== (int) $c['user_id'] && !in_array($id, $present, true)));
        $out[] = ['doc' => (int) $d['id'], 'to' => $to, 'message' => $msg, 'devices' => push_to_users($to, $msg)];
    }
    // staré záznamy už nejsou potřeba
    q('DELETE FROM notes_changes WHERE sent_at IS NOT NULL AND sent_at < ?', [gmdate('Y-m-d H:i:s', time() - 7 * 86400)]);
    kv_set('cron_last', json_encode(['at' => gmdate('c'), 'sent' => count($out)]));
    return ['sent' => $out];
}

// ------------------------------------------------------------------ záloha

function backup(): array
{
    $by = folders_by_id();
    return [
        'app' => 'notes', 'exported_at' => gmdate('c'),
        'users' => all_users(),
        'folders' => array_values(array_map(fn($f) => folder_out($f) + ['deleted_at' => utc_iso($f['deleted_at'])], $by)),
        'docs' => array_map(fn($d) => doc_meta($d) + ['body' => $d['body'], 'deleted_at' => utc_iso($d['deleted_at'])],
            q_all('SELECT * FROM notes_docs ORDER BY id')),
        'images' => array_map(fn($i) => ['id' => (int) $i['id'], 'doc_id' => $i['doc_id'] === null ? null : (int) $i['doc_id'], 'file' => $i['file'],
            'mime' => $i['mime'], 'size' => (int) $i['size'], 'name' => $i['name']], q_all('SELECT * FROM notes_images ORDER BY id')),
    ];
}
