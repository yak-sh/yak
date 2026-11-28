/**
 * The friends dock in the browser (T-3528): drawn from the tab's page graph
 * (./page-graph.ts) as its rows move and as the person moves in it, over
 * every signed-in page. The dock is the tab's, not a page's: a swap leaves it
 * as it stands (@yaks/ui/navigate `KEPT`), open, in a conversation, typed in,
 * and this goes on drawing it; the page's bar launcher, which each page
 * brings, is drawn again on each.
 *
 * Opening a friend draws their conversation from the messages the tab holds,
 * in the same frame, and marks theirs read. A message is written through the
 * graph as the message it will be (./account-rows.ts `friendMessage`), so it
 * shows at once and the directory's answer is the same row; a refusal puts
 * the words back. What is typed is a draft (@yaks/draft), one a friend, kept
 * across pages, tabs and devices. A message that comes while its
 * conversation is not on screen raises a quiet toast and the launcher's
 * count, never a dialog.
 *
 * While the panel is open it holds the page to what a person sees, as the
 * Operator's chat does (@yaks/ux/conversation `fit`): a phone's keyboard
 * shortens the panel rather than scrolling the page, so the box sits on the
 * keyboard, and a conversation at its newest stays there as it shortens. At
 * a phone's width the open panel is a screen of its own, and the phone's
 * back closes it: opening it adds a step to history at the same address,
 * which navigation leaves be, and closing it any other way takes that step
 * back.
 *
 * @module
 */
import { fragment } from '@yaks/html/dom'
import type { Client } from '@yaks/client'
import { mint } from '@yaks/graph'
import { morph, PAGE } from '@yaks/ui/navigate'
import { fit } from '@yaks/ux/conversation'
import {
  accountWords,
  FRIEND_MESSAGES,
  FRIENDS,
  friendsOf,
  messagesOf,
} from './account-rows.ts'
import { refusal, tell } from './account-browser.ts'
import {
  barLauncher,
  DOCK,
  type DockAt,
  type DockView,
  dockView,
  type Held,
  PANEL,
  unread,
} from './friends-dock-view.ts'
import { pageGraph } from './page-graph.ts'
import { settingsDrafts } from './settings-drafts-browser.ts'

/** How long a toast stays. */
export let TOAST = 6_000

/** The dock's element. */
export let VIEW = `#${DOCK}[data-friends-dock]`

/** Where the open panel takes the screen (@yaks/ui/Dock.css). */
export let PHONE = '(max-width: 700px)'

/** The drafts the dock keeps what is typed to each friend in, by the
 * friend's eid. */
export type Typed = {
  bind: (field: HTMLTextAreaElement, friend: string) => () => void
  spend: (friend: string) => Promise<boolean>
  restore: (friend: string, text: string) => void
}

/** What the dock needs beside its root: the page graph, its drafts (made
 * when first wanted), and the clock. */
export type Docking = {
  graph: Pick<Client, 'watch' | 'mutate'>
  drafts: () => Typed
  now?: () => number
  timer?: (fn: () => void, ms: number) => unknown
}

/** Keep the dock `root` drawn from its graph and moved by the person; the
 * answer lets go. */
