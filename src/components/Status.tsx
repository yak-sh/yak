import { useEffect, useRef, useState } from 'preact/hooks'
import { signal } from '@preact/signals'
import {
  camera,
  capable,
  clientId,
  ent,
  mode,
  mutate,
  pinned,
  problem,
  rows,
  uuid,
} from '../live.ts'
import { sessionFrames, spawnPlan } from '../client.ts'
import { type Change, idOf } from '../types.ts'
import {
  type Command,
  commands,
  type Ctx,
  ghost,
  run,
  type SpawnIntent,
  spawnTask,
  suggest,
} from '../commands.ts'
import { num, slotsOf } from '../verb.ts'
import { navigate, screenTarget } from './nav.tsx'
import { drop, peek, save } from './drafts.ts'
import { liveBlocked, load, providers } from './Run.tsx'
import { catalog } from '../providers.ts'
import { Tray } from './Tray.tsx'
import { shelve } from './shelf.ts'
import { block } from './ui.tsx'
import { Id } from './views/Inline.tsx'
import { title } from './title.tsx'
import { pickLine, useHits } from './hits.ts'
import { spawnHit } from './Canvas.tsx'
import { useComplete } from './Complete.tsx'

let Frame = block('footer', 'Status', {
  Left: 'div',
  Right: 'div',
  Close: 'button',
  Mode: 'span',
  Colon: 'span',
  Line: 'span',
  Cmd: 'textarea',
  Ghost: 'span',
  Was: 'i',
  Verb: 'span',
  Msg: 'span',
  Hints: 'div',
  Hint: 'div',
  Name: 'b',
  Args: 'span',
  About: 'span',
  You: 'span',
  Person: 'button',
})
let {
  Left,
  Right,
  Close,
  Mode,
  Colon,
  Line,
  Cmd,
  Ghost,
  Was,
  Verb,
  Msg,
  Hints,
  Hint,
  Name,
  Args,
  About,
  You,
  Person,
} = Frame

type Message = string | { task: string; session: string }

let msg = signal<Message>('')
let last = signal('') // what ↑ recalls

// A spawn answer stays attached to the graph instead of freezing the
// optimistic S-0. The session becomes linkable only once the server has
// minted its number; its lifecycle comes from that same authoritative row.
export let FixMessage = (
  { task, session }: { task: string; session: string },
) => {
  let t = ent(task)
  let s = ent(session)
  return (
    <>
      <Id e={t} /> → {s.num
        ? (
          <>
            <Id e={s} /> {s.session?.status ?? 'starting'}
          </>
        )
        : 'agent starting'}
    </>
  )
}

// A thumb has no `:` key, so the bar's left side is the door. The keyboard
// WAITS: under a coarse pointer the line opens unfocused, which leaves the
// hints standing as a palette of verbs to TAP; picking one writes it in and
// takes the keyboard then, for the arguments it actually needs.
let thumb = () => !!globalThis.matchMedia?.('(pointer: coarse)').matches

export let commandMode = () => {
  msg.value = ''
  mode.value = 'command'
}

// A command line can lose focus to the canvas without spending its draft.
// `:` takes it back, but remains ordinary text when the line already owns it.
export let commandFocus = (
  e: Pick<KeyboardEvent, 'key' | 'target' | 'preventDefault'>,
  input: HTMLTextAreaElement | null,
) => {
  if (e.key != ':' || !input || e.target == input) return false
  e.preventDefault()
  input.focus()
  return true
}

// A final newline gives a textarea another caret row, but an inline mirror
// needs content after the break to retain that row. Zero width keeps wrapping
// identical while the mirror continues to size the textarea.
export let mirrorTail = (line: string, faded: string) =>
  faded || (line.endsWith('\n') ? '\u200b' : '')

// The context a command runs in: what you're LOOKING at is what you're
// commanding — the root card (the URL) is the focused entity. A browser
// speaks for no session, so :claim must name one here.
let ctx = (): Ctx => ({ eid: screenTarget()?.eid, rows: rows() })

// The web's own verbs — the camera is the one thing a terminal has no
// answer for. Everything else is the shared list (commands.ts).
let local: Record<string, Command> = {
  zoom: {
    args: [{ name: 'factor', kind: num, eg: '0.25–4', need: false }],
    about: 'zoom the canvas',
    run: (rest) => {
      let z = Math.min(4, Math.max(0.25, Number(rest.trim()) || 1))
      camera.value = { ...camera.value, zoom: z }
      return { msg: `zoom ${z}` }
    },
  },
}
let all = { ...commands, ...local }

