/** @jsxImportSource preact */
import type { JSX } from 'preact'
// Comments and reply branches, rendered through the registry on every host.
// The composer is a Say line with a Field; its words are durable drafts.
import { useRef, useState } from 'preact/hooks'
import type { Bundle, Comp } from '@yaks/graph'
import { Button, Choices, Field, Notes, Say, Stamp } from '@yaks/ui'
import { drafts, useDraft } from '@yaks/draft/ui'
import { commentHost } from './comment-host.ts'
import { type Branch, branches, type CommentRow } from './comments.ts'

let comp = (b: Bundle, name: string) => b[name] as Comp | undefined
export let viaName = (eid?: string | null): string => {
  if (!eid) return 'anon'
  let host = commentHost(), b = host.get(eid)
  return b.client ? `web-${b.entity.num}` : host.id(b)
}
export let byline = (b: Bundle): string => {
  let host = commentHost(), stamp = comp(b, 'created')
  let actor = stamp?.by ? host.get(String(stamp.by)) : undefined
  let instrument = stamp?.via ? host.get(String(stamp.via)) : undefined
  let by = actor ? String(comp(actor, 'doc')?.title || host.id(actor)) : ''
  let via = instrument ? viaName(instrument.entity.eid) : ''
  return by && via && actor?.entity.eid != instrument?.entity.eid
    ? `${by} · via ${via}`
    : by || via || 'anon'
}
export let prompt = (b: Bundle, entry = false, model?: string): string => {
  let host = commentHost(), s = comp(b, 'session')
  let settled = !!s && !['pending', 'running'].includes(String(s.status))
  let who = s && (host.modelName(model) || host.id(b))
  return entry
    ? `send to ${who || host.id(b)}…`
    : settled
    ? `send to ${who}… (resumes the session)`
    : s
    ? 'comment… (the agent hears it on its next tool call)'
    : 'comment…'
}
/** The bundles words become. Commands remain comments, including on sessions. */
export let composerBundles = (
  target: string,
  body: string,
  entry: boolean,
  eid: string = crypto.randomUUID(),
  using?: { provider: string; model?: string; effort?: string },
  replyTo?: string,
): Bundle[] =>
  entry && !commentHost().command(body.split('\n')[0])
    ? [{
      entity: { eid },
      entry: { session: target },
      content: { body },
      ...(using ? { using } : {}),
    }]
    : [{
      entity: { eid },
      doc: { title: '', body },
      comment: { target, ...(replyTo ? { reply_to: replyTo } : {}) },
    }]

export let commentPlace = (eid: string, entry = false, replyTo?: string) =>
  `${eid}.${replyTo ? `reply:${replyTo}` : entry ? 'input' : 'comment'}`

