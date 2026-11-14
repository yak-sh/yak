// The Operator chat page's conversation, drawn by @yaks/ux's `Conversation`
// on the server (operator-view.ts `talk`) and again in the browser over what
// the server drew, as part of `_talk.js` (operator-rows.ts).
//
// The page holds the lines the server drew as it drew them, and a page graph
// (@yaks/client) that the entries its socket sends (operator-draw.ts `Lines`)
// are put into, with the reply being written and where its reader is
// (`Conversation{take, away}`). A line a step sent is drawn here from the
// entries it reads, as the server draws it; the rest stay as the server drew
// them, since the data behind a whole conversation is about twice its
// drawing. The reply being written is a page-only row of the shape the
// harness streams one in (packages/harness/streaming_test.ts): an `output`
// whose `content` grows, drawn as a settled reply is.
//
// `Talk`, `parsed`, `heard` and `reread` are pure; `mountTalk` mounts it.
import { type ComponentChildren as Node, h, hydrate, render } from 'preact'
import { Host } from '@yaks/markdown'
import { client } from '@yaks/client'
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { docs as uxDocs } from '@yaks/ux/vocab'
import {
  Conversation,
  conversationAt,
  conversed,
  conversingOf,
  TAKE,
} from '@yaks/ux/conversation'
import { opening } from '@yaks/session/conversation'
import { drawLines, type Lines } from './operator-draw.ts'

/** A line as the page holds it: the entries it reads once a step has sent
 * it (`uses`), else as the server drew it (`html`); and whether it is the
 * person's own words, which the page never takes off. */
export type Kept = {
  id: string
  uses?: string[]
  html?: string
  mine?: boolean
}

/** What its lines are drawn with beside their entries: a frame's `Lines`
 * but its lines and entries, gathered from every frame. */
export type Beside = Omit<Lines, 'lines' | 'entries'>

/** The conversation as the page holds it. */
export type Held = {
  task: string
  /** the sequence the page's reads start after */
  from?: string
  /** what it is doing now, in words, and whether it is still at it */
  now: string
  pending: boolean
  /** what the yak beside the box shows (mascot.ts `Doing`) */
  doing?: string
  /** how many lines came before those it holds */
  earlier: number
  lines: Kept[]
  beside: Beside
}

/** What the conversation is drawn with, on the server and on the page. */
export type TalkProps = {
  task: string
  lines: { id: string; node?: Node; html?: string }[]
  now: string
  pending: boolean
  doing?: string
  from?: string | number
  earlier?: number
  e: Bundle
  onChange: (b: Bundle) => void
  pane?: () => HTMLElement | null
}

/** The page entity holding where `task`'s reader is. */
export let readerAt = (task: string): string => conversationAt('operator', task)

/** The conversation: its lines, and under them what it is doing now, which
 * a screen reader hears; the yak beside the box shows it. How many lines
 * came before those drawn is said on it (`data-earlier`), for the page. */
export let Talk = (
  { task, lines, now, pending, doing, from, earlier = 0, ...rest }: TalkProps,
) => {
  let take = conversingOf(rest.e).take ?? TAKE
  let before = earlier + Math.max(0, lines.length - take)
  return h(Conversation, {
    ...rest,
    lines,
    earlier,
    now: h('span', { 'data-now': '' }, now),
    'data-task': task,
    'data-from': from,
    'data-pending': pending ? '' : undefined,
    'data-doing': pending ? doing : undefined,
    'data-earlier': before || undefined,
  })
}

/** The conversation the server drew under `at`, as the page holds it. */
export let parsed = (at: Pick<ParentNode, 'querySelector'>): Held | null => {
  let talk = at.querySelector('[data-task]') as HTMLElement | null
  if (!talk) return null
  let list = talk.querySelector('.Transcript_Lines')
  let rows = [...list?.children ?? []].filter((r) => r.id.startsWith('row-'))
  let d = talk.dataset
  return {
    task: d.task!,
    ...d.from != null ? { from: d.from } : {},
    now: talk.querySelector('[data-now]')?.textContent ?? '',
    pending: d.pending != null,
    ...d.doing ? { doing: d.doing } : {},
    earlier: Number(d.earlier ?? 0),
    lines: rows.map((r) => ({
      id: r.id.slice('row-'.length),
      html: r.innerHTML,
      ...r.querySelector('.Transcript_Bubble') ? { mine: true } : {},
    })),
    beside: { tools: {}, helpers: [], offers: {} },
  }
}

