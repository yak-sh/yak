// Where the log lives: one table, one row per call, keyed by nothing but its
// own rowid. It is LOG data, deliberately outside the graph: no entity id, no
// component, no wire presence. Rows accrete; nothing links them.
//
// The sources are a baked CHECK so a row from a door nobody declared is
// refused at the table, where the failure is loud, rather than accepted and
// never counted.

/** The log table's name. */
export let TABLE = 'tool_call'

/** The doors a call can arrive through. */
export let SOURCES = ['mcp', 'http', 'web', 'srv', 'cli'] as const

/** One of {@link SOURCES}. */
export type Source = typeof SOURCES[number]

/** The schema the log needs, as ordered idempotent statements. */
export let schema = (): string[] => [
  `create table if not exists "${TABLE}" (
    ts         text not null
               default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    source     text not null
               check (source in (${SOURCES.map((s) => `'${s}'`).join(',')})),
    name       text not null,
    session_id text,
    ok         integer not null,
    ms         integer,
    error      text,
    detail     text
  )`,
]
