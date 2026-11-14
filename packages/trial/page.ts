/**
 * The page a person taps through a round's pairs on: one pair at a time, each
 * side drawn by what it is (./sides.ts), a tap on the one they choose under
 * the pair's question, or neither. The next pair is the one their own taps'
 * rating says is closest (./rating.ts), so a pair whose answer their earlier
 * taps already settle is not asked. Each tap is written the moment it is
 * made, through the page's own door (`/web/apply`), which signs it as the
 * graph's person; a write that fails is kept and sent again. The deck comes
 * from ./routes.ts and is ./skill.ts's `deck`.
 *
 * @module
 */
import type { H } from '@yaks/render'
import { next } from './rating.ts'
import { draw } from './sides.ts'
import type { Card, Deck, Side } from './skill.ts'

/** What the page reaches the world through. */
export type Io = {
  fetch: (input: string, init?: RequestInit) => Promise<Response>
  /** the page's own path, `/trial/<rounds>` */
  path: string
  /** where an unsent write and an unsaved why are kept */
  store: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  uuid: () => string
  /** runs `f` later, to send again what failed */
  later: (f: () => void) => void
}

type Bundle = Record<string, unknown>
type Shown = Card & { deck: Deck }
type Kid = Node | string | false | null | undefined

let OUTBOX = 'trial:outbox'

