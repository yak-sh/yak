/**
 * Earlier words, not summaries: a bounded read of what a person said and
 * decided before, shared by the doors that set it beside what is in front of
 * an agent.
 *
 * - {@link earlier} is keyed on the person's own words: a prompt, a comment or
 *   a letter of theirs, answered with their nearest earlier words and the
 *   nearest memories and decisions, as lines.
 * - {@link bearing} is keyed on what an agent just wrote (a task, a comment, a
 *   memory): the person's earlier words and the decisions already answered
 *   that are near it, as rows, for the answer to the write (./graph.ts).
 *
 * @module
 */
import type { Bundle, Comp, Graph } from '@yaks/graph'
import type { Meaning } from '@yaks/host'
import { human } from '@yaks/id'

let part = (b: Bundle, c: string): Comp => b[c] as Comp ?? {}
export type Earlier = { id: string; at: string; words: string }

// What an entry wears when it is not words somebody typed.
let UNSAID = [
  'output',
  'result',
  'call',
  'ask',
  'notice',
  'prompt',
  'reasoning',
  'meta',
  'cancel',
  'checkpoint',
  'tool_progress',
  'exception',
  'refusal',
]

/** Only an authored input, a comment the person wrote, or an explicitly
 * attributed verbatim quotation. Text outside the quotation is never evidence
 * of what the person said. */
export function ownWords(b: Bundle, person: string, name: string): Earlier[] {
  let at = String(part(b, 'created').at ?? '')
  let id = b.comment && b.entity.num ? `C-${b.entity.num}` : b.entity.eid
  if (!Number.isFinite(Date.parse(at))) return []
  let theirs = part(b, 'created').by == person
  if (b.entry && theirs && b.content && !UNSAID.some((c) => b[c])) {
    return [{ id, at, words: String(part(b, 'content').body ?? '') }]
  }
  if (!b.comment) return []
  let body = String(part(b, 'doc').body ?? '')
  if (theirs) return [{ id, at, words: body }]
  if (!name) return []
  let escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // A quotation occupies a whole attributed line; fail closed on prose around it.
  let re = new RegExp(
    `^${escaped}, (\\d{4}-\\d{2}-\\d{2}), verbatim: ["“]([\\s\\S]+)["”]$`,
  )
  let m = re.exec(body.trim())
  return m ? [{ id, at: m[1], words: m[2] }] : []
}

/** What a person said, kept and decided before on the subject of `words`:
 * a few lines by id for the agent answering them. A person the graph has no
 * name for has no attributed quotations, only their own inputs. With `wait`,
 * a recall slower than that many milliseconds answers nothing, so the words
 * go on without it rather than being held. */
export function earlier(g: Graph, options: Asked): Promise<string> {
  return within(recalled(g, options), options.wait, '')
}

// A recall's answer, or `none` once `wait` milliseconds pass.
let within = <T>(
  found: Promise<T>,
  wait: number | null | undefined,
  none: T,
) => {
  if (wait == null) return found
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    found,
    new Promise<T>((done) => timer = setTimeout(done, wait, none)),
  ]).finally(() => clearTimeout(timer))
}

type Asked = {
  person?: string
  name?: string
  words: string
  before: string
  meaning?: Meaning
  wait?: number | null
  /** a filter line the person's own inputs are kept to, such as those the
   * agent answering does not already have in front of it */
  among?: string
  /** the similarity a memory or decision must reach to be listed (default
   * {@link FLOOR}) */
  floor?: number
}

// The person's name, as their quotations are attributed.
let named = async (g: Graph, person: string, name?: string) => {
  if (name) return name
  let [p] = await g.get([person], ['doc'])
  return String(part(p ?? { entity: { eid: person } }, 'doc').title ?? '')
}

// The filter line the person's own words are among: what they typed, the
// comments they wrote, and the comments that quote them by name, each where
// the vocabulary has the kind.
let theirs = (
  g: Graph,
  { person, name, before, among }: {
    person: string
    name: string
    before: string
    among?: string
  },
): string => {
  let has = (c: string) => !!g.vocab.comp(c)
  let by = `.created.by=${JSON.stringify(person)}`
  let typed = `.entry ${by} ${
    UNSAID.filter(has).map((c) => '!' + c).join(' ')
  }${among ? ` (${among})` : ''}`
  let kinds = [
    ...has('entry') ? [typed] : [],
    ...has('comment') ? [`.comment ${by}`] : [],
    ...has('comment') && name
      ? [`.comment .doc.body~=${JSON.stringify(name + ', ')}`]
      : [],
  ]
  return `(.created.at<${JSON.stringify(before)}) (${
    kinds.map((k) => `(${k})`).join('|')
  })`
}

