import { useRef, useState } from 'preact/hooks'
import { commands, orderIn, suggest } from '../commands.ts'
import { commentsOn, ent, mutate, pending, repoUrl, uuid } from '../live.ts'
import { ago, block, pretty } from './ui.tsx'
import { useDraft } from './drafts.ts'
import { type Ent, idOf, nick, sessionActive, verdictName } from '../types.ts'
import { linkProps } from './nav.tsx'
import { title } from './title.tsx'
import { Markdown } from './Markdown.tsx'

let Frame = block('div', 'Comments', {
  Item: 'div',
  Who: 'a',
  Via: 'a',
  Verdict: 'span',
  When: 'a',
  Body: 'div',
  Box: 'div',
  New: 'textarea',
  Hints: 'div',
  Hint: 'div',
  Name: 'span',
  Args: 'span',
  About: 'span',
})
let { Item, Who, Via, Verdict, When, Body, Box, New } = Frame
let { Hints, Hint, Name, Args, About } = Frame

// An instrument's face: browsers by a short client handle, anything else
// by its chip id (S-31, never the raw session uuid).
export let viaName = (eid?: string | null) => {
  if (!eid) return 'anon'
  let a = ent(eid)
  return a.client ? `web-${a.num}` : idOf(a)
}

// The universal stamp's human face: actor first, instrument after via.
export let byline = (c: Ent) => {
  let actor = c.created?.by ? ent(String(c.created.by)) : undefined
  let instrument = c.created?.via ? ent(String(c.created.via)) : undefined
  let by = actor ? actor.doc?.title || idOf(actor) : ''
  let via = instrument ? viaName(instrument.eid) : ''
  return by && via && actor?.eid != instrument?.eid
    ? `${by} · via ${via}`
    : by || via || 'anon'
}

// One comment, anywhere it renders — the rail here, the session thread
// inline. The stamp names actor and instrument directly; the actor leads
// and the instrument dims behind a "via" — both still links.
export let Note = ({ c }: { c: Ent }) => {
  let actor = c.created?.by ? ent(String(c.created.by)) : undefined
  let instrument = c.created?.via ? ent(String(c.created.via)) : undefined
  let who = actor ?? instrument
  return (
    <Item>
      {
        /* The name links to whoever said it; the age to the comment
        itself — both wear the internal-link contract. */
      }
      <Who
        {...(who ? linkProps(who) : {})}
        {...title(
          actor ? actor.doc?.title || idOf(actor) : viaName(instrument?.eid),
        )}
      />
      {actor && instrument && actor.eid != instrument.eid && (
        <Via {...linkProps(instrument)}>
          · via {viaName(instrument.eid)}
        </Via>
      )}
      {c.review && (
        <Verdict mod={c.review.verdict.replaceAll('_', '-')}>
          {verdictName(c.review.verdict)}
        </Verdict>
      )}
      <When data-tip={pretty(c.created?.at)} {...linkProps(c)}>
        {ago(c.created?.at)}
      </When>
      {
        /* A comment IS its body, so an unshipped one paints the wait rather
          than an empty note (pending() is the ask). */
      }
      {pending(c)
        ? <Body>…</Body>
        : <Markdown as={Body} text={c.doc?.body ?? ''} repo={repoUrl(c)} />}
    </Item>
  )
}

// The box that says more — Enter posts (Shift+Enter for a newline), and
// the instrument is this browser's client entity.
//
// On a session the comment IS the way to talk to the agent — no side
// channel: the server's created(comment) effect resumes a settled
// managed session with the words, and an active one hears them on its
// next tool call through the bus. To leave a note ABOUT the run without
// waking it, comment on its task instead.
export let prompt = (e: Ent) => {
  let s = e.session
  let settled = !!s && s.origin == 'managed' && !!s.provider_session_id &&
    !sessionActive.includes(String(s.status))
  // Persona, model nick, graph chip: provider ids never face people.
  let who = s &&
    ((s.persona_eid && ent(s.persona_eid).doc?.title) ||
      nick(s.serving_model ?? s.model) || idOf(e))
  return settled
    ? `send to ${who}… (resumes the session)`
    : s
    ? 'comment… (the agent hears it on its next tool call)'
    : 'comment…'
}

