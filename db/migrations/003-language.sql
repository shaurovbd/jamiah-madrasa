-- Two-language support (English / বাংলা).
--
-- The site stores no new tables for this: interface strings live in
-- locales/en.json and locales/bn.json, and each visitor's own choice lives in
-- their session. The only persisted value is the institution-wide default,
-- which goes in the existing key-value settings table.
--
-- INSERT IGNORE so a re-run, or an install that already set a default from the
-- Settings page, is left alone.

INSERT IGNORE INTO settings (skey, svalue) VALUES ('default_language', 'en');
