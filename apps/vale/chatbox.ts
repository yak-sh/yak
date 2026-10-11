// The chat box on the glass: the last lines said in the level the hero is in,
// each fading a while after it was said and all shown while the box is open,
// the line being written (Enter opens it, or the tray's chat button), and the
// words over the heads of whoever said them nearby. A guest reads, and is
// asked to sign in to speak. Which lines count is chat.ts's rule over the rows
// the store stamped; this only draws them.
//
// A line goes to the store with the rows the hero earns (net.ts `keep`), so
// saying something costs no write of its own. Lines go one at a time, further
// apart than `keep` sends and than the store's pace for them (vocab.json), so
// no two share a write, which the store would refuse whole. Until the store has
// a line it shows here at once, marked as waiting, and floats over the
// speaker's own head.
//
// A line addressed to a villager, or mentioning one nearby (village.ts), uses the same
// row asks them to answer, and what they answer floats over their head and
// joins the log like anybody's line.
import type { Watch } from '@yaks/client'
import { h, render } from 'preact'
import { Button, Field, Turns } from '@yaks/ui'
import { Markdown } from '@yaks/markdown'
import { signal } from '@preact/signals'
import { commandField, type CommandFieldOpts } from './command-field.ts'
import { commandLookup } from './command-lookup.ts'
import { slashComplete } from './slash-completion.ts'
// @ts-types="npm:@types/three@^0.186.0"
import type * as THREE from 'three'
import {
  bubbles,
  clean,
  EARSHOT,
  earshot,
  heard,
  history,
  type Line,
  lineOf,
  MAX,
  writer,
} from './chat.ts'
import type { overlay } from './fx.ts'
import type { Opener } from './hud.ts'
import type { Me, Net } from './net.ts'
import type { Frame } from './play.ts'
import { type Command, slash } from './slash.ts'
import type { Village } from './village.ts'
import { spawnNotices } from './spawn.ts'

// Lines the store is asked for at once. Observed lines are retained while open.
let ASKED = 40

// How long a line waits after the last one went, in ms: longer than net.ts's
// pace, so each goes in a write of its own.
let GAP = 2200

// How long a line may wait for the store before it is given up, in ms.
let LOST = 20000

// How long the ask to sign in stays, in ms.
let ASKING = 6000

// How long a line stays in the log once said, and then how long it takes to
// fade, in ms. The fade is chat.css's, run by the compositor.
let STAY = 20000
let FADE = 4000

// A line of mine, and the rest of its row when it is said to a villager.
type Said = Line & { level: string; to: Record<string, unknown> | null }
type Notice = { eid: string; text: string; at: number; markdown: boolean }

let esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

let el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string) => {
  let e = document.createElement(tag)
  e.className = cls
  return e
}

/** Build the chat box into `glass`, opened by the tray's `opener`, on while
 * the chat is open and faded while this hero cannot speak, and the bubbles into
 * `marks`. */
