import { useEffect, useRef, useState } from 'preact/hooks'
import { signal } from '@preact/signals'
import {
  base,
  camera,
  clientId,
  ent,
  mode,
  mutate,
  pinned,
  rows,
  uuid,
} from '../live.ts'
import { type Change, idOf } from '../types.ts'
import {
  type Command,
  commands,
  type Ctx,
  ghost,
  run,
  suggest,
} from '../commands.ts'
import { navigate, screenTarget } from './nav.tsx'
import { load, providers } from './Run.tsx'
import { Tray } from './Tray.tsx'
import { block } from './ui.tsx'

let Frame = block('footer', 'Status', {
  Mode: 'span',
  Colon: 'span',
  Line: 'span',
  Cmd: 'input',
  Ghost: 'span',
  Was: 'i',
  Msg: 'span',
  Hints: 'div',
  Hint: 'div',
  Name: 'b',
  Args: 'span',
  About: 'span',
})
let {
  Mode,
  Colon,
  Line,
  Cmd,
  Ghost,
  Was,
  Msg,
  Hints,
  Hint,
  Name,
  Args,
  About,
} = Frame

let msg = signal('')
let last = signal('') // what ↑ recalls

// The context a command runs in: what you're LOOKING at is what you're
// commanding — the root card (the URL) is the focused entity. A browser
// speaks for no session, so :claim must name one here.
let ctx = (): Ctx => ({ eid: screenTarget()?.eid, rows: rows() })

// The web's own verbs — the camera is the one thing a terminal has no
// answer for. Everything else is the shared list (commands.ts).
let local: Record<string, Command> = {
  zoom: {
    args: '0.25–4',
    about: 'zoom the canvas',
    run: (rest) => {
      let z = Math.min(4, Math.max(0.25, Number(rest.trim()) || 1))
      camera.value = { ...camera.value, zoom: z }
      return { msg: `zoom ${z}` }
    },
  },
}
let all = { ...commands, ...local }

// What the typist was looking at when the words were typed, said as a
// comment on the task: the url, the root entity, the camera, and the
// cards in view — enough for a fix agent to find the pixel the words
// point at. Each platform attaches its own scene (a TUI would say its
// screen); this is the web's. The author is this browser's client
// entity, whose row carries the full user agent for anyone who digs.
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
        let t = ent(p.target_eid)
        return `${idOf(t)} "${t.doc?.title ?? t.kind}" (${p.view})`
      })
    : []
  let body = [
    `:fix filed from ${location.pathname}`,
    r && `- looking at: ${idOf(r)} "${r.doc?.title ?? r.kind}"`,
    r?.canvas &&
    `- camera: ${Math.round(x)},${Math.round(y)} @ ${zoom.toFixed(2)}×`,
    seen.length && `- in view: ${seen.join(' · ')}`,
    `- client: web-${ent(clientId()).num}`,
  ].filter(Boolean).join('\n')
  let c = uuid()
  return [
    { eid: c, name: 'doc', comp: { title: '', body } },
    {
      eid: c,
      name: 'comment',
      comp: { target_eid: task, author_eid: clientId() },
    },
  ]
}

// The spawn intent (:fix): defaults are the server's table — first
// provider, its first model, medium effort when offered — the same list
// the Run form reads. A freshly minted task rides the ws; the beat
// before POSTing lets it land before the server looks it up (the same
// grace paste.ts gives a freeze). The bar narrates as answers arrive.
let launch = (task: string) => {
  setTimeout(async () => {
    try {
      if (!providers.value.length) await load()
      let p = providers.value[0]
      if (!p) throw new Error('no providers')
      let res = await fetch(`${base()}/sessions/start`, {
        method: 'POST',
        body: JSON.stringify({
          task_eid: task,
          provider: p.name,
          model: p.models[0],
          ...(p.efforts.length
            ? { effort: p.efforts.includes('medium') ? 'medium' : p.efforts[0] }
            : {}),
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      let { eid } = await res.json()
      // one more beat: the session mint is casting back to our cache
      setTimeout(() => {
        msg.value = `${idOf(ent(task))} → ${idOf(ent(eid))} running`
      }, 300)
    } catch (e) {
      msg.value = `fix: ${e instanceof Error ? e.message : String(e)}`
    }
  }, 350)
}

// Run a line and spend its intent: writes go out through mutate like every
// other view, `go` is a real navigation, spawn starts an agent, and a
// throw lands in the bar rather than a toast — the message is about the
// line you just typed, so it belongs where you typed it.
let exec = (line: string) => {
  try {
    let r = run(line, ctx(), local)
    if (r.changes?.length) mutate(...r.changes)
    if (r.go) navigate(`/${idOf(ent(r.go))}`)
    if (r.spawn) {
      mutate(...scene(r.spawn)) // what you're looking at rides along
      launch(r.spawn)
    }
    msg.value = r.msg ?? ''
  } catch (e) {
    msg.value = e instanceof Error ? e.message : String(e)
  }
}

// The vim statusbar: NORMAL / -- INSERT -- / a live : command line. It owns
// the mode transitions — : opens the command line, i enters insert, Escape
// always returns to normal (and blurs whatever was being typed in).
export let Status = () => {
  let input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let key = (e: KeyboardEvent) => {
      if (mode.value == 'command') return // the command input owns its keys
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

  // The command line grabs focus the moment it appears.
  useEffect(() => {
    if (mode.value == 'command') input.current?.focus()
  })

  // The typed line, mirrored for the ghost and the hints (the DOM input
  // stays the owner); which hint is picked (0 = the best match).
  let [line, setLine] = useState('')
  let [pick, setPick] = useState(0)
  let hints = mode.value == 'command' ? suggest(line, all) : []
  let put = (v: string) => {
    if (input.current) input.current.value = v
    setLine(v)
    setPick(0)
  }

  let cmdKey = (e: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (e.key == 'Enter') {
      last.value = e.currentTarget.value.trim() || last.value
      exec(e.currentTarget.value)
      put('')
      mode.value = 'normal'
    } else if (e.key == 'Escape') {
      put('')
      mode.value = 'normal'
    } else if (e.key == 'Tab') {
      // completion is the PICKED hint's name (0 = best match)
      e.preventDefault()
      let name = hints[pick]?.[0]
      if (name) put(`${name} `)
    } else if (e.key == 'ArrowUp') {
      e.preventDefault() // the caret would jump home instead
      // empty line: recall. Otherwise walk the list, away from the bar.
      if (!e.currentTarget.value) put(last.value)
      else setPick((p) => Math.min(p + 1, hints.length - 1))
    } else if (e.key == 'ArrowDown') {
      e.preventDefault()
      setPick((p) => Math.max(p - 1, 0))
    }
  }

  return (
    <Frame>
      {mode.value == 'command'
        ? (
          <>
            <Colon>:</Colon>
            <Line>
              {
                /* the ghost sits UNDER the input: an invisible copy of the
                typed text positions the faded completion after the caret */
              }
              <Ghost aria-hidden>
                <Was>{line}</Was>
                {ghost(line, all)}
              </Ghost>
              <Cmd
                elRef={input}
                onKeyDown={cmdKey}
                onInput={(e: InputEvent) => {
                  setLine((e.currentTarget as HTMLInputElement).value)
                  setPick(0)
                }}
              />
            </Line>
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
                    {c.args && <Args>{c.args}</Args>}
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
            {msg.value && <Msg>{msg.value}</Msg>}
          </>
        )}
      {/* the bar's right end is the Tray: live runs + the shelf */}
      <Tray />
    </Frame>
  )
}