// What the typist was looking at when the words were typed, EMITTED as a
// `scene` notice on the task (D-13858): the url, the root entity, the camera,
// and the cards in view — enough for a fix agent to find the pixel the words
// point at. A capture is machinery, not conversation, so it is a notice, not
// a comment — it reaches the fix agent's inbox and the bus but stays out of
// the task's thread and off the mail relay. Each platform attaches its own
// scene (a TUI would say its screen); this is the web's. The instrument is
// this browser's client entity, whose row carries the full user agent.
let scene = (task: string): Change[] => {
  let root = screenTarget()?.eid
  let r = root ? ent(root) : null
  let { x, y, zoom, w, h } = camera.value
  let seen = r?.canvas
    ? pinned(r.eid).filter((p) =>
      p.x < x + w / zoom / 2 && p.x + (p.w || 480) > x - w / zoom / 2 &&
      p.y < y + h / zoom / 2 && p.y + (p.h || 200) > y - h / zoom / 2
    )
      .toSorted((a, b) => b.z - a.z)
      .slice(0, 12)
      .map((p) => {
        let t = ent(p.target)
        return `${idOf(t)} "${t.doc?.title ?? t.kind}" (${p.view})`
      })
    : []
  let body = [
    `fix filed from ${location.pathname}`,
    r && `- looking at: ${idOf(r)} "${r.doc?.title ?? r.kind}"`,
    r?.canvas &&
    `- camera: ${Math.round(x)},${Math.round(y)} @ ${zoom.toFixed(2)}×`,
    seen.length && `- in view: ${seen.join(' · ')}`,
    `- client: web-${ent(clientId()).num}`,
  ].filter(Boolean).join('\n')
  let c = uuid()
  return [
    { eid: c, name: 'doc', comp: { title: '', body } },
    { eid: c, name: 'notice', comp: { target: task, event: 'scene' } },
  ]
}

// The spawn intent (:fix): the default is the first model in the one unified
// catalog, its transport chosen by readiness (graph-native → CLI fallback),
// medium effort when the model has the axis — the same list and rule the Run
// form shows. The session is one graph write on the same socket the task just
// rode, so ordering is free. The bar narrates from the graph; anything it
// can't honor lands as a failed Session.
let launch = async (intent: string | SpawnIntent) => {
  if (!providers.value.length) await load()
  let wanted = typeof intent == 'string' ? {} : intent
  let task = spawnTask(intent)
  // The one precedence every door shares (spawnPlan): explicit ask > the
  // task's spawn hint > table default. No caller session on the web, so the
  // hint is what lets a board :fix launch the right agent. Transports are
  // judged by the live account readiness, exactly as the Run form's choose.
  let plan = spawnPlan(rows(), providers.value, {
    task,
    ask: wanted,
    blocked: await liveBlocked(),
  })
  if (!plan.provider || !plan.model) {
    throw new Error('no matching provider/model')
  }
  // Medium effort by default when the model has the axis — the Run form's rule.
  let axis = catalog(providers.value).find((p) => p.model == plan.model)
    ?.efforts ?? []
  let effort = plan.effort ??
    (axis.length ? (axis.includes('medium') ? 'medium' : axis[0]) : undefined)
  let eid = uuid()
  let comp = {
    id: uuid(),
    provider: plan.provider,
    model: plan.model,
    ...(effort ? { effort } : {}),
    ...(task ? { requested_task: task } : {}),
    ...(plan.persona ? { persona: plan.persona } : {}),
  }
  // Canonical `spawn` rides only when the server advertises it; otherwise the
  // legacy session frame alone, which the server materializes into spawn.
  mutate(
    ...(capable('spawn')
      ? sessionFrames(eid, comp)
      : [{ eid, name: 'session', comp }]),
    ...(wanted.prompt
      ? [{ eid, name: 'doc', comp: { title: '', body: wanted.prompt } }]
      : []),
  )
  return eid
}

// Run a line and spend its intent: writes go out through mutate like every
// other view, `go` is a real navigation, spawn starts an agent, and a
// throw lands in the bar rather than a toast — the message is about the
// line you just typed, so it belongs where you typed it.
let exec = async (line: string) => {
  let launching = ''
  try {
    let r = run(line, ctx(), local)
    let changes = r.changes ?? []
    let task = spawnTask(r.spawn)
    if (task) changes = [...changes, ...scene(task)]
    if (changes.length) mutate(...changes)
    if (r.go) navigate(`/${idOf(ent(r.go))}`)
    if (r.card) {
      let root = screenTarget()
      if (root && ent(root.eid).canvas) spawnHit(root.eid, r.card)
      else navigate(`/${idOf(ent(r.card))}`)
    }
    if (r.spawn) {
      launching = line.trim().split(/\s/)[0]
      msg.value = r.msg ?? ''
      let session = await launch(r.spawn)
      if (task) msg.value = { task, session }
      else shelve(session, 'Session')
    } else {
      msg.value = r.msg ?? ''
    }
  } catch (e) {
    let why = e instanceof Error ? e.message : String(e)
    msg.value = `${launching ? `${launching}: ` : ''}${why}`
  }
}