// A helper, by what started it, or the first thing it was told.
let helperKey = (h: Lines['helpers'][number]) =>
  h.call ?? h.session ?? h.entries[0]?.entity.eid

let kept = <K extends 'person' | 'called' | 'opens'>(
  key: K,
  now: Partial<Beside>,
  was: Beside,
) => {
  let value = now[key] ?? was[key]
  return value == null ? {} : { [key]: value }
}

/** What the page holds once a frame's lines have come: each line in its
 * place, or after the others when new, drawn from its entries from now on,
 * and what they are drawn with gathered. */
export let heard = (was: Held, sent: Lines): Held => {
  let lines = [...was.lines]
  for (let { id, uses } of sent.lines) {
    let at = lines.findIndex((l) => l.id == id)
    let mine = at >= 0 && lines[at].mine ? { mine: true } : {}
    if (at >= 0) lines[at] = { id, uses, ...mine }
    else lines.push({ id, uses })
  }
  let helpers = new Map(was.beside.helpers.map((h) => [helperKey(h), h]))
  for (let h of sent.helpers ?? []) helpers.set(helperKey(h), h)
  let b = was.beside
  return {
    ...was,
    lines,
    beside: {
      tools: { ...b.tools, ...sent.tools },
      offers: { ...b.offers, ...sent.offers },
      threads: { ...b.threads, ...sent.threads },
      helpers: [...helpers.values()],
      ...b.ids || sent.ids ? { ids: { ...b.ids, ...sent.ids } } : {},
      ...kept('person', sent, b),
      ...kept('called', sent, b),
      ...kept('opens', sent, b),
    },
  }
}

/** A read of the whole conversation over what the page held: the read's
 * lines, and the person's own words the page showed that the read left out,
 * put back where they were (`missing`, which the tracker hears of). */
export let reread = (
  was: Held | null,
  read: Held,
): { held: Held; missing: string[] } => {
  if (!was || was.task != read.task) return { held: read, missing: [] }
  let ids = new Set(read.lines.map((l) => l.id))
  let lines = [...read.lines]
  let missing: string[] = []
  was.lines.forEach((line, i) => {
    if (!line.mine || ids.has(line.id)) return
    missing.push(line.id)
    let after = was.lines.slice(0, i).reverse().find((l) => ids.has(l.id))
    let at = after ? lines.findIndex((l) => l.id == after.id) + 1 : 0
    lines.splice(at, 0, line)
    ids.add(line.id)
  })
  return {
    held: { ...read, lines, from: was.from ?? read.from, beside: was.beside },
    missing,
  }
}

/** The page-only row of the reply being written in `task`. */
export let typingAt = (task: string): string =>
  derivedEid(['Operator reply being written', task].join('|'))

/** The page graph's words: the store's (operator-words.ts `pageDocs`), and
 * where the reader is, unless the store speaks those too. */
export let pageWords = (words: VocabDoc[]): VocabDoc[] =>
  words.some((d) => d.$defs?.Conversation) ? words : [...words, ...uxDocs]

// Each set of words loaded once, however many conversations hold them.
let loaded = new WeakMap<VocabDoc[], Vocab>()
let vocabOf = (words: VocabDoc[]) => {
  let v = loaded.get(words) ?? loadVocab(pageWords(words))
  loaded.set(words, v)
  return v
}

/** What the page does to its conversation. */
export type Talking = ReturnType<typeof mountTalk>

/**
 * The conversation mounted over what the server drew in `box`, its page
 * graph over the store's `words` (`_words.js`, client-assets.ts): a step's frame (`heard`), a reply as it is
 * written (`typed`), a whole read (`read`, the `?talk=` answer's HTML) and
 * Stop pressed (`stopped`). Where its reader is goes to `onAway`, and
 * `newest` takes them back; `older` is asked for a read of `take` lines when
 * the reader asks for lines the page does not hold.
 */
