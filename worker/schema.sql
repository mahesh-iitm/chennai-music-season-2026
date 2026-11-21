-- D1 schema for the Chennai Music Season 2026 worker
CREATE TABLE IF NOT EXISTS submissions (
  id           TEXT PRIMARY KEY,
  concert_id   TEXT NOT NULL,
  client_id    TEXT NOT NULL,          -- random per-browser id (no personal data)
  ip_hash      TEXT,                   -- salted hash, used only for rate limits
  created_at   TEXT NOT NULL,
  items_json   TEXT NOT NULL,          -- confirmed song list
  ocr_json     TEXT,                   -- what the reader saw (for improving OCR)
  display_name TEXT,
  used_photo   INTEGER DEFAULT 0,
  superseded   INTEGER DEFAULT 0       -- 1 when the same rasika resubmitted
);
CREATE INDEX IF NOT EXISTS idx_sub_concert ON submissions(concert_id, superseded);

CREATE TABLE IF NOT EXISTS added_concerts (
  id           TEXT PRIMARY KEY,
  sabha_id     TEXT NOT NULL,
  date         TEXT NOT NULL,
  time         TEXT NOT NULL,
  artist       TEXT NOT NULL,
  accompanists TEXT,
  created_at   TEXT NOT NULL,
  ip_hash      TEXT,
  hidden       INTEGER DEFAULT 0        -- set to 1 to remove spam
);

CREATE TABLE IF NOT EXISTS usage (
  day   TEXT NOT NULL,
  key   TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, key)
);

-- Created automatically by the Worker on first use; listed here for reference.
CREATE TABLE IF NOT EXISTS subscribers (
  wa_id      TEXT PRIMARY KEY,   -- WhatsApp number, digits only
  name       TEXT,
  status     TEXT NOT NULL,      -- active | stopped
  joined_at  TEXT,
  updated_at TEXT
);