export let chatbox = (
  glass: HTMLElement,
  opener: Opener,
  net: Net,
  marks: ReturnType<typeof overlay>,
  folk: Village,
  command?: (cmd: Command) => Promise<string>,
  fieldOpts?: CommandFieldOpts,
) => {
  let listeners = new AbortController()
  let closed = false
  // The feed, a window on the conversation (the kit's Turns) whose newest
  // line is at its foot; the line to say something on, and the choices that
  // complete a command over it; and the ask to sign in.
  let box = el('div', 'Chat')
  let log = el('div', 'Chat_Log')
  let form = el('form', 'Chat_Say')
  render([
    h(Field, {
      maxLength: MAX,
      placeholder: 'Say something…',
      enterKeyHint: 'send',
      autocomplete: 'off',
      'aria-label': 'Say something or enter a command',
    }),
    h('div', { class: 'Chat_Choices' }),
  ], form)
  let input = form.querySelector('input')!
  let choices = form.querySelector<HTMLElement>('.Chat_Choices')!
  form.hidden = true
  let ask = el('div', 'Chat_Ask')
  ask.hidden = true
  box.append(log, form, ask)
  box.style.setProperty('--fade', `${FADE}ms`)
  glass.append(box)

  let me: Me | null = null
  let speaks = () => !!me?.person && me.writes
  let commands: ReturnType<Net['commands']> | null = null
  let person = signal<string | undefined>(undefined)
  let place = 'mossvale.chat'
  let refs = commandLookup(net)
  let { fields, drafts, ready, close } = commandField(
    net,
    () => person.value,
    async (text, caret) => {
      if (!text.startsWith('/')) {
        return { from: caret, to: caret, cands: [], whole: false }
      }
      try {
        return await slashComplete(
          await (commands ??= net.commands()),
          text,
          caret,
          refs.lookup,
        )
      } catch (e) {
        commands = null
        throw e
      }
    },
    fieldOpts,
  )
  input.disabled = true
  void ready.then(() => {
    if (!closed) input.disabled = false
  }, (e) => {
    if (!closed) notice(e instanceof Error ? e.message : 'Drafts unavailable.')
  })
  let unbind = fields.bind(place, input)
  render(h(fields.List, { id: place, anchor: { current: input } }), choices)
  let spend = (text: string, by: string | undefined) => {
    // A slow command listing must not spend words typed or an account switched
    // while it was being read. The submitted snapshot can still run.
    if (input.value != text || person.value != by) return
    drafts.spend(place)
    fields.set(place, '')
  }

  // What the store holds: the lines said in this level, newest first, and
  // who made each hero, which the rule asks.
  let level = ''
  let past: Line[] = []
  let lines: Watch | null = null
  let makers = new Map<string, string>()
  let asking = new Set<string>()
  let watch = (q: string): Watch | null => {
    try {
      return net.client.watch(q)
    } catch (e) {
      console.warn('mossvale chat:', e)
      return null
    }
  }
  let follow = (id: string) => {
    lines?.close()
    level = id
    past = []
    lines = watch(
      `.chat.level=${
        JSON.stringify(id)
      }&?doc&?created&.order=-created.at&.limit=${ASKED}`,
    )
  }
  let owner = (hero: string) =>
    makers.get(hero) || writer(net.client.ent(hero)) || null
  let askMaker = (hero: string) => {
    if (makers.has(hero) || asking.has(hero) || asking.size >= 2) return
    asking.add(hero)
    void net.about(hero).then(({ by }) => makers.set(hero, by)).finally(
      () => asking.delete(hero),
    )
  }

  // My lines: those still to go, one each `GAP`, and those gone that the
  // store has not answered with yet.
  let outbox: Said[] = []
  let waiting: Said[] = []
  let notices: Notice[] = []
  let notice = (text: string) => {
    let n = { eid: crypto.randomUUID(), text, at: net.now(), markdown: false }
    notices = [...notices, n].slice(-ASKED)
    return n
  }
  let run = async (cmd: Command) => {
    let n = notice('Running command…')
    try {
      n.text = command ? await command(cmd) : 'Commands are unavailable.'
      n.markdown = !!command
    } catch (e) {
      n.text = clean(e instanceof Error ? e.message : String(e)) ||
        'The command failed.'
    }
  }
  let went = -Infinity
  let send = () => {
    let t = performance.now()
    if (!outbox.length || t - went < GAP) return
    let l = outbox.shift()!
    went = t
    waiting.push(l)
    net.keep({
      entity: { eid: l.eid },
      chat: { level: l.level, player: l.player },
      doc: { body: l.text },
      ...l.to,
    })
  }

  // When a line starts to fade: `STAY` after it was said, and never before
  // the box last closed, so what the open box showed fades away gently.
  let shut = -Infinity
  let fades = (l: { at: number }) => Math.max(l.at + STAY, shut)

  let open = false
  let asked = 0
  let show = () => {
    if (!speaks()) {
      render(
        h(Button, { href: me?.signIn ?? undefined }, 'Sign in to chat'),
        ask,
      )
      ask.hidden = false
      asked = performance.now()
      return
    }
    open = true
    form.hidden = false
    opener.mark({ selected: true })
    box.classList.add('Chat-open')
    input.focus()
  }
  let hide = () => {
    if (!open) return
    open = false
    shut = net.now()
    form.hidden = true
    opener.mark({ selected: false })
    box.classList.remove('Chat-open')
    input.blur()
  }
  addEventListener('keydown', (e) => {
    if ((e.key != 'Enter' && e.key != '/') || open || glass.hidden) return
    if (
      e.target instanceof HTMLElement &&
      (e.target.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName))
    ) return
    if (e.key == '/' && (e.altKey || e.ctrlKey || e.metaKey)) return
    // Keep the opening key from the input it is about to focus.
    e.preventDefault()
    show()
    if (e.key == '/' && open && !input.disabled) {
      fields.type(place, '/', 1)
    }
  }, { signal: listeners.signal })
  input.addEventListener('keydown', (e) => {
    if (e.key == 'Escape' && !e.defaultPrevented) hide()
  }, { signal: listeners.signal })
  // Scrolling the log can blur the input; it must not fold the conversation.
  addEventListener('pointerdown', (e) => {
    if (
      open && !box.contains(e.target as Node) &&
      !opener.button.contains(e.target as Node)
    ) {
      hide()
    }
  }, { signal: listeners.signal })
  // The opener keeps the line's focus, so a second tap folds it away.
  opener.button.addEventListener('pointerdown', (e) => e.preventDefault(), {
    signal: listeners.signal,
  })
  opener.button.addEventListener('click', () => open ? hide() : show(), {
    signal: listeners.signal,
  })
  let submitting = false
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (input.disabled || submitting) return
    let before = input.value
    let by = person.value
    let text = clean(before)
    submitting = true
    let parsed
    try {
      parsed = text.startsWith('/')
        ? await slash(text, await (commands ??= net.commands()))
        : null
    } catch (e) {
      commands = null
      if (!closed && person.value == by) {
        notice(e instanceof Error ? e.message : 'Commands unavailable.')
      }
      return
    } finally {
      submitting = false
    }
    if (closed || person.value != by || !speaks()) return
    if (parsed) {
      if ('error' in parsed) notice(parsed.error)
      else if ('help' in parsed) {
        spend(before, by)
        let n = notice(parsed.help)
        n.markdown = true
        hide()
      } else {
        spend(before, by)
        hide()
        void run(parsed.command)
      }
      return
    }
    // E conversations stay open for another line; open chat outside one
    // returns to its compact log after sending.
    if (!folk.near()) hide()
    let hero = net.hero
    if (!text || !hero || !level || !speaks()) return
    spend(before, by)
    outbox.push({
      eid: crypto.randomUUID(),
      player: hero,
      by: me?.person ?? '',
      text,
      at: net.now(),
      level,
      to: folk.to(text),
    })
  }, { signal: listeners.signal })

  // The log, written only when what it shows changed. A line is drawn part
  // way through its arrival and its fade, however late it is drawn; the open
  // box shows every line whole.
  let drawn = ''
  let wasOpen = false
  let since = new Map<string, string>()
  type Row = {
    eid: string
    name: string
    /** the colour of the one who said it, if they have one */
    tint?: string
    text: string
    markdown: boolean
    wait: boolean
    at: number
    fades: number
    persistent: boolean
  }
  let draw = (shown: Line[], mine: Set<string>, now: number) => {
    let rows = shown.map((l): Row => {
      let p = net.who(l.player)
      let v = folk.who(l.player)
      return {
        eid: l.eid,
        name: v?.name ?? p?.name ?? 'Wanderer',
        tint: v?.tint ?? p?.tint,
        text: l.text,
        markdown: false,
        wait: mine.has(l.eid),
        at: l.at,
        fades: fades(l),
        persistent: false,
      }
    })
    rows.push(...notices.map((n) => ({
      eid: n.eid,
      name: 'Only you',
      text: n.text,
      markdown: n.markdown,
      wait: false,
      at: n.at,
      fades: fades(n),
      persistent: false,
    })))
    if (me?.person) {
      rows.push(
        ...spawnNotices(net.spawnFailures(), me.person).map((n) => ({
          ...n,
          name: 'Only you',
          markdown: false,
          wait: false,
          fades: Infinity,
          persistent: true,
        })),
      )
    }
    rows.sort((a, b) => a.at - b.at)
    let key = JSON.stringify([open, rows])
    if (key == drawn) return
    drawn = key
    let atBottom = !wasOpen ||
      log.scrollHeight - log.scrollTop - log.clientHeight < 24
    let position = log.scrollTop
    // A line keeps the moment its arrival and fade were reckoned from while
    // it is drawn again, until the box opens or closes and starts them anew.
    let was = wasOpen == open ? since : new Map<string, string>()
    since = new Map(
      rows.filter((r) => !open && !r.persistent).map((r) => [
        r.eid,
        was.get(r.eid) ??
          `${Math.min(0, r.at - now).toFixed(0)}ms, ${
            (r.fades - now).toFixed(0)
          }ms`,
      ]),
    )
    wasOpen = open
    render(
      h(
        Turns,
        {},
        rows.map((r) => {
          let delay = since.get(r.eid)
          return h(
            Turns.Turn,
            {
              key: r.eid,
              class: [
                r.wait && 'Chat_Line-wait',
                r.markdown && 'Chat_Line-command',
                r.persistent && 'Chat_Line-failed',
              ].filter(Boolean).join(' ') || undefined,
              style: delay ? { animationDelay: delay } : undefined,
            },
            h(
              Turns.Who,
              { style: r.tint ? { '--tint': r.tint } : undefined },
              r.name,
            ),
            h(
              Turns.Text,
              {},
              r.markdown ? h(Markdown, { source: r.text }) : r.text,
            ),
          )
        }),
      ),
      log,
    )
    if (open) {
      if (atBottom) log.scrollTop = log.scrollHeight
      else log.scrollTop = position
    }
  }

  // A bubble's words, made once, so its fade starts from when it was said
  // however late the line arrived.
  let said = new Map<string, string>()
  let bubble = (l: Line, now: number) => {
    let html = said.get(l.eid)
    if (!html) {
      if (said.size > 200) said.clear()
      html = `<span class=Bubble style="animation-delay:${
        Math.min(0, l.at - now).toFixed(0)
      }ms">${esc(l.text)}</span>`
      said.set(l.eid, html)
    }
    return html
  }

  return {
    close: () => {
      if (closed) return
      closed = true
      listeners.abort()
      unbind()
      render(null, choices)
      close()
      refs.close()
      lines?.close()
      box.remove()
    },
    /** E opens chat focused on the villager, while replies remain public. */
    converse: () => show(),
    /** the keyboard is the chat's while a line is being written */
    get typing() {
      return open
    },
    /** who is looking: a person signed in speaks, a guest is asked to */
    me: (who: Me) => {
      if (who.person != me?.person) notices = []
      me = who
      person.value = who.person || undefined
      opener.mark({ faded: !speaks() })
    },
    /** this frame: the level's lines, and the words over heads near me */
    tick: (f: Frame, head: (eid: string) => THREE.Vector3 | null) => {
      let hero = net.hero
      if (!hero) return
      if (f.level != level) follow(f.level)
      if (!ask.hidden && performance.now() - asked > ASKING) ask.hidden = true
      send()
      let now = net.now()
      let held = lines?.value ?? []
      for (let b of held) {
        let l = lineOf(b)
        if (l) askMaker(l.player)
      }
      // A line of mine is in the page's graph the moment it goes, but it is
      // not the store's until the store has stamped who wrote it.
      let there = new Set(
        held.filter((b) => writer(b)).map((b) => b.entity.eid),
      )
      waiting = waiting.filter((l) => !there.has(l.eid) && now - l.at < LOST)
      let mine = [...waiting, ...outbox].filter((l) => l.level == level)
      past = history(
        past,
        [
          ...heard(held.flatMap((b) => lineOf(b) ?? []), owner),
          ...folk.lines(),
        ],
        open ? Infinity : ASKED,
        now,
      )
      let shown = history(past, mine, Infinity, now)
      notices = notices.filter((n) => now < fades(n) + FADE)
      draw(
        open ? shown : shown.slice(-6).filter((l) => now < fades(l) + FADE),
        new Set(mine.map((l) => l.eid)),
        now,
      )
      let to = folk.near()
      let hint = to
        ? `Say something to ${to} (everyone hears)…`
        : 'Say something…'
      if (input.placeholder != hint) input.placeholder = hint
      let near = new Set([
        hero,
        ...earshot(f.body, f.others),
        ...f.givers.filter((g) => g.near <= EARSHOT).map((g) => g.id),
      ])
      for (let l of bubbles(shown, near, now)) {
        let at = head(l.player)
        if (at) {
          marks.plate(`said:${l.eid}`, at, bubble(l, now), 'Plate Plate-said')
        }
      }
    },
  }
}