export let Composer = ({ eid, entry = false, using, replyTo, onPost }: {
  eid: string
  entry?: boolean
  replyTo?: string
  onPost?: () => void
  using?: { provider: string; model?: string; effort?: string }
}): JSX.Element => {
  let host = commentHost(), box = useRef<HTMLTextAreaElement>(null)
  let model = host.useModel(eid)
  let [line, setLine] = useState(''), [pick, setPick] = useState(0)
  let { sync, spend } = useDraft(
    commentPlace(eid, entry, replyTo),
    box,
    setLine,
  )
  let typing = !line.includes('\n') && (line == ':' || host.command(line))
  let hints = typing ? host.hints(line.slice(1)) : []
  let put = (v: string) => {
    if (!box.current) return
    box.current.value = v
    setLine(v)
    setPick(0)
    sync(box.current)
  }
  let post = () => {
    let body = box.current?.value.trim()
    if (!body) return
    spend(
      composerBundles(eid, body, entry, crypto.randomUUID(), using, replyTo),
    )
    box.current!.value = ''
    setLine('')
    setPick(0)
    onPost?.()
  }
  let key = (e: KeyboardEvent) => {
    if (e.key == 'Enter' && !e.shiftKey) {
      e.preventDefault()
      post()
      return
    }
    if (e.key == 'Escape') return box.current?.blur()
    if (!hints.length) return
    if (e.key == 'Tab') {
      e.preventDefault()
      let hint = hints[pick]
      if (hint) put(`:${hint.name} `)
    } else if (e.key == 'ArrowUp' || e.key == 'ArrowDown') {
      e.preventDefault()
      setPick((p) =>
        Math.max(
          0,
          Math.min(hints.length - 1, p + (e.key == 'ArrowUp' ? 1 : -1)),
        )
      )
    }
  }
  return (
    <>
      {!!hints.length && (
        <Choices>
          {hints.slice(0, 6).map((hint, i) => (
            <Choices.Item
              key={hint.name}
              mod={i == pick && 'on'}
              onMouseEnter={() => setPick(i)}
              onMouseDown={(e: MouseEvent) => {
                e.preventDefault()
                put(`:${hint.name} `)
              }}
            >
              <Choices.Text>:{hint.name} {hint.args}</Choices.Text>
              <Choices.Note>{hint.about}</Choices.Note>
            </Choices.Item>
          ))}
        </Choices>
      )}
      <Say
        onSubmit={(e: Event) => {
          e.preventDefault()
          post()
        }}
      >
        <Field
          lines
          elRef={box}
          data-eid={eid}
          rows={1}
          onInput={(e: InputEvent) => {
            let el = e.currentTarget as HTMLTextAreaElement
            sync(el)
            setLine(el.value)
            setPick(0)
          }}
          placeholder={replyTo ? 'reply…' : prompt(host.get(eid), entry, model)}
          onKeyDown={key}
        />
        <Button type='submit' disabled={!line.trim()}>send</Button>
      </Say>
    </>
  )
}
export let Reply = ({ c }: { c: Bundle }): JSX.Element => {
  let host = commentHost(),
    comment = comp(c, 'comment')!,
    target = String(comment.target)
  let box = host.usePage('commentBox', c.entity.eid)
  let open = box.value && 'open' in box.value
    ? !!box.value.open
    : !!drafts.text(commentPlace(target, false, c.entity.eid))
  return open
    ? (
      <>
        <Composer
          eid={target}
          replyTo={c.entity.eid}
          onPost={() => box.set({ open: false })}
        />
        <Button
          type='button'
          mod='quiet'
          onClick={() => box.set({ open: false })}
        >
          close reply (draft kept)
        </Button>
      </>
    )
    : (
      <Button type='button' mod='quiet' onClick={() => box.set({ open: true })}>
        reply
      </Button>
    )
}
/** A registry entry's face, used for both comments and commits. */
export let Note = (
  { c, reply = true }: { c: Bundle; reply?: boolean },
): JSX.Element => {
  let host = commentHost(), stamp = comp(c, 'created')
  let actor = stamp?.by ? host.get(String(stamp.by)) : undefined
  let instrument = stamp?.via ? host.get(String(stamp.via)) : undefined
  let who = actor ?? instrument
  let verdict = comp(c, 'review')?.verdict
  return (
    <Notes.Item>
      {who && (
        <Notes.Who>
          <a {...host.link(who)}>{host.render(who, 'Card.Title')}</a>
        </Notes.Who>
      )}
      {actor && instrument && actor.entity.eid != instrument.entity.eid && (
        <Notes.Who>
          · via{' '}
          <a {...host.link(instrument)}>
            {host.render(instrument, 'Card.Title')}
          </a>
        </Notes.Who>
      )}
      {!!verdict && <span>{String(verdict).replaceAll('_', ' ')}</span>}
      <a {...host.link(c)} title={host.timestamp(stamp?.at as string)}>
        <Stamp>{host.when(stamp?.at as string)}</Stamp>
      </a>
      {host.pending(c) ? <Notes.Text>…</Notes.Text> : c.commit
        ? (
          <Notes.Text>
            <code>{c.entity.eid.slice(0, 7)}</code>{' '}
            {String(comp(c, 'commit')?.message ?? '').split('\n')[0]}
          </Notes.Text>
        )
        : <Notes.Text>{host.render(c, 'Thread.Body')}</Notes.Text>}
      {reply && c.comment && <Reply c={c} />}
    </Notes.Item>
  )
}
export let Landed = ({ c }: { c: Bundle }): JSX.Element => (
  <Note c={c} reply={false} />
)
export let Twig = ({ node }: { node: Branch }): JSX.Element => (
  <>
    {commentHost().render(node.row, 'Thread.Note')}
    {!!node.children.length && (
      <Notes.Children>
        {node.children.map((child) => (
          <Twig key={child.row.entity.eid} node={child} />
        ))}
      </Notes.Children>
    )}
  </>
)
export let Branches = ({ rows }: { rows: Bundle[] }): JSX.Element => (
  <>
    {branches(rows as CommentRow[]).map((node) => (
      <Twig key={node.row.entity.eid} node={node} />
    ))}
  </>
)
export let Comments = ({ eid }: { eid: string }): JSX.Element => {
  let host = commentHost()
  let said = host.useRows(
    host.has('comment') ? `.comment.target=${eid}&*&.order=created.at` : '',
  )
  let landed = host.useRows(
    host.has('commit') ? `.commit.target=${eid}&*&.order=created.at` : '',
  )
  return (
    <Notes>
      <Branches rows={[...said, ...landed]} />
      {host.has('comment') && host.has('doc') && <Composer eid={eid} />}
    </Notes>
  )
}
