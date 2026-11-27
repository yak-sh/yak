// The Operator chat page's conversation in the browser, mounted over what the
// server drew (operator-talk.ts `Talk`), as part of `_talk.js`
// (operator-rows.ts). Only page code imports it: the Workers program checks
// what the server draws with the runtime's globals, which have no DOM, so the
// DOM half of a module lives in its `-browser` file.
import { createElement as h } from 'react'
import { hydrate, render } from '@yaks/react/draw'
import { Host } from '@yaks/markdown'
import { pageGraph } from '@yaks/platform/page-graph'
import type { Bundle } from '@yaks/graph'
import { isPromise } from '@yaks/fp'
import { replicate } from '@yaks/sync'
import type { VocabDoc } from '@yaks/vocab'
import { docs as uxDocs } from '@yaks/ux/vocab'
import {
  conversed,
  conversingOf,
  isOpen,
  Loading,
  TAKE,
} from '@yaks/ux/conversation'
import { Button, Notice } from '@yaks/ui/parts'
import { opening, unsaid } from '@yaks/session/conversation'
import { inputOf } from '@yaks/session/intake'
import { drawLines, type Lines } from './operator-draw.ts'
import {
  heard,
  type Held,
  readerAt,
  removed,
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
      // a helper's row while the helper works (operator-draw.ts `put`)
      ...r.querySelector('.Transcript_Entry-helper [data-going]')
        ? { live: true }
        : {},
    })),
    beside: { tools: {}, helpers: [], offers: {} },
  }
}

/** The page graph's words: the store's (operator-words.ts `pageDocs`), and
 * where the reader is, unless the store speaks those too. */
export let pageWords = (words: VocabDoc[]): VocabDoc[] =>
  words.some((d) => d.$defs?.Conversation) ? words : [...words, ...uxDocs]

/** What the page does to its conversation. */
export type Talking = ReturnType<typeof mountTalk>

/**
 * The conversation mounted over what the server drew in `box`, in the tab's
 * page graph (@yaks/platform/page-graph), drawn for `person` and grown with
 * the store's `words` (`_words.js`, assets.ts): a step's frame (`heard`), a
 * reply's words as written so far (`typed`), a whole read (`read`, the
 * `?talk=` answer's HTML) and
 * Stop pressed (`stopped`). Where its reader is goes to `onAway`, and
 * `newest` takes them back; `older` is asked for a read of `take` lines when
 * the reader asks for lines the page does not hold. A fold drawn closed
 * holding only `Loading…` (@yaks/ux `Disclosure` `lazy`) in a line held as
 * the server drew it opens at once, and `unfold` fetches that line's entries,
 * from which it is drawn here from then on; a fetch that fails says so in the
 * fold, with a retry, and goes to `onError`.
 */
