// What a model is told when it takes over a conversation another harness
// (Claude Code, Codex, Grok, Antigravity) ran: what it ran on, that the tool
// calls in it were that harness's own, and the files it worked on. A model
// whose window cannot hold the conversation reads it summarized, as any long
// transcript is (./compact.ts).

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { line, sub } from '@yaks/query'
import { ordered } from './state.ts'

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

// The argument names a file path goes by in the tools of Claude Code, Codex,
// Grok, Antigravity and the harness.
let PATHS = [
  'file_path',
  'path',
  'filePath',
  'notebook_path',
  'AbsolutePath',
  'TargetFile',
  'target_file',
]

// The files a patch names (`*** Update File: a.ts`), as Codex's apply_patch
// writes them.
let patched = (text: string) =>
  [...text.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)]
    .map((m) => m[1].trim())

/** The files a transcript's calls named, newest first, each once. */
export let touched = (entries: Bundle[]): string[] => {
  let files = ordered(entries).flatMap((b) => {
    let args = comp(b, 'call')?.args as Record<string, unknown> | undefined
    if (!args) return []
    return [
      ...PATHS.map((k) => args[k]).filter((v): v is string =>
        typeof v == 'string' && !!v
      ),
      ...Object.values(args).flatMap((v) =>
        typeof v == 'string' ? patched(v) : []
      ),
    ]
  })
  return [...new Set(files.toReversed())]
}

/**
 * The note a session gets when another model takes over its conversation
 * from another harness: what the conversation ran on so far, by the names
 * `names` gives the provider and model rows its newest `using` or ask names,
 * and the files its calls named, at most `limit`.
 *
 * ```ts
 * import { handoff } from './handoff.ts'
 * import { assertEquals } from '@std/assert'
 *
 * let entries = [
 *   { entity: { eid: 'u' }, entry: { session: 's', seq: 1 }, using: { provider: 'p' } },
 *   { entity: { eid: 'c' }, entry: { session: 's', seq: 2 },
 *     call: { name: 'Edit', args: { file_path: '/w/a.ts' } } },
 * ]
 * assertEquals(handoff(entries, new Map([['p', 'claude']])),
 *   'Until here this conversation ran on claude, and another model takes ' +
 *   'it over now. The tool calls above were made with that harness\'s own ' +
 *   'tools, and their results are as it saw them; call your own tools from ' +
 *   'here on.\n\nFiles it worked on, newest first:\n- /w/a.ts')
 * ```
 */
export let handoff = (
  entries: Bundle[],
  names: Map<Eid, string>,
  limit = 40,
): string => {
  let newest = ordered(entries).toReversed()
  let using = newest.map((b) => comp(b, 'using')).find(Boolean)
  let model = using?.model ??
    newest.map((b) => comp(b, 'ask')?.to).find(Boolean)
  let ran = [using?.provider, model]
    .map((eid) => eid && names.get(String(eid)))
    .filter(Boolean).join(' ')
  let files = touched(entries)
  return [
    `Until here this conversation ran ${ran ? `on ${ran}` : 'elsewhere'}, ` +
    'and another model takes it over now. The tool calls above were made ' +
    "with that harness's own tools, and their results are as it saw them; " +
    'call your own tools from here on.',
    ...files.length
      ? [
        'Files it worked on, newest first:\n' +
        files.slice(0, limit).map((f) => `- ${f}`).join('\n') +
        (files.length > limit ? `\n- and ${files.length - limit} more` : ''),
      ]
      : [],
  ].join('\n\n')
}

/** The note for `session` ({@link handoff}) where another harness ran its
 * conversation so far: its newest model selection or request was read from
 * that harness's file (`lines{file, start}`), not asked here. Nothing where
 * this harness asked it last, or nothing asked it yet. */
export let handoffOf = async (
  g: Graph,
  session: Eid,
): Promise<string | undefined> => {
  let own = line`.entry.session=${session}`
  let [last] = await g.read(
    line`${
      sub(own)
    }&(.using|.ask)&.order=-entry.seq&.limit=1&.fields=entry.seq,lines.file`,
  )
  if (!comp(last, 'lines')?.file) return undefined
  let [calls, said] = await Promise.all([
    g.read(line`${sub(own)}&.call&.fields=entry.seq,call.args`),
    g.read(
      line`${
        sub(own)
      }&(.using|.ask)&.order=-entry.seq&.limit=8&.fields=entry.seq,using.provider,using.model,ask.to`,
    ),
  ])
  let named = [
    ...new Set(
      said.flatMap((b) => [
        comp(b, 'using')?.provider,
        comp(b, 'using')?.model,
        comp(b, 'ask')?.to,
      ]).filter((v): v is string => typeof v == 'string'),
    ),
  ]
  let rows = named.length ? await g.get(named) : []
  let names = new Map(
    rows.flatMap((r) => {
      let name = comp(r, 'provider')?.name ?? comp(r, 'model')?.name
      return typeof name == 'string' ? [[r.entity.eid, name] as const] : []
    }),
  )
  return handoff([...calls, ...said], names)
}
