/**
 * The Friends page kept current while it is open. Every {@link EVERY}, and
 * on coming back to the tab, the page says its tab to the page's own address
 * (so friends see this person on yaks.app too) and is answered with where
 * each friend is. The answer lands in the page's own graph, a @yaks/client
 * over RAM that no server hears of, as one `friendSeen{state, last}` row a
 * friend (./friends-front.json), and the rows paint the list the server drew
 * ({@link paint}): the green dot, "Active 3 hours ago", and online friends
 * first. Closing the tab says it is gone.
 *
 * The list is `[data-friends="<the page's address>"]`, each friend a
 * `[data-friend="<person>"]` holding its `[data-friend-dot]` and
 * `[data-friend-seen]`.
 *
 * @module
 */

import { type Client, client } from '@yaks/client'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { leaving, PAGE } from '@yaks/ui/navigate'
import { said } from '@yaks/ui/relative'
import { online as here, ordered, type Seen, seenWords } from './presence.ts'
import doc from './friends-front.json' with { type: 'json' }

/** How often an open page asks again. */
export let EVERY = 30_000

/** The page's answer: each friend's eid and where they are. */
export type Answer = { friends: (Seen & { person: string })[] }

/** Paint each friend in `list` as `seen` says, and put them in order. */
export let paint = (
  list: Element,
  seen: (person: string) => Seen | undefined,
  now: number = Date.now(),
): void => {
  let rows = [...list.querySelectorAll<HTMLElement>(':scope > [data-friend]')]
  for (let row of rows) {
    let s = seen(row.dataset.friend!)
    row.classList.toggle('Friend-here', here(s))
    let dot = row.querySelector<HTMLElement>('[data-friend-dot]')
    if (dot) dot.hidden = !here(s)
    let line = row.querySelector<HTMLElement>('[data-friend-seen]')
    if (!line) continue
    let words = seenWords(s, now)
    if (s?.last && !here(s)) {
      let at = line.ownerDocument.createElement('time')
      at.className = 'Time'
      at.setAttribute('datetime', s.last)
      at.setAttribute('data-relative', '')
      at.textContent = said(s.last, { now })
      line.replaceChildren('Active ', at)
    } else line.textContent = words
    line.hidden = !words
  }
  let sorted = ordered(rows, (r) => seen(r.dataset.friend!))
  if (sorted.some((r, i) => r != rows[i])) list.append(...sorted)
}

let front = (): Client =>
  client(loadVocab([doc as VocabDoc]), [], {
    vault: false,
    wireVault: false,
    page: false,
  })

/** Keep one Friends list current until its page is left. */
export let keep = (
  list: HTMLElement,
  page: Client = front(),
  doc: Document = list.ownerDocument,
): void => {
  let address = list.dataset.friends!
  let lifetime = leaving(doc)
  let watch = page.watch('.friendSeen', { remote: false })
  let held = () =>
    new Map(
      watch.value.map((r) => [r.entity.eid, r.friendSeen as Seen]),
    )
  watch.subscribe(() => {
    let now = held()
    paint(list, (p) => now.get(p))
  })
  let tab = () =>
    doc.visibilityState != 'visible'
      ? 'background'
      : doc.hasFocus()
      ? 'here'
      : 'background'
  let busy = false
  let ask = async () => {
    if (busy || doc.hidden) return
    busy = true
    try {
      let answer = await fetch(address, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        body: new URLSearchParams({ tab: tab() }),
      })
      if (!answer.ok) return
      let { friends } = await answer.json() as Answer
      await page.mutate(friends.map(({ person, state, last }) => ({
        entity: { eid: person },
        friendSeen: { state: state ?? null, last: last ?? null },
      })))
    } finally {
      busy = false
    }
  }
  let again = () => void ask().catch(() => {})
  let timer = setInterval(again, EVERY)
  let window = doc.defaultView!
  doc.addEventListener('visibilitychange', again, { signal: lifetime })
  window.addEventListener('focus', again, { signal: lifetime })
  window.addEventListener('pagehide', () => {
    navigator.sendBeacon(address, new URLSearchParams({ tab: 'away' }))
  }, { signal: lifetime })
  lifetime.addEventListener('abort', () => {
    clearInterval(timer)
    watch.close()
  }, { once: true })
  again()
}

let start = (doc: Document = document) => {
  let kept = new Set<Element>()
  let each = () => {
    for (let list of doc.querySelectorAll<HTMLElement>('[data-friends]')) {
      if (kept.has(list)) continue
      kept.add(list)
      leaving(doc).addEventListener('abort', () => kept.delete(list))
      keep(list)
    }
  }
  each()
  doc.addEventListener(PAGE, each)
}

if (typeof document != 'undefined') start()