export let mountTalk = (
  {
    box,
    words,
    mentions,
    pane,
    onAway = () => {},
    older = () => {},
    clock = () => new Date().toISOString(),
  }: {
    box: HTMLElement
    words: VocabDoc[]
    mentions?: string
    pane?: () => HTMLElement | null
    onAway?: (away: boolean) => void
    older?: (take: number) => void
    clock?: () => string
  },
) => {
  let front = client(vocabOf(words), [], {
    vault: false,
    wireVault: false,
    provenance: false,
  })
  // What the store sent, as @yaks/sync puts a server's rows in a page's graph
  // (its `replicate`), and what the page holds of its own: committed at once,
  // over a memory store.
  let put = (bundles: Bundle[]) =>
    void front.graph.apply(bundles, {
      trusted: true,
      replica: true,
      stamp: false,
    })
  let held = parsed(box)
  let away = false
  let asked = 0
  let state = (task: string) =>
    front.ent(readerAt(task)) ?? { entity: { eid: readerAt(task) } }
  let change = (b: Bundle) => {
    put([b])
    let { take = TAKE, away: now = false } = conversingOf(
      front.ent(b.entity.eid),
    )
    if (now != away) onAway(away = now)
    if (held?.earlier && take > held.lines.length && take > asked) {
      older(asked = take)
    }
    draw()
  }
  // Each line a step sent, drawn from its entries as the server draws it.
  let shown = (talk: Held) =>
    talk.lines.map((line) => {
      if (!line.uses) return { id: line.id, html: line.html }
      let [drawn] = drawLines({
        ...talk.beside,
        lines: [{ id: line.id, uses: line.uses }],
        entries: line.uses.flatMap((eid) => front.ent(eid) ?? []),
      })
      return { id: line.id, node: drawn?.node ?? null }
    })
  let tree = (talk: Held) =>
    h(
      Host.Provider,
      { value: opening(mentions) },
      h(Talk, {
        ...talk,
        lines: shown(talk),
        e: state(talk.task),
        onChange: change,
        pane,
      }),
    )
  // Over what the server drew it hydrates; a conversation it did not draw
  // (a request just taken up) replaces what the box held.
  let mounted = false
  let draw = (fresh = false) => {
    if (!held) return
    if (fresh) render(null, box), box.replaceChildren(), mounted = false
    if (mounted) return render(tree(held), box)
    mounted = true
    ;(box.firstChild ? hydrate : render)(tree(held), box)
  }
  draw()
  let typing = false
  return {
    /** the task the page shows, once it shows one */
    task: () => held?.task,
    /** whether the conversation is at work */
    working: () => !!held?.pending,
    /** what the yak beside the box shows */
    doing: () => held?.doing,
    /** the sequence the page's reads start after */
    from: () => held?.from,
    /** a step's frame (operator-view.ts `frame`) */
    heard: (
      o: { task: string; lines?: Lines; now?: string; doing?: string },
    ) => {
      if (!held || o.task != held.task || !o.lines) return
      put(o.lines.entries)
      typing = false
      let next = heard(held, o.lines)
      let written = typingAt(held.task)
      held = {
        ...next,
        lines: next.lines.filter((l) => l.id != written),
        now: o.now ?? '',
        pending: !!o.now,
        ...o.doing ? { doing: o.doing } : {},
      }
      draw()
    },
    /** words of a reply as they are written, until the step lands */
    typed: (text: string) => {
      if (!held) return
      let eid = typingAt(held.task)
      let body = typing
        ? String((front.ent(eid)?.content as { body?: string })?.body ?? '')
        : ''
      put([{
        entity: { eid },
        output: {},
        content: { body: body + text },
        ...typing ? {} : { created: { at: clock() } },
      }])
      typing = true
      let lines = held.lines.some((l) => l.id == eid)
        ? held.lines
        : [...held.lines, { id: eid, uses: [eid] }]
      held = { ...held, lines, now: 'Typing…', pending: true, doing: 'writing' }
      draw()
    },
    /** the whole conversation read again, as the `?talk=` answer drew it;
     * what it answers is the person's words it left out */
    read: (html: string): string[] => {
      let made = box.ownerDocument.createElement('template')
      made.innerHTML = html
      let read = parsed(made.content)
      if (!read) return []
      let fresh = held?.task != read.task
      let { held: next, missing } = reread(held, read)
      held = next
      draw(fresh)
      return missing
    },
    /** Stop pressed, which takes effect here at once; what it answers puts
     * it back, should the stop fail */
    stopped: () => {
      if (!held) return () => {}
      let { now, pending } = held
      held = { ...held, now: 'Stopped.', pending: false }
      draw()
      return () => {
        if (held) held = { ...held, now, pending }
        draw()
      }
    },
    /** back to the newest line */
    newest: () => {
      if (held) change(conversed(state(held.task), { away: false }))
    },
  }
}