// The identity chain's web end: who this browser acts for. A lone person
// binds on sight (Canvas); with CANDIDATES the bar asks — "you are …?" —
// and one click asserts it. An assertion, not a login: a wrong answer
// only garbles your own bylines, and the client card's actor row (any
// prop editor) can always change it. Bound or personless, the bar stays
// quiet.
let WhoAmI = () => {
  let me = ent(clientId())
  // Ask only when this browser is bound to no one yet — and ask the SERVER
  // (hits.ts) for the people, so a partial cache can't hide candidates or
  // under-count them into a false "no choice". The empty line while already
  // bound skips the round trip; the hook still runs (its rule) every render.
  let asking = !!me.client && !me.client.actor
  let people = useHits(asking ? pickLine('', 'person') : '', 50)
  if (!asking || people.length < 2) return null
  return (
    <You>
      you are {people.map((p) => (
        <Person
          key={p.eid}
          onClick={() =>
            mutate({
              eid: me.eid,
              name: 'client',
              comp: { actor: p.eid },
            })}
          {...title(p.title || idOf(p))}
        />
      ))}
      ?
    </You>
  )
}

// The vim statusbar: NORMAL / -- INSERT -- / a live : command line. It owns
// the mode transitions — : opens the command line, i enters insert, Escape
// always returns to normal (and blurs whatever was being typed in).
export let Status = () => {
  let input = useRef<HTMLTextAreaElement>(null)
  let complete = useComplete()
  // The DOM owns active typing. State mirrors it for hints, and begins from
  // the durable draft so opening the command line never needs a later value
  // rewrite that would move the caret.
  let [line, setLine] = useState(() => peek('cmd')?.v ?? '')
  let [pick, setPick] = useState(0)

  useEffect(() => {
    let key = (e: KeyboardEvent) => {
      if (mode.value == 'command') {
        commandFocus(e, input.current)
        return // the command input owns every other key
      }
      let t = e.target
      let typing = t instanceof HTMLElement &&
        t.matches('input, textarea, select, [contenteditable]')
      if (mode.value == 'insert' || typing) {
        if (e.key == 'Escape') {
          mode.value = 'normal'
          if (t instanceof HTMLElement) t.blur()
        }
        return
      }
      if (e.key == ':') {
        e.preventDefault()
        msg.value = ''
        mode.value = 'command'
      } else if (e.key == 'i' && mode.value == 'normal') {
        mode.value = 'insert'
      } else if (e.key == 'Escape') {
        msg.value = ''
        document.getSelection()?.removeAllRanges() // drops visual too
      }
    }
    addEventListener('keydown', key)

    // VISUAL is derived, not entered: a live selection outside a text input.
    let sel = () => {
      if (mode.value == 'insert' || mode.value == 'command') return
      let s = document.getSelection()
      let n = s?.anchorNode
      let host = n instanceof Element ? n : n?.parentElement
      let has = !!s && !s.isCollapsed && !host?.closest('input, textarea')
      mode.value = has ? 'visual' : 'normal'
    }
    document.addEventListener('selectionchange', sel)

    // Pointer clicks don't keep keyboard focus: a clicked tab/×/link would
    // otherwise swallow the next <space> (browsers activate the focused
    // button on space). Keyboard activations (detail == 0) keep theirs.
    let declick = (e: MouseEvent) => {
      if (e.detail == 0) return
      let a = document.activeElement
      if (a instanceof HTMLElement && a.matches('button, a')) a.blur()
    }
    addEventListener('click', declick)
    return () => {
      removeEventListener('keydown', key)
      document.removeEventListener('selectionchange', sel)
      removeEventListener('click', declick)
    }
  }, [])

  // Seed only when the command input APPEARS. Rewriting an uncontrolled
  // textarea after every repaint races its native input event and moves a
  // mid-line caret to the end; while mounted, the DOM remains the owner.
  useEffect(() => {
    if (mode.value != 'command') return
    let i = input.current
    if (!i) return
    if (i.value != line) i.value = line
    if (!thumb()) i.focus()
  }, [mode.value])

  // The typed line, mirrored for the ghost and the hints (the DOM input
  // stays the owner); which hint is picked (0 = the best match).
  // A half-typed : line survives any reload — restore it and reopen the
  // command line; running or Escaping the line is what spends the draft.
  useEffect(() => {
    if (line) mode.value = 'command'
  }, [])
  let hints = mode.value == 'command' ? suggest(line, all) : []
  let [, pre, verb, rest] = line.match(/^(\s*)(\S+)(.*)$/s) ?? []
  let faded = ghost(line, all)
  let put = (v: string) => {
    if (input.current) input.current.value = v
    v ? save('cmd', v) : drop('cmd')
    setLine(v)
    setPick(0)
    if (v) input.current?.focus() // a picked verb takes the keyboard
  }
  let close = () => {
    put('')
    mode.value = 'normal'
  }

  let cmdKey = (e: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) => {
    if (complete.key(e)) return
    // shift+Enter is the textarea's own newline — spec() reads line 2 on
    // as the body, so a : line can file a task with prose attached.
    let multi = e.currentTarget.value.includes('\n')
    if (e.key == 'Enter' && !e.shiftKey) {
      e.preventDefault()
      last.value = e.currentTarget.value.trim() || last.value
      exec(e.currentTarget.value)
      close()
    } else if (e.key == 'Escape') {
      close()
    } else if (e.key == 'Tab') {
      // completion is the PICKED hint's name (0 = best match)
      e.preventDefault()
      let name = hints[pick]?.[0]
      if (name) put(`${name} `)
    } else if (e.key == 'ArrowUp' && !multi) {
      e.preventDefault() // the caret would jump home instead
      // empty line: recall. Otherwise walk the list, away from the bar.
      if (!e.currentTarget.value) put(last.value)
      else setPick((p) => Math.min(p + 1, hints.length - 1))
    } else if (e.key == 'ArrowDown' && !multi) {
      e.preventDefault()
      setPick((p) => Math.max(p - 1, 0))
    }
  }

  return (
    <Frame>
      <Left onClick={mode.value == 'command' ? undefined : commandMode}>
        {mode.value == 'command'
          ? (
            <>
              <Colon>:</Colon>
              <Line>
                {
                  /* the ghost sits UNDER the input and paints the line: the
                copy shows the typed text (the verb greens once it names a
                command), the faded completion follows — the input above
                keeps only the caret and the selection */
                }
                <Ghost aria-hidden>
                  <Was>
                    {verb
                      ? (
                        <>
                          {pre}
                          <Verb mod={all[verb] && 'known'}>{verb}</Verb>
                          {rest}
                        </>
                      )
                      : line}
                  </Was>
                  {mirrorTail(line, faded)}
                </Ghost>
                <Cmd
                  elRef={input}
                  onKeyDown={cmdKey}
                  onInput={(e: InputEvent) => {
                    let el = e.currentTarget as HTMLTextAreaElement
                    let v = el.value
                    v ? save('cmd', v) : drop('cmd')
                    setLine(v)
                    setPick(0)
                    complete.track(el)
                  }}
                  onBlur={() => complete.close()}
                />
              </Line>
              {complete.list}
              {hints.length > 0 && (
                <Hints>
                  {hints.slice(0, 8).map(([name, c], i) => (
                    <Hint
                      key={name}
                      mod={i == pick && 'pick'}
                      onMouseEnter={() => setPick(i)}
                      onMouseDown={(e: MouseEvent) => {
                        e.preventDefault() // keep the input's focus
                        put(`${name} `)
                      }}
                    >
                      <Name>{name}</Name>
                      {c.args.length > 0 && <Args>{slotsOf(c.args)}</Args>}
                      <About>{c.about}</About>
                    </Hint>
                  ))}
                </Hints>
              )}
            </>
          )
          : (
            <>
              <Mode mod={mode.value}>
                {mode.value == 'insert'
                  ? '-- INSERT --'
                  : mode.value == 'visual'
                  ? '-- VISUAL --'
                  : 'NORMAL'}
              </Mode>
              {(msg.value || problem.value) && (
                <Msg>
                  {typeof msg.value == 'string'
                    ? msg.value || problem.value
                    : <FixMessage {...msg.value} />}
                </Msg>
              )}
            </>
          )}
      </Left>
      <Right>
        <WhoAmI />
        {mode.value == 'command'
          ? (
            <Close type='button' aria-label='exit command mode' onClick={close}>
              ×
            </Close>
          )
          : <Tray />}
      </Right>
    </Frame>
  )
}