export let Composer = ({ eid }: { eid: string }) => {
  let box = useRef<HTMLTextAreaElement>(null)
  let dkey = `${eid}.comment`
  // The typed line, mirrored for the hints (the DOM textarea stays the
  // owner, exactly as the palette does it) and which hint is picked.
  let [line, setLine] = useState('')
  let [pick, setPick] = useState(0)
  // A draft outlives blur on purpose — abandon the box, come back, the
  // words are still there. Only posting spends it. If this box was the
  // one being typed in when a hot swap hit, it takes the caret back.
  let { sync, spend } = useDraft(dkey, box, setLine)

  // The vocabulary teaches where the typing happens: a comment opening
  // with `:` IS a command line (obey.ts runs it on landing), so the
  // composer completes it the way the palette does — same table, same
  // suggest(). Two lines qualify: one that already IS an order, and the
  // lone `:` that is about to be — that keystroke opens the whole menu,
  // which is how you find a verb whose name you don't know. `: like this`
  // stays quiet, because it isn't going to run either. The hints retire
  // once prose starts: by then the command line is written, and the words
  // under it are just words.
  let typing = !line.includes('\n') && (line == ':' || !!orderIn(line))
  let hints = typing ? suggest(line.slice(1), commands) : []

  let put = (v: string) => {
    let el = box.current
    if (!el) return
    el.value = v
    setLine(v)
    setPick(0)
    sync(el)
  }

  let post = () => {
    let body = box.current!.value.trim()
    if (!body) return
    let c = uuid()
    mutate(
      { eid: c, name: 'doc', comp: { title: '', body } },
      {
        eid: c,
        name: 'comment',
        comp: { target_eid: eid },
      },
    )
    box.current!.value = ''
    setLine('')
    setPick(0)
    spend()
  }

  let key = (e: KeyboardEvent) => {
    if (e.key == 'Enter' && !e.shiftKey) {
      e.preventDefault()
      post()
      return
    }
    if (e.key == 'Escape') return box.current!.blur()
    if (!hints.length) return
    // Only while the command line is the whole box: past that the caret
    // has prose to walk through, and the textarea's own keys win.
    if (e.key == 'Tab') {
      e.preventDefault()
      let name = hints[pick]?.[0]
      if (name) put(`:${name} `)
    } else if (e.key == 'ArrowUp') {
      e.preventDefault() // the caret would jump home instead
      setPick((p) => Math.min(p + 1, hints.length - 1))
    } else if (e.key == 'ArrowDown') {
      e.preventDefault()
      setPick((p) => Math.max(p - 1, 0))
    }
  }

  return (
    <Box>
      {hints.length > 0 && (
        <Hints>
          {hints.slice(0, 6).map(([name, c], i) => (
            <Hint
              key={name}
              mod={i == pick && 'pick'}
              onMouseEnter={() => setPick(i)}
              onMouseDown={(e: MouseEvent) => {
                e.preventDefault() // keep the box's focus
                put(`:${name} `)
              }}
            >
              <Name>:{name}</Name>
              {c.args && <Args>{c.args}</Args>}
              <About>{c.about}</About>
            </Hint>
          ))}
        </Hints>
      )}
      <New
        elRef={box}
        data-eid={eid}
        rows={1}
        onInput={(e: InputEvent) => {
          let el = e.currentTarget as HTMLTextAreaElement
          sync(el)
          setLine(el.value)
          setPick(0)
        }}
        placeholder={prompt(ent(eid))}
        onKeyDown={key}
      />
    </Box>
  )
}

// The comment rail under any entity: everything said about it, oldest
// first, plus the composer. (A session doesn't use this — its view
// weaves the heard comments into the thread and pins its own composer.)
export let Comments = ({ eid }: { eid: string }) => (
  <Frame>
    {commentsOn(eid).map((c) => <Note key={c.eid} c={c} />)}
    <Composer eid={eid} />
  </Frame>
)