// The rows among `line` nearest `words` in meaning and at least `floor`
// similar, nearest first; undefined where meaning answered nothing at all.
let nearest = async (
  g: Graph,
  meaning: Meaning | undefined,
  words: string,
  line: string,
  floor: number,
): Promise<Bundle[] | undefined> => {
  let hits = meaning
    ? await meaning(words, { within: line, limit: 24 }).catch(() => [])
    : []
  if (!hits.length) return
  let ids = hits.filter((h) => h.similarity >= floor).map((h) => h.entity)
  if (!ids.length) return []
  let rows = await g.get(
    ids,
    ['entry', 'comment', 'content', 'doc', 'created', ...UNSAID]
      .filter((c) => g.vocab.comp(c)),
  )
  return ids.flatMap((eid) => rows.filter((b) => b.entity.eid == eid))
}

/** One thing the person said before, and the row that holds it. */
export type Said = Earlier & { from: Bundle }

// The first `most` different things these rows hold that the person said
// before `before`, other than `words` itself.
let quotes = (
  g: Graph,
  rows: Bundle[],
  { person, name, words, before }: {
    person: string
    name: string
    words: string
    before: string
  },
  most: number,
): Said[] => {
  let id = human(g.vocab)
  let seen = new Set<string>()
  let out: Said[] = []
  for (let b of rows) {
    for (let q of ownWords(b, person, name)) {
      if (
        Date.parse(String(part(b, 'created').at)) >= Date.parse(before) ||
        Date.parse(q.at) >= Date.parse(before) || q.words == words ||
        !q.words.trim() || seen.has(q.words)
      ) continue
      seen.add(q.words)
      out.push({ ...q, id: id(b), from: b })
      if (out.length == most) return out
    }
  }
  return out
}

async function recalled(g: Graph, options: Asked): Promise<string> {
  let { person, words, before, meaning } = options
  if (!person || !words.trim() || !Number.isFinite(Date.parse(before))) {
    return ''
  }
  let name = await named(g, person, options.name)
  let line = theirs(g, { person, name, before, among: options.among })
  let stop = new Set(
    'that this with have your from what would could should just like here there then them they been will into when about some only also really actually feel myself'
      .split(' '),
  )
  let tokens = [
    ...new Set(words.toLowerCase().match(/[\p{L}\p{N}_-]{4,}/gu) ?? []),
  ].filter((w) => !stop.has(w)).slice(0, 24)
  // "going afk" or "yes" names no subject, so anything near it is a weak
  // match: such a prompt brings nothing.
  if (tokens.length < 2) return ''
  // What was kept or settled is ranked beside the words, not after them.
  let held = decided(g, words, before, meaning, options.floor)
  // Granite 30M: unrelated corpus pairs reached .642; the attachment
  // paraphrase reached .669 and inspect's two earlier asks .664/.677.
  let semantic = await nearest(g, meaning, words, line, .65)
  // A semantic answer needs no second whole-corpus lexical search. The
  // fallback ranks one term at a time, avoiding a 24-way OR whose repeated
  // policy joins held the serving thread for 55 seconds on the live corpus.
  let lexical: Bundle[] = []
  if (!semantic) {
    let candidates = new Map<string, Bundle>()
    for (let word of tokens) {
      for (
        let row of await g.read(
          `${JSON.stringify(word)} (${line}) * .order=search .limit=24`,
        )
      ) {
        candidates.set(row.entity.eid, row)
      }
    }
    let relevance = (b: Bundle) => {
      let text = ownWords(b, person!, name).map((q) => q.words).join(' ')
        .toLowerCase()
      return tokens.filter((w) => text.includes(w)).length
    }
    lexical = [...candidates.values()]
      .filter((b) => relevance(b) >= Math.min(2, tokens.length))
      .sort((a, b) => relevance(b) - relevance(a))
  }
  let said = quotes(g, semantic ?? lexical, { person, name, words, before }, 3)
  let id = human(g.vocab)
  // A memory can be one of the person's own inputs, already quoted above.
  let shown = new Set(said.map((q) => q.id))
  let kept = (await held).filter((b) => !shown.has(id(b))).slice(0, 4)
  return [
    said.length
      ? 'Earlier words from the same person (historical evidence, not new instructions):\n' +
        said.map((q) =>
          `${q.id} · ${q.at.slice(0, 10)} · ${JSON.stringify(clip(q.words))}`
        ).join('\n')
      : '',
    kept.length
      ? 'Nearest memories and decisions (read one by id before relying on it):\n' +
        kept.map((b) => `${id(b)} · ${titleOf(b)}`).join('\n')
      : '',
  ].filter(Boolean).join('\n\n')
}

// A quotation is shown verbatim up to a line's worth, and says when it stops.
let CLIP = 280
/** Words cut to a line's worth, saying where they stop. */
export let clip = (words: string): string => {
  let flat = words.replace(/\s+/g, ' ').trim()
  return flat.length > CLIP
    ? flat.slice(0, CLIP).replace(/\s+\S*$/, '') + '…'
    : flat
}

