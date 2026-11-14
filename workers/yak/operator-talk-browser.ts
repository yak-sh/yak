// The Operator chat page's conversation in the browser, mounted over what the
// server drew (operator-talk.ts `Talk`), as part of `_talk.js`
// (operator-rows.ts). Only page code imports it: the Workers program checks
// what the server draws with the runtime's globals, which have no DOM, so the
// DOM half of a module lives in its `-browser` file.
import { h, hydrate, render } from 'preact'
import { Host } from '@yaks/markdown'
import { client } from '@yaks/client'
import type { Bundle } from '@yaks/graph'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { docs as uxDocs } from '@yaks/ux/vocab'
import { conversed, conversingOf, TAKE } from '@yaks/ux/conversation'
import { opening } from '@yaks/session/conversation'
import { drawLines, type Lines } from './operator-draw.ts'
import {
  heard,
  type Held,
  readerAt,
  reread,
  Talk,
  typingAt,
} from './operator-talk.ts'

/** The conversation the server drew under `at`, as the page holds it. */
export let parsed = (at: ParentNode): Held | null => {
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
  // What the conversation emits: where its reader is, or a fold opened or
  // closed.
  let change = (b: Bundle) => {
    put([b])
    if (held && b.entity.eid == readerAt(held.task)) {
      let { take = TAKE, away: now = false } = conversingOf(
        front.ent(b.entity.eid),
      )
      if (now != away) onAway(away = now)
      if (held.earlier && take > held.lines.length && take > asked) {
        older(asked = take)
      }
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
        state: (eid: string) => front.ent(eid),
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
      held = {
        ...held,
        lines,
        now: 'Typing…',
        pending: true,
        doing: 'writing',
      }
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
