-- Esquema de Obrador Mel. Idempotente: se puede aplicar sobre una base que ya lo tiene.

-- Un expediente por conversación. `session_id` es el visitante: cada navegador solo ve lo suyo.
CREATE TABLE IF NOT EXISTS cases (
  id          TEXT PRIMARY KEY,
  channel     TEXT NOT NULL DEFAULT 'web',
  lang        TEXT,
  state       TEXT NOT NULL DEFAULT 'intake',
  pii_level   TEXT NOT NULL DEFAULT 'none',
  route       TEXT,
  summary     TEXT,
  business    TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cases_business ON cases (business, session_id, created_at DESC);

-- Lo que se dijo. `role`: user (cliente), assistant o staff (el local).
-- `meta` guarda lo que el asistente enseña junto al texto: tarjetas, botones, fuentes y comprobaciones.
CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  case_id     TEXT NOT NULL REFERENCES cases (id),
  role        TEXT NOT NULL,
  content     TEXT NOT NULL,
  meta        JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_case ON messages (case_id, created_at);

-- La solicitud estructurada de la conversación: un pedido, una reserva, una pregunta sin respuesta
-- o un aviso a una persona. `data` guarda lo recogido y `dialog`, en la fila principal, el estado
-- de la conversación. Las preguntas hechas mientras se espera al local son filas hijas (`parent_id`).
CREATE TABLE IF NOT EXISTS biz_requests (
  id           TEXT PRIMARY KEY,
  case_id      TEXT NOT NULL REFERENCES cases (id),
  business     TEXT NOT NULL,
  session_id   TEXT NOT NULL,
  kind         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'collecting',
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  dialog       JSONB,
  parent_id    TEXT,
  slot_start   TIMESTAMPTZ,
  slot_end     TIMESTAMPTZ,
  total_cents  INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_biz_requests_session ON biz_requests (business, session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_biz_requests_status ON biz_requests (business, session_id, status);
CREATE INDEX IF NOT EXISTS idx_biz_requests_case ON biz_requests (case_id);

-- Por qué se hizo cada paso: qué modelo o regla actuó, con cuántos tokens y a qué ruta.
CREATE TABLE IF NOT EXISTS router_decisions (
  id          TEXT PRIMARY KEY,
  case_id     TEXT NOT NULL REFERENCES cases (id),
  step        TEXT NOT NULL,
  route       TEXT NOT NULL,
  model       TEXT,
  reason      TEXT,
  tokens_in   INTEGER,
  tokens_out  INTEGER,
  cost_est    NUMERIC,
  redacted    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_router_case ON router_decisions (case_id, created_at);

-- Las fuentes que respaldan una respuesta.
CREATE TABLE IF NOT EXISTS citations (
  id          TEXT PRIMARY KEY,
  case_id     TEXT NOT NULL REFERENCES cases (id),
  source      TEXT,
  quote       TEXT,
  score       DOUBLE PRECISION
);

-- Lo que el motor comprobó por su cuenta: disponibilidad, plazos, precios, alérgenos.
CREATE TABLE IF NOT EXISTS tool_calls (
  id          TEXT PRIMARY KEY,
  case_id     TEXT NOT NULL REFERENCES cases (id),
  seq         INTEGER NOT NULL,
  tool        TEXT NOT NULL,
  source      TEXT NOT NULL,
  args        JSONB,
  result      JSONB,
  ok          BOOLEAN NOT NULL DEFAULT true,
  ms          INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_case ON tool_calls (case_id, seq);

-- Lo que el asistente deja preparado para que lo decida una persona.
CREATE TABLE IF NOT EXISTS proposals (
  id          TEXT PRIMARY KEY,
  case_id     TEXT NOT NULL REFERENCES cases (id),
  checklist   JSONB,
  slot_start  TIMESTAMPTZ,
  slot_end    TIMESTAMPTZ,
  draft       TEXT,
  status      TEXT
);

-- Cada decisión de una persona del local: aprobar, rechazar, proponer otra hora, responder o revisar.
CREATE TABLE IF NOT EXISTS approvals (
  id           TEXT PRIMARY KEY,
  case_id      TEXT NOT NULL REFERENCES cases (id),
  proposal_id  TEXT REFERENCES proposals (id),
  actor        TEXT,
  decision     TEXT,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- El markdown de cierre de cada expediente.
CREATE TABLE IF NOT EXISTS artifacts (
  id          TEXT PRIMARY KEY,
  case_id     TEXT NOT NULL REFERENCES cases (id),
  kind        TEXT,
  path        TEXT,
  transcript  TEXT
);

-- La historia de cada expediente. Solo se añade: un disparador impide cambiarla o borrarla.
CREATE TABLE IF NOT EXISTS events (
  id        TEXT PRIMARY KEY,
  case_id   TEXT NOT NULL REFERENCES cases (id),
  type      TEXT NOT NULL,
  payload   JSONB,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_case_at ON events (case_id, at);

CREATE OR REPLACE FUNCTION events_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS events_append_only ON events;
CREATE TRIGGER events_append_only
  BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW
  EXECUTE FUNCTION events_append_only();
