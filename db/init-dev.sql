-- Jen pro lokální vývoj v Dockeru: druhá databáze pro automatické testy.
-- Tabulky si appka založí sama při prvním požadavku.
CREATE DATABASE IF NOT EXISTS notes_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON notes_test.* TO 'notes'@'%';
FLUSH PRIVILEGES;
