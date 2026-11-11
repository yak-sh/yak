// What a managed session runs: a provider's argv, and the reader that makes its
// JSON-lines output a transcript (@yaks/session's `claude` and `codex`) — code,
// and only code. Which providers exist and which models each one serves is
// graph data (@yaks/model's `provider` and `model` entities), so adding a model
// means inserting a row, not cutting a release.
//
// Every provider prints one JSON object per event, so ./run.ts never learns a
// vendor's format: @yaks/session's importer asks the reader what a line means
// and appends whatever comes back.
//
// A run carries its persona (@yaks/persona) through its provider's own
// instruction flag, beside the instruction file the provider reads in its
// checkout. Each adapter names that file, so ./run.ts can tell whether the
// file already says the persona, and gives the persona only when it does not.
//
// A run also names itself to the MCP servers it is connected to: each carries
// the session in `x-via` (@yaks/session `VIA`), through the provider's own way
// of configuring a connection, so a door stamps what the agent writes with its
// actor from its first call, and the agent says nothing for it.
//
// A provider's CLI also connects every server its own configuration and its
// account name, and tells the model each one's tools on every turn. A run goes
// `without` the ones it is told to, again through the provider's own way.
//
// A run offered no tools is `bare`: it can read and change nothing, so it is
// started with nothing of this machine, and what it carries is its
// instruction and its persona alone.

import { type Reader, readers } from '@yaks/session'
import { VIA } from '@yaks/session/graph'

/** What a run was asked for; the command line is built from it. */
export type Job = {
  /** the session entity — the transcript this run writes, and the id the
   * provider is asked to give its own thread */
  session: string
  /** the model, by the name its provider knows it by */
  model?: string
  /** how hard to think, where the provider accepts such a setting */
  effort?: string
  /** what it was asked to do */
  instruction: string
  /** the persona it runs with, where its checkout's instruction file does not
   * already say it (@yaks/persona `owed`) */
  persona?: string
  /** the provider's own id for the conversation this run carries on, where
   * the session ran before; a first run has none */
  thread?: string
  /** the MCP servers it is connected to, by name to URL, each told the
   * session in `x-via`; a name the provider already has is replaced */
  mcp?: Record<string, string>
  /** the MCP servers of its provider's own configuration it goes without, each
   * by the name the provider lists it under (`claude mcp list`, `codex mcp
   * list`) */
  without?: string[]
  /** it is offered no tools (`sending{tools: []}` on its request): started
   * with none of its provider's tools, settings, instruction files, skills,
   * commands, hooks or MCP servers, and no thread kept to carry on */
  bare?: boolean
}

/** A provider that is run as a command. */
export type Adapter = {
  /** the command line to run it with, the program name first */
  argv: (job: Job) => string[]
  /** what each line of its output means (@yaks/session) */
  read: Reader
  /** the instruction file its provider reads at the root of its checkout */
  file?: string
  /** variables its provider is run with, over the server's environment */
  env?: Record<string, string>
}

let servers = (j: Job) => Object.entries(j.mcp ?? {})

// Claude's `--mcp-config` takes JSON, and a server it names replaces the one
// of that name in the person's own config.
let connected = (j: Job): string[] =>
  servers(j).length
    ? [
      '--mcp-config',
      JSON.stringify({
        mcpServers: Object.fromEntries(
          servers(j).map(([name, url]) => [name, {
            type: 'http',
            url,
            headers: { [VIA]: j.session },
          }]),
        ),
      }),
    ]
    : []

// Claude reads settings for one run as JSON (`--settings`), over the person's
// own files. A server its `deniedMcpServers` names is never connected, whether
// the person's configuration, a plugin or their account lists it: none of its
// tools is named to the model, and neither are its instructions.
let lacking = (j: Job): string[] =>
  j.without?.length
    ? [
      '--settings',
      JSON.stringify({
        deniedMcpServers: j.without.map((serverName) => ({ serverName })),
      }),
    ]
    : []

