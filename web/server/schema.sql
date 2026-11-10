-- Tabulky appky Poznámky (na webu app.makuderovi.cz/notes).
-- Předpona notes_, protože databázi sdílí s dalšími appkami (hub_ = hubnutí, todo2_ = Todo).
-- Lokálně si je appka založí sama; na WEDOS se zakládají importem tohoto souboru v phpMyAdminu.
-- Všechny časy jsou v UTC.

-- Uživatelé (Lenka, Roman). Počáteční heslo je v server/env.json, změna hesla v appce se ukládá sem.
CREATE TABLE IF NOT EXISTS notes_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  login VARCHAR(40) NOT NULL,
  name VARCHAR(60) NOT NULL,
  female TINYINT(1) NOT NULL DEFAULT 0,   -- kvůli češtině: „upravila“ / „upravil“
  color VARCHAR(16) NOT NULL DEFAULT '#c2185b',
  password_hash VARCHAR(255) NOT NULL,
  password_at DATETIME NOT NULL,          -- kdy bylo heslo nastavené (novější heslo z env.json ho přepíše)
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_login (login)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Složky (i vnořené). Smazaná složka je v koši i se vším, co obsahuje.
CREATE TABLE IF NOT EXISTS notes_folders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  parent_id INT NULL,
  name VARCHAR(200) NOT NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  deleted_by INT NULL,
  KEY ix_parent (parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dokumenty: název a text v Markdownu. version roste s každou změnou textu (hlídá souběžné úpravy).
CREATE TABLE IF NOT EXISTS notes_docs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  folder_id INT NULL,
  title VARCHAR(200) NOT NULL,
  body MEDIUMTEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  pinned TINYINT(1) NOT NULL DEFAULT 0,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by INT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,  -- poslední změna textu nebo názvu
  deleted_at DATETIME NULL,
  deleted_by INT NULL,
  KEY ix_folder (folder_id),
  KEY ix_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Historie verzí: úpravy jednoho člověka v rámci 10 minut tvoří jednu verzi.
CREATE TABLE IF NOT EXISTS notes_revisions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  doc_id INT NOT NULL,
  user_id INT NULL,
  version INT NOT NULL,
  title VARCHAR(200) NOT NULL,
  body MEDIUMTEXT NOT NULL,
  started_at DATETIME NOT NULL,
  saved_at DATETIME NOT NULL,
  KEY ix_doc (doc_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Kdo má dokument právě otevřený (obnovuje se každých pár sekund).
CREATE TABLE IF NOT EXISTS notes_presence (
  doc_id INT NOT NULL,
  user_id INT NOT NULL,
  editing TINYINT(1) NOT NULL DEFAULT 0,
  seen_at DATETIME NOT NULL,
  PRIMARY KEY (doc_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Úpravy pro upozornění: jedno „sezení“ úprav dokumentu jedním člověkem. Po pár minutách klidu
-- plánovač pošle druhému upozornění („Roman upravil Dovolená 2027“) a nastaví sent_at.
CREATE TABLE IF NOT EXISTS notes_changes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  doc_id INT NOT NULL,
  user_id INT NOT NULL,
  kind VARCHAR(10) NOT NULL DEFAULT 'edit',  -- 'create' | 'edit'
  base_title VARCHAR(200) NULL,              -- název a text před úpravou (pro shrnutí, co přibylo)
  base_body MEDIUMTEXT NULL,
  started_at DATETIME NOT NULL,
  last_at DATETIME NOT NULL,
  sent_at DATETIME NULL,
  KEY ix_pending (sent_at, last_at),
  KEY ix_doc_user (doc_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Obrázky v dokumentech: soubor je ve složce data/img/ (z webu nepřístupná), vydává ho API po přihlášení.
CREATE TABLE IF NOT EXISTS notes_images (
  id INT AUTO_INCREMENT PRIMARY KEY,
  doc_id INT NULL,
  user_id INT NULL,
  file VARCHAR(80) NOT NULL,
  mime VARCHAR(40) NOT NULL,
  size INT NOT NULL,
  name VARCHAR(200) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Zařízení přihlášená k upozorněním (Web Push).
CREATE TABLE IF NOT EXISTS notes_push_subs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  endpoint_hash CHAR(64) NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh VARCHAR(200) NOT NULL,
  auth VARCHAR(100) NOT NULL,
  ua VARCHAR(200) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_ok DATETIME NULL,
  last_error VARCHAR(300) NULL,
  UNIQUE KEY uq_endpoint (endpoint_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Drobná nastavení appky (klíče pro upozornění, ochrana přihlášení, poslední běh plánovače).
CREATE TABLE IF NOT EXISTS notes_kv (
  name VARCHAR(64) PRIMARY KEY,
  value MEDIUMTEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
