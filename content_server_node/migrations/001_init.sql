-- Versioned whole-site content store.
--
-- A version is a complete manifest of files (version_file). File bytes live
-- once per unique content in blob, so every version is full and independent
-- while identical files are only stored once.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE blob (
  sha256      text PRIMARY KEY,
  content     bytea NOT NULL,
  mime        text NOT NULL,
  size        int NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE version (
  id              serial PRIMARY KEY,
  created_at      timestamptz NOT NULL DEFAULT now(),
  kind            text NOT NULL CHECK (kind IN ('save', 'restore', 'import', 'migration')),
  description     text NOT NULL,
  source_version  int NULL
);

CREATE TABLE version_file (
  version_id  int NOT NULL REFERENCES version(id) ON DELETE CASCADE,
  path        text NOT NULL,
  sha256      text NOT NULL REFERENCES blob(sha256),
  PRIMARY KEY (version_id, path)
);
CREATE INDEX version_file_sha256_idx ON version_file (sha256);

CREATE TABLE current_version (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version_id  int NOT NULL REFERENCES version(id)
);

-- Images uploaded in the text editor before the text is saved.
CREATE TABLE pending_upload (
  path        text PRIMARY KEY,
  sha256      text NOT NULL REFERENCES blob(sha256),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Features of the CURRENT version's overlays, for QGIS and other GIS clients.
-- Rebuilt by the server on every commit; never edited directly.
CREATE TABLE current_feature (
  layer_name     text NOT NULL,
  feature_index  int NOT NULL,
  properties     jsonb,
  geom           geometry(Geometry, 3006),
  PRIMARY KEY (layer_name, feature_index)
);
CREATE INDEX current_feature_geom_idx ON current_feature USING gist (geom);