export let mountTalk = (
  {
    box,
    words,
    person,
    mentions,
    pane,
    onAway = () => {},
    older = () => {},
    unfold,
    onError = (e) => globalThis.reportError?.(e),
    clock = () => new Date().toISOString(),
  }: {
    box: HTMLElement
    words: VocabDoc[]
    person: string
    mentions?: string
    pane?: () => HTMLElement | null
    onAway?: (away: boolean) => void
    older?: (take: number) => void
    unfold?: (line: string) => Promise<Lines | null>
    onError?: (error: Error) => void
    clock?: () => string
  },
) => {
  let front = pageGraph(pageWords(words), person)
  // What the store sent, and what the page holds of its own, put in the page
  // graph as @yaks/sync puts a server's rows there (its `replicate`), so none
  // of it is sent back as the page's write; and `then` once it
  // is in: at once over a memory store, or once the graph has landed what it
  // was landing before (a frame of the tab's other watches).
  let put = (bundles: Bundle[], then = () => {}) => {
    let landed = replicate(front.graph, bundles)
    if (isPromise(landed)) landed.then(then, onError)
    else then()
  }
  let held = parsed(box)
  // The tab's page graph may hold this conversation's own state from an
  // earlier visit to it: the page as the server drew it now is what stands,
  // the reader at the newest line and each fold as it was drawn.
  put([
    ...held
      ? [{ entity: { eid: readerAt(held.task) }, Conversation: null }]
      : [],
    ...[...box.querySelectorAll('[data-disclosure]')].map((fold) => ({
      entity: { eid: fold.getAttribute('data-disclosure')! },
      Disclosure: fold.hasAttribute('open') ? { open: true } : null,
    })),
  ])
  let away = false
  let asked = 0
  let state = (task: string) =>
    front.ent(readerAt(task)) ?? { entity: { eid: readerAt(task) } }
  // What the conversation emits: where its reader is, or a fold opened or
  // closed.
  let change = (b: Bundle) => {
    put([b])
    if (isOpen(b)) unfolded(b.entity.eid)
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
        lines: [{ id: line.id, uses: line.uses, of: line.of }],
        entries: line.uses.flatMap((eid) => front.ent(eid) ?? []),
      })
      return { id: line.id, node: drawn?.node ?? null }
    })
  // The person's words this page sent, drawn at once as the line the store
  // gives them (@yaks/session `inputOf` of the request the page chose) until
  // a step or a read brings that line, or the send fails (`sent`).
  let going: string[] = []
  let sending = (talk: Held): Held => {
    let ids = new Set(talk.lines.map((l) => l.id))
    going = going.filter((id) => !ids.has(id))
    if (!going.length) return talk
    return {
      ...talk,
      lines: [...talk.lines, ...going.map((id) => ({ id, uses: [id] }))],
      ...talk.now ? {} : { now: 'Sending…', pending: true },
    }
  }
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
    if (mounted) return render(tree(sending(held)), box)
    mounted = true
    ;(box.firstChild ? hydrate : render)(tree(sending(held)), box)
  }
  draw()
  // A lazy fold opened in a line held as the server drew it, which holds
  // only `Loading…`: the line's entries fetched, and the line drawn from them
  // as the server drew it, so the fold keeps its place and whether it is open.
  // One that could not be fetched says so, with a retry.
  let fetching = new Set<string>()
  let folds = new Set<HTMLElement>()
  let closeFold = (body: HTMLElement) => {
    folds.delete(body)
    render(null, body)
  }
  let unfolded = (eid: string) => {
    let fold = box.querySelector(`[data-lazy][data-disclosure="${eid}"]`)
    // The line the page holds whose row holds the fold: a fold in a run of
    // steps stands in a row of its own inside the run's.
    let line = fold &&
      held?.lines.find((l) => box.querySelector(`#row-${l.id}`)?.contains(fold))
    let id = line?.id
    if (!fold || !id || !line || line.uses || !unfold || fetching.has(id)) {
      return
    }
    let body = fold.lastElementChild as HTMLElement
    fetching.add(id)
    folds.add(body)
    render(h(Loading, null), body)
    unfold(id).then((sent) => {
      if (!held) return
      if (!sent?.lines.some((l) => l.id == id)) {
        throw new Error(`Line ${id} was not among the lines fetched to open`)
      }
      fetching.delete(id)
      closeFold(body)
      held = heard(held, sent)
      put(sent.entries, () => draw())
    }).catch((e) => {
      fetching.delete(id)
      if (!held) return
      onError(e)
      render(
        h(
          Notice,
          { mod: 'negative' },
          'This could not be opened. ',
          h(Button, {
            type: 'button',
            mod: 'quiet',
            onClick: () => unfolded(eid),
          }, 'Try again'),
        ),
        body,
      )
    })
  }
  // Whether a reply is being written.
  let typing = false
  return {
    close: () => {
      held = null
      for (let body of folds) closeFold(body)
      // What it drew stays standing, so a page laid over this one
      // (@yaks/ui/navigate) keeps every line both pages hold rather than
      // drawing the conversation again.
      let drawn = [...box.childNodes]
      render(null, box)
      box.replaceChildren(...drawn)
    },
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
      put(o.lines.entries, () => draw())
    },
    /** a reply's words as written so far, until the step lands */
    typed: (text: string) => {
      if (!held) return
      let eid = typingAt(held.task)
      let entry = {
        entity: { eid },
        output: {},
        content: { body: text },
        ...typing ? {} : { created: { at: clock() } },
      }
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
      put([entry], () => draw())
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
      // A fold open as the server drew it again holds only Loading: its line
      // is fetched again, as when it was opened.
      for (let fold of box.querySelectorAll('[data-lazy][open]')) {
        let eid = fold.getAttribute('data-disclosure')
        if (eid) unfolded(eid)
      }
      return missing
    },
    /** lines whose entries were removed from the store, taken off */
    removed: (ids: string[]) => {
      if (!held || !ids.length) return
      held = removed(held, ids)
      draw()
    },
    /** the person's words sent under `request`, with the names of the files
     * sent beside them, drawn at once; what it answers takes them back, should
     * the send fail */
    sent: (request: string, text: string, files: string[] = []) => {
      if (!held) return () => {}
      let eid = inputOf(request), back = false
      put([{
        entity: { eid },
        entry: { session: held.task },
        created: { at: clock() },
        content: {
          body: text || unsaid(files.map((name) => ({ name }))),
        },
      }], () => {
        if (back) return
        going = [...going.filter((id) => id != eid), eid]
        draw()
      })
      return () => {
        back = true
        going = going.filter((id) => id != eid)
        draw()
      }
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