/** Draws the page in `root` and answers once the first card shows. */
export let mount = async (root: Element, io: Io): Promise<void> => {
  let doc = root.ownerDocument!
  let h = (
    tag: string,
    props: Record<string, unknown> | null = {},
    ...kids: Kid[]
  ): HTMLElement => {
    let el = doc.createElement(tag) as HTMLElement
    for (let [k, v] of Object.entries(props ?? {})) {
      if (typeof v == 'function') el.addEventListener(k, v as EventListener)
      else if (v != null && v !== false) el.setAttribute(k, String(v))
    }
    for (let kid of kids) {
      if (kid) el.append(typeof kid == 'string' ? doc.createTextNode(kid) : kid)
    }
    return el
  }

  let cards: Shown[] = []
  let at = 0
  // The cards shown before this one, for Back, and those skipped.
  let trail: number[] = []
  let skipped = new Set<number>()
  let composing = false
  let saved = ''

  // Writes leave in order, and one that fails stays first in line.
  let outbox: Bundle[][] = JSON.parse(io.store.getItem(OUTBOX) ?? '[]')
  let sending: Promise<void> | undefined
  let keep = () => io.store.setItem(OUTBOX, JSON.stringify(outbox))
  let say = (text: string) => {
    saved = text
    let line = root.querySelector('.status')
    if (line) line.textContent = text
  }
  let flush = (): Promise<void> =>
    sending ??= (async () => {
      while (outbox.length) {
        let ok = await io.fetch('/web/apply', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(outbox[0]),
        }).then((r) => r.ok, () => false)
        if (!ok) {
          say('Not saved yet. It is kept here and will be sent again.')
          io.later(() => void flush())
          return
        }
        outbox.shift()
        keep()
      }
      say('')
    })().finally(() => sending = undefined)
  let send = (bundles: Bundle[]) => {
    outbox.push(bundles)
    keep()
    return flush()
  }

  let load = async () => {
    let got = await io.fetch(io.path, {
      headers: { accept: 'application/json' },
    })
    if (!got.ok) throw new Error((await got.text()) || `status ${got.status}`)
    let { decks } = await got.json() as { decks: Deck[] }
    cards = decks.flatMap((deck) => deck.cards.map((c) => ({ ...c, deck })))
  }
  // The card the rating picks next, or past the end where none is left: each
  // round and question rated on its own.
  let upcoming = () =>
    next(
      cards.map((c) => ({
        a: c.first.eid,
        b: c.second.eid,
        chose: c.chose,
        group: `${c.deck.round}|${c.question ?? ''}`,
      })),
      (i) => skipped.has(i),
    ) ?? cards.length
  let forward = () => {
    if (at < cards.length) trail.push(at)
    go(upcoming())
  }
  let go = (to: number) => {
    at = to
    composing = false
    paint()
  }

  let between = (c: Card) =>
    `trial:why:${c.first.eid}|${c.second.eid}${
      c.question ? `|${c.question}` : ''
    }`
  let why = (c: Card) => io.store.getItem(between(c)) ?? c.why ?? ''

  let choose = (c: Shown, chose: string | null) => {
    c.chose = chose
    c.preference ??= io.uuid()
    let said = why(c).trim()
    if (said) c.why = said
    io.store.removeItem(between(c))
    void send([{
      entity: { eid: c.preference },
      preference: {
        first: c.first.eid,
        second: c.second.eid,
        chose,
        ...c.pair ? { pair: c.pair } : {},
        ...said ? { why: said } : {},
      },
    }])
    forward()
  }
  let grab = (p: Side) => {
    if (p.grabbed) {
      void send([{ entity: { eid: p.grabbed }, $delete: true }])
      delete p.grabbed
    } else {
      p.grabbed = io.uuid()
      void send([{ entity: { eid: p.grabbed }, grabbed: { attempt: p.eid } }])
    }
    paint()
  }
  // A why typed before the tap waits here for it; one typed after is written
  // when the field is left.
  let explain = (c: Shown, text: string) => {
    if (!c.preference) return
    c.why = text.trim()
    io.store.removeItem(between(c))
    void send([{
      entity: { eid: c.preference },
      preference: { why: c.why || null },
    }])
  }
  let add = async (c: Shown, output: Record<string, string>) => {
    await send([{
      entity: { eid: io.uuid() },
      writing: { round: c.deck.round, case: c.case, output },
    }])
    await load()
    go(at)
  }

  let pitch = (c: Shown, p: Side) => {
    return h(
      'article',
      {
        class: `pitch${c.chose == p.eid ? ' chosen' : ''}`,
        'data-eid': p.eid,
        click: (e: Event) => {
          let on = e.target as Element
          if (!on.closest?.('button, summary, a')) choose(c, p.eid)
        },
      },
      draw(p.shown, h as unknown as H<Node>, c.deck.parts),
      h(
        'footer',
        {},
        h('button', {
          class: 'grab',
          type: 'button',
          'aria-pressed': String(!!p.grabbed),
          click: () => grab(p),
        }, p.grabbed ? '★ Grabs me' : '☆ Grabs me'),
      ),
    )
  }

  let compose = (c: Shown) => {
    let fields = c.deck.parts.map((name, i) =>
      h(i ? 'textarea' : 'input', { name, placeholder: name, rows: i + 1 })
    )
    return h(
      'form',
      {
        class: 'own',
        submit: (e: Event) => {
          e.preventDefault()
          let output = Object.fromEntries(
            fields.map((f) => [
              f.getAttribute('name')!,
              (f as HTMLInputElement).value.trim(),
            ]),
          )
          if (Object.values(output).some((v) => v)) void add(c, output)
        },
      },
      h('p', { class: 'about' }, `Your own pitch for: ${c.title}`),
      ...fields,
      h('button', { type: 'submit' }, 'Add it to the deck'),
      h('button', {
        type: 'button',
        class: 'quiet',
        click: () => {
          composing = false
          paint()
        },
      }, 'Cancel'),
    )
  }

  let paint = () => {
    let c = cards[at]
    let chosen = cards.filter((x) => x.chose !== undefined).length
    let bar = h(
      'header',
      {},
      h('button', {
        class: 'back',
        type: 'button',
        'aria-label': 'Back',
        disabled: !trail.length,
        click: () => go(trail.pop()!),
      }, '‹'),
      h(
        'span',
        { class: 'place' },
        c ? `${trail.length + 1} of ${cards.length} · ${c.deck.title}` : 'Done',
      ),
      h('button', {
        class: 'skip',
        type: 'button',
        'aria-label': 'Skip',
        disabled: !c,
        click: () => {
          if (c.chose === undefined) skipped.add(at)
          forward()
        },
      }, '›'),
    )
    let settled = cards.length - chosen - skipped.size
    let body: Kid[] = !c
      ? [h(
        'p',
        { class: 'done' },
        cards.length
          ? `That is all: ${chosen} chosen, ${skipped.size} skipped${
            settled ? `, ${settled} settled by your other choices` : ''
          }.`
          : 'No pairs here yet.',
      )]
      : composing
      ? [compose(c)]
      : [
        (c.title || !c.question) && h(
          'p',
          { class: 'about' },
          c.title || 'Which would you rather read on from?',
        ),
        !!c.question && h('h1', { class: 'question' }, c.question),
        pitch(c, c.first),
        pitch(c, c.second),
        h('button', {
          class: `neither${c.chose === null ? ' chosen' : ''}`,
          type: 'button',
          click: () => choose(c, null),
        }, 'Neither'),
        h('input', {
          class: 'why',
          placeholder: 'Why? A few words, if you like',
          value: why(c),
          input: (e: Event) =>
            io.store.setItem(between(c), (e.target as HTMLInputElement).value),
          change: (e: Event) =>
            explain(c, (e.target as HTMLInputElement).value),
        }),
        !!c.title && h('button', {
          class: 'quiet add',
          type: 'button',
          click: () => {
            composing = true
            paint()
          },
        }, 'Add a pitch of my own'),
      ]
    root.replaceChildren(
      bar,
      ...body.filter((kid): kid is Node => !!kid),
      h('p', { class: 'status' }, saved),
    )
  }

  try {
    await load()
    // Opened again, Back goes through what was chosen before.
    trail = cards.flatMap((c, i) => c.chose === undefined ? [] : [i])
    at = upcoming()
    paint()
    if (outbox.length) void flush()
  } catch (error) {
    root.replaceChildren(h('p', { class: 'done' }, String(error)))
  }
}

/** Mounts the page in a browser. */
export let boot = (): Promise<void> =>
  mount(document.querySelector('main')!, {
    fetch: (input, init) => fetch(input, init),
    path: location.pathname,
    store: localStorage,
    // randomUUID needs a secure context; a tailnet address over http has none.
    uuid: () =>
      crypto.randomUUID?.() ??
        '10000000-1000-4000-8000-100000000000'.replace(
          /[018]/g,
          (c) =>
            (+c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> +c / 4)
              .toString(16),
        ),
    later: (f) => void setTimeout(f, 5000),
  })
