// Where the log lives: one table, one row per call, keyed by nothing but its
// own rowid. It is log data, deliberately outside the graph: no entity id, no
// component, and nothing a client ever syncs. Rows only accumulate; nothing
// references them.
//
// The list of sources is compiled into a CHECK constraint, so a row from a
// source nobody declared is rejected by the table, where the failure is
// visible, rather than accepted and never counted.

/** The log table's name. */
export let TABLE = 'tool_call'

/** The entry points a call can arrive through. */
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
