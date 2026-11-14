/** Controlled loading and submission with durable drafts. Domain data and
 * transport are supplied through callbacks. @module */
import { h, type JSX } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { Button, Form, Loading, Notice } from '@yaks/ui/parts'
import { type Drafts, useDrafts } from './host.ts'
import { type Path, put, type Values } from './field-values.ts'

/** Page state; the durable draft is the source of values. */
export type SubmitState<T = unknown> = {
  content?: T
  unread?: string
  values?: Values
  tried?: boolean
  sending?: boolean
  sent?: boolean
  said?: string
  /** When the content arrived, in epoch milliseconds: how long a sending took
   * is counted from it. */
  shown?: number
}
/** Sends `values`, and `signs`, what the page saw of the sending beside them,
 * such as how long it took; answers what refused it, if anything did. */
export type Send = (
  at: string,
  values: Values,
  signs?: Values,
) => Promise<string | undefined>
export type Read<T> = (at: string) => Promise<T | string>
export type Upload = (
  at: string,
  path: Path,
  file: File,
) => Promise<{ value: unknown } | string>
export type Feedback = Pick<SubmitState, 'sent' | 'said'>
export type SubmitView<T> = {
  content: T
  state: SubmitState<T>
  change: (next: SubmitState<T>) => void
  send: Send
  file: (path: Path, chosen: File) => Promise<void>
}
export type SubmitProps<T> = {
  at: string
  place: string
  drafts?: Drafts
  e?: Bundle
  onChange: (b: Bundle) => void
  read: Read<T>
  send: Send
  upload?: Upload
  initial?: (content: T) => Values
  feedback?: () => Feedback | undefined
  loading?: string
  render: (view: SubmitView<T>) => JSX.Element
}
/** Stable page state identity, separate from the caller's durable draft place. */
export let submitAt = (at: string): string => derivedEid(`Submit|${at}`)
export let submitOf = <T = unknown>(e?: Bundle): SubmitState<T> =>
  (e?.Submit as SubmitState<T> | undefined) ?? {}

/** Loads content and keeps edits until their submission succeeds. */
export let Submit = <T>(
  {
    at,
    place,
    drafts: supplied,
    e,
    onChange,
    read,
    send,
    upload: sendFile = () => Promise.resolve('File upload is unavailable.'),
    initial = () => ({}),
    feedback,
    loading = 'Loading…',
    render,
  }: SubmitProps<T>,
): JSX.Element => {
  let drafts = useDrafts(supplied)
  let text = drafts.text(place)
  let values: Values | undefined = text ? JSON.parse(text) : undefined
  let state = submitOf<T>(e)
  let latest = useRef(state)
  // A draft signal can repaint before the consumer returns emitted state.
  let prior = useRef(e)
  if (e !== prior.current) latest.current = state
  prior.current = e
  let emit = (change: SubmitState<T>) => {
    latest.current = { ...latest.current, ...change }
    onChange({ entity: { eid: submitAt(at) }, Submit: latest.current })
  }
  let load = async () => {
    emit({ unread: undefined })
    let content = await read(at)
    emit(
      typeof content == 'string'
        ? { unread: content }
        : { content, shown: Date.now() },
    )
  }
  let content = state.content
  useEffect(() => {
    if (JSON.stringify(state.values) != JSON.stringify(values)) {
      emit({ values })
    }
  }, [text])
  useEffect(() => {
    let result = feedback?.()
    if (result) {
      if (result.sent) drafts.spend(place)
      emit(result)
    }
    if (!content && !state.unread) void load()
  }, [at])
  if (!content) {
    return h(
      'section',
      { class: 'Submit' },
      state.unread
        ? [
          h(Notice, { mod: 'negative', role: 'alert' }, state.unread),
          h(
            Form.Actions,
            {},
            h(Button, { type: 'button', onClick: load }, 'Try again'),
          ),
        ]
        : h(Loading, {}, loading),
    )
  }
  let change = (next: SubmitState<T>) => {
    if (next.values) drafts.type(place, JSON.stringify(next.values))
    emit(next)
  }
  let file = async (path: (string | number)[], chosen: File) => {
    if (latest.current.sending) return
    change({
      sending: true,
      said: undefined,
      values: put(
        latest.current.values ?? initial(content),
        path,
        undefined,
      ),
    })
    let result = await sendFile(at, path, chosen)
    change(
      typeof result == 'string' ? { sending: false, said: result } : {
        sending: false,
        values: put(
          latest.current.values ?? initial(content),
          path,
          result.value,
        ),
      },
    )
  }
  let sent: Send = async (at, values, signs) => {
    let before = drafts.text(place)
    let said = await send(at, values, signs)
    if (said == null && drafts.text(place) == before) drafts.spend(place)
    return said
  }
  return render({
    content,
    state: { ...state, values },
    change,
    send: sent,
    file,
  })
}