export let bindDock = (root: HTMLElement, o: Docking): () => void => {
  let doc = root.ownerDocument
  let view = JSON.parse(root.dataset.friendsDock!) as DockView
  let me = view.person
  let now = o.now ?? Date.now
  let timer = o.timer ?? ((fn, ms) => setTimeout(fn, ms))
  let friends = o.graph.watch(FRIENDS)
  let messages = o.graph.watch(FRIEND_MESSAGES)
  let at: DockAt = {}
  let known: Set<string> | undefined
  let asked = new Set<string>()
  let field: { el: HTMLTextAreaElement; stop: () => void } | undefined
  let panel = () => doc.getElementById(PANEL) as HTMLElement | null
  // Whether the panel is open, as its last `toggle` said.
  let opened = false
  let shown = () => opened
  let held = () => messagesOf(messages.value) as Held[]
  let listed = () => friends.ready ? friendsOf(friends.value) : undefined
  let body = () => root.querySelector<HTMLElement>('[data-dock-said]')
  let win = doc.defaultView
  // What holds the page to what a person sees while the panel is open.
  let unfit = () => {}
  // Whether the conversation was at its newest when it last scrolled.
  let newest = true
  let pin = () => {
    let said = body()
    if (said && newest) said.scrollTop = said.scrollHeight
  }
  let sizes = win?.ResizeObserver ? new win.ResizeObserver(pin) : undefined
  let sized: Element | null = null
  // The step in history the open panel stands on, at a phone's width.
  let stepped = false
  let step = () => {
    if (stepped || !win?.matchMedia?.(PHONE).matches) return
    let state = win.history.state
    win.history.pushState({ ...state, [PANEL]: true }, '', win.location.href)
    stepped = true
  }
  let unstep = () => {
    if (!stepped) return
    stepped = false
    if (win!.history.state?.[PANEL]) win!.history.back()
  }

  // The open conversation's messages to the person, read once it shows.
  let read = () => {
    if (!at.friend || !shown()) return
    let fresh = unread(held(), me, at.friend).filter((m) => !asked.has(m.eid))
    if (!fresh.length) return
    for (let m of fresh) asked.add(m.eid)
    Promise.resolve(o.graph.mutate(
      fresh.map((m) => ({
        entity: { eid: m.eid },
        friendMessage: { read: true },
      })),
    )).catch((e: unknown) => {
      for (let m of fresh) asked.delete(m.eid)
      globalThis.reportError?.(e)
    })
  }

  // The composer of the open conversation kept as its friend's draft.
  let keep = () => {
    let el = root.querySelector<HTMLTextAreaElement>(
      '[data-friend-message] [name=say]',
    )
    if (el == field?.el) return
    field?.stop()
    field = el ? { el, stop: o.drafts().bind(el, at.friend!) } : undefined
  }

  let draw = () => {
    let list = listed()
    let rows = held()
    let said = body()
    let end = !said ||
      said.scrollTop + said.clientHeight >= said.scrollHeight - 2
    let next = root.cloneNode(false) as HTMLElement
    next.append(fragment(doc, dockView(view, list, rows, at, now())))
    morph(root, next)
    for (let bar of doc.querySelectorAll('[data-dock-bar]')) {
      let fresh = fragment(doc, barLauncher(list, rows, me)).firstElementChild!
      morph(bar, fresh)
    }
    keep()
    let after = body()
    if (after && (end || after != said)) {
      after.scrollTop = after.scrollHeight
      newest = true
    }
    if (after != sized) {
      if (sized) sizes?.unobserve(sized)
      if (after) sizes?.observe(after)
      sized = after
    }
    read()
  }

  // A message to the person that came since the last answer, where its
  // conversation is not on screen, said in a toast for a while.
  let heard = () => {
    if (!messages.ready) return
    let rows = held()
    if (known) {
      let came = rows.filter((m) =>
        !known!.has(m.eid) && m.to == me && !m.read &&
        !(shown() && at.friend == m.from)
      ).at(-1)
      if (came) {
        at.toast = came.eid
        timer(() => {
          if (at.toast != came.eid) return
          at.toast = undefined
          draw()
        }, TOAST)
      }
    }
    known = new Set(rows.map((m) => m.eid))
  }

  let open = (friend: string | undefined) => {
    at = { friend }
    if (!shown()) panel()?.showPopover?.()
    draw()
    if (friend && globalThis.matchMedia?.('(pointer: fine)').matches) {
      field?.el.focus()
    }
  }

  let click = (e: Event) => {
    let hit = (e.target as Element).closest?.(
      '[data-dock-friend], [data-dock-back]',
    ) as HTMLElement | null
    if (!hit || !root.contains(hit)) return
    open(hit.dataset.dockFriend)
  }

  let submit = async (e: Event) => {
    let form = e.target as HTMLFormElement
    let to = form.dataset.friendMessage
    let asking = form.hasAttribute('data-friend-ask')
    if (to === undefined && !asking) return
    e.preventDefault()
    let input = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      asking ? '[name=email]' : '[name=say]',
    )!
    let words = input.value.trim()
    if (!words) return
    tell(form, '')
    if (asking) {
      try {
        await o.graph.mutate([{
          entity: { eid: mint() },
          friendAsk: { email: words },
        }])
        input.value = ''
        tell(form, 'Asked. They’ll see it in their Updates.')
      } catch (error) {
        tell(form, refusal(error, 'That could not be sent. Try again.'), true)
      }
      return
    }
    let drafts = o.drafts()
    void drafts.spend(to!)
    input.value = ''
    try {
      await o.graph.mutate([{
        entity: { eid: mint() },
        friendMessage: {
          from: me,
          to,
          words,
          at: new Date(now()).toISOString(),
          read: true,
          operator: false,
        },
      }])
    } catch (error) {
      drafts.restore(to!, words)
      let back = root.querySelector<HTMLFormElement>(
        `[data-friend-message="${to}"]`,
      )
      if (back) {
        tell(back, refusal(error, 'That could not be sent. Try again.'), true)
      }
    }
  }

  // Enter sends; Shift+Enter starts a new line; Escape closes the panel.
  let key = (e: KeyboardEvent) => {
    let t = e.target as HTMLElement
    if (
      e.key == 'Enter' && !e.shiftKey && !e.isComposing &&
      t.matches?.('[data-friend-message] textarea')
    ) {
      e.preventDefault()
      t.closest('form')?.requestSubmit()
    } else if (e.key == 'Escape' && shown()) panel()?.hidePopover()
  }

  let toggled = (e: Event) => {
    let was = opened
    opened = (e as ToggleEvent).newState == 'open'
    if (opened && !was) {
      unfit = fit(doc)
      step()
    } else if (!opened && was) {
      unfit()
      unfit = () => {}
      unstep()
    }
    if (opened) at.toast = undefined
    draw()
  }

  // Back to the step under the panel's own closes it.
  let popped = () => {
    if (!stepped || win!.history.state?.[PANEL]) return
    stepped = false
    panel()?.hidePopover()
  }

  let scrolled = (e: Event) => {
    let said = body()
    if (e.target != said) return
    newest = said!.scrollTop + said!.clientHeight >= said!.scrollHeight - 2
  }

  let off = [
    friends.subscribe(draw),
    messages.subscribe(() => {
      heard()
      draw()
    }),
  ]
  root.addEventListener('click', click)
  root.addEventListener('submit', submit)
  root.addEventListener('keydown', key)
  root.addEventListener('scroll', scrolled, true)
  panel()?.addEventListener('toggle', toggled)
  win?.addEventListener('popstate', popped)
  let page = () => draw()
  doc.addEventListener(PAGE, page)
  heard()
  draw()
  return () => {
    doc.removeEventListener(PAGE, page)
    root.removeEventListener('click', click)
    root.removeEventListener('submit', submit)
    root.removeEventListener('keydown', key)
    root.removeEventListener('scroll', scrolled, true)
    panel()?.removeEventListener('toggle', toggled)
    win?.removeEventListener('popstate', popped)
    sizes?.disconnect()
    unfit()
    field?.stop()
    for (let stop of off) stop()
    friends.close()
    messages.close()
  }
}

// The dock on screen bound, let go once a page without it took its place.
let start = (doc: Document = document) => {
  let held: { root: Element; stop: () => void } | undefined
  let drafts: Typed | undefined
  let each = () => {
    if (held && !held.root.isConnected) {
      held.stop()
      held = undefined
    }
    let root = doc.querySelector<HTMLElement>(VIEW)
    if (!root || held) return
    let { person } = JSON.parse(root.dataset.friendsDock!) as DockView
    held = {
      root,
      stop: bindDock(root, {
        graph: pageGraph([accountWords], person),
        drafts: () =>
          drafts ??= settingsDrafts({ scope: 'friends', by: person }),
      }),
    }
  }
  each()
  doc.addEventListener(PAGE, each)
}

if (typeof document != 'undefined') start()