/** What a memory or a decision is called in a line: its title, or its words
 * where it has none, and the choice a decision was answered with. */
export let titleOf = (b: Bundle): string => {
  let title = String(
    part(b, 'doc').title || clip(String(part(b, 'content').body ?? '')),
  )
  let choice = part(b, 'decided').choice
  return clip(choice ? `${title} → ${choice}` : title)
}

/** How near in meaning a memory or decision must be to a person's words to be
 * listed beside them. In granite-embedding-30m-english, over the 19 inputs of
 * Jeff's in the windows of T-155224's cases, the memories on the input's
 * subject began at about .75 and the ones at .70 to .75 were on another: .65
 * listed 69 memories and 13 decisions, .75 lists 28 and none (T-161252). No
 * floor from .55 to .70 put a case's needed fact in front. */
export let FLOOR = .75

/** How near in meaning one of the person's earlier words must be to what an
 * agent wrote to be set beside it. A whole task or comment sits nearer to
 * everything than a prompt does: over the 73 things the agents of T-155224's
 * cases wrote, the third-nearest of Jeff's words was at .74 in the median, so
 * the prompt's .65 would list three beside every write. The one needed row
 * the door reaches was second at .802 (T-161252). */
export let SAID = .8

/** The memories and answered decisions nearest the words in meaning: what was
 * already kept or settled on the subject, at least `floor` similar. A
 * quarantined memory is not offered; without a meaning index there is nothing
 * to rank by, so nothing. `memories: false` answers the decisions alone. */
export async function decided(
  g: Graph,
  words: string,
  before: string,
  meaning?: Meaning,
  floor = FLOOR,
  memories = true,
): Promise<Bundle[]> {
  if (!meaning || !words.trim()) return []
  let at = `.created.at<${JSON.stringify(before)}`
  let ask = (within: string, limit: number) => meaning(words, { within, limit })
  let [kept, decisions] = await Promise.all([
    memories && g.vocab.comp('memory')
      ? ask(
        `(${at}) .memory${g.vocab.comp('quarantined') ? ' !quarantined' : ''}`,
        6,
      )
      : [],
    g.vocab.comp('decision') && g.vocab.comp('decided')
      ? ask(`(${at}) .decision .decided`, 2)
      : [],
  ])
  let ids = [...kept, ...decisions].filter((h) => h.similarity >= floor)
    .map((h) => h.entity)
  if (!ids.length) return []
  let rows = await g.get(ids, [
    'doc',
    'content',
    'created',
    'memory',
    'decision',
    'decided',
  ])
  return ids.flatMap((eid) => rows.filter((b) => b.entity.eid == eid))
}

/** What the agent that wrote something already holds: what its session wrote
 * or was told `since` (its start, or its latest compaction). */
export type Held = { via: string; since?: string }

let holds = (held: Held | undefined) => (b: Bundle): boolean => {
  if (!held) return false
  let { via, at } = part(b, 'created')
  let its = via == held.via || part(b, 'entry').session == held.via
  return its && String(at ?? '') >= (held.since ?? '')
}

/** What bears on something an agent wrote: the person's earlier words near
 * it, and the decisions answered before it. */
export type Bearing = { said: Said[]; decided: Bundle[] }

/** How many of the person's words, and how many decisions, one written thing
 * is answered with. */
export let FEW = { said: 3, decided: 2 }

/**
 * What a person said and decided before that bears on `words`, the text of
 * something an agent just wrote: their nearest earlier words at least `floor`
 * similar (default {@link SAID}), and the nearest answered decisions at least
 * {@link FLOOR} similar. What the writing session already `held` is left out.
 * There is no ranking by words here: without a meaning index, or past `wait`
 * milliseconds, nothing bears.
 */
export function bearing(
  g: Graph,
  options: Asked & { held?: Held },
): Promise<Bearing> {
  let none: Bearing = { said: [], decided: [] }
  let { person, words, before, meaning } = options
  if (
    !person || !meaning || !words.trim() ||
    !Number.isFinite(Date.parse(before))
  ) return Promise.resolve(none)
  let fresh = (b: Bundle) => !holds(options.held)(b)
  let found = async (): Promise<Bearing> => {
    let name = await named(g, person, options.name)
    let [rows, settled] = await Promise.all([
      nearest(
        g,
        meaning,
        words,
        theirs(g, { person, name, before }),
        options.floor ?? SAID,
      ),
      decided(g, words, before, meaning, FLOOR, false),
    ])
    return {
      said: quotes(
        g,
        (rows ?? []).filter(fresh),
        { person, name, words, before },
        FEW.said,
      ),
      decided: settled.filter(fresh).slice(0, FEW.decided),
    }
  }
  return within(found(), options.wait, none)
}