// What a claude run works with: the servers it is connected to and goes
// without, and leave to use its tools unasked, since it owns its worktree and
// nobody is at the prompt. A bare run is given none of it: `--safe-mode` and
// an empty `--setting-sources` leave out every CLAUDE.md, skill, plugin, hook
// and settings file, `--strict-mcp-config` every MCP server, `--tools ''` the
// built-in tools, and nothing of the conversation is saved.
let working = (j: Job): string[] =>
  j.bare
    ? [
      '--safe-mode',
      '--setting-sources',
      '',
      '--strict-mcp-config',
      '--tools',
      '',
      '--disable-slash-commands',
      '--no-session-persistence',
    ]
    : [...connected(j), ...lacking(j), '--permission-mode', 'bypassPermissions']

/** `claude -p --output-format stream-json`, carrying on its thread with
 * `--resume`. */
export let claude: Adapter = {
  argv: (j) => [
    'claude',
    '-p',
    ...(j.thread ? ['--resume', j.thread] : ['--session-id', j.session]),
    '--output-format',
    'stream-json',
    '--verbose', // stream-json in print mode requires it
    ...(j.model ? ['--model', j.model] : []),
    ...(j.effort ? ['--effort', j.effort] : []),
    ...(j.persona ? ['--append-system-prompt', j.persona] : []),
    ...working(j),
    // -- ends the options: the instruction is a positional, so content that
    // opens with a dash parses as content and not as an unknown flag.
    '--',
    j.instruction,
  ],
  read: readers.claude,
  file: 'CLAUDE.md',
  // After its last turn, `claude -p` waits on the background agents it
  // started, but stops them after ten minutes unless this ceiling is 0. A run
  // that waits on its helpers lives until they report.
  env: { CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '0' },
}

// A TOML basic string, which is how `codex -c` reads a value: JSON's string
// escapes are TOML's, save that TOML also refuses a raw DEL.
let toml = (s: string): string =>
  JSON.stringify(s).replaceAll('\x7f', '\\u007f')

// Codex reads the first 32 KiB of AGENTS.md unless told otherwise, and a
// persona runs past that. Read it whole, as claude reads CLAUDE.md: no
// instruction file a person keeps comes near a mebibyte.
let WHOLE = 1 << 20

// Codex's `-c` sets a key of its TOML config, over the person's own. A server
// it goes without is one its config has, set not `enabled`: codex refuses to
// start over a server that has that key and no transport.
let configured = (j: Job): string[] => [
  ...servers(j).flatMap(([name, url]) => {
    let key = `mcp_servers.${toml(name)}`
    return [
      '-c',
      `${key}.url=${toml(url)}`,
      '-c',
      `${key}.http_headers={${toml(VIA)}=${toml(j.session)}}`,
    ]
  }),
  ...(j.without ?? []).flatMap((name) => [
    '-c',
    `mcp_servers.${toml(name)}.enabled=false`,
  ]),
]

/** `codex exec --json`, carrying on its thread with `codex exec resume`. */
export let codex: Adapter = {
  argv: (j) => {
    // Codex has no way to go without its tools and its own configuration, and
    // one started anyway would carry what it was asked to go without.
    if (j.bare) throw new Error('codex cannot run bare: it keeps its tools')
    return [
      'codex',
      'exec',
      ...(j.thread ? ['resume'] : []),
      '--json',
      // No approvals and no sandbox: a headless exec has nobody to approve, and
      // the run's worktree is its blast radius (the fleet's posture, 2026-07-17).
      '--dangerously-bypass-approvals-and-sandbox',
      ...(j.model ? ['-m', j.model] : []),
      ...(j.effort ? ['-c', `model_reasoning_effort=${j.effort}`] : []),
      '-c',
      `project_doc_max_bytes=${WHOLE}`,
      ...(j.persona ? ['-c', `developer_instructions=${toml(j.persona)}`] : []),
      ...configured(j),
      '--',
      ...(j.thread ? [j.thread] : []),
      j.instruction,
    ]
  },
  read: readers.codex,
  file: 'AGENTS.md',
}

/**
 * The providers run as commands, keyed by the `name` on their `provider`
 * entity. A server with a provider of its own builds its own table
 * ({@link https://jsr.io/@yaks/spawn/doc/effects/~/spawning | spawning}). A
 * provider missing from this table is one this package does not launch, which
 * is how an `http` provider is left to the in-process daemon.
 */
export let adapters: Record<string, Adapter> = { claude, codex }
