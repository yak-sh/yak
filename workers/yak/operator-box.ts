// The Operator chat page's message box: @yaks/ux's `Conversation.Box`, with
// what is the page's own handed to it. Drawn on the server into the page,
// where it posts as a form when no script runs, and again in the browser
// over what the server drew, as part of `_talk.js` (operator-rows.ts).
//
// The box holds the person's words as their draft and says when they are
// sent or Stop is pressed; the page says where each goes (operator-page.ts
// `chatScript`). The page's own along it: who the words go to on a helper's
// page, the yak beside it (mascot.ts `Idle`), the files held to send (picked,
// pasted or dropped anywhere on it, public/drop.js), each drawn as a sent one
// is (operator-draw.ts `Filed`), the microphone (public/voice.js), and over
// it Newest, while the reader has scrolled up from the newest line.
import { h, render } from 'preact'
import type { Bundle } from '@yaks/graph'
import type { Drafts } from '@yaks/ux'
import { Conversation } from '@yaks/ux/conversation'
import { Attachments, Button, Composer, Drop, Icon } from '@yaks/ui/parts'
import { Idle } from './mascot.ts'
import { icons } from './icons.ts'
import { Filed, PICTURES } from './operator-draw.ts'

/** What the page's box is, as the server says it, the same on the page. */
export type Asking = {
  /** the page's door, which the words are posted to */
  at: string
  /** this page's address, which the words say they were written on */
  here: string
  operator: string
  /** the app open beside the chat */
  app?: { slug: string; title?: string }
  /** on a helper's page, the person's conversation, where the words go */
  to?: string
  /** a new chat's, sitting in the page rather than at its foot */
  inline?: boolean
  /** where the yak's pictures are */
  base: string
  /** the id the next words are sent under */
  request: string
  /** the most files a message takes, and the most bytes of each */
  count: number
  size: number
  /** the kinds the Operator reads, as `accept` names them */
  reads: string[]
}

/** What the page holds of its box as it changes. */
export type Held = {
  /** the conversation the words go to, which Stop stops */
  session?: string
  busy?: boolean
  sending?: boolean
  said?: string
  /** the reader has scrolled up from the newest line */
  away?: boolean
  /** the files held to send */
  files?: Filed[]
  /** the id the next words are sent under, once the last were taken */
  request?: string
}

export type AskProps = Held & {
  asking: Asking
  place: string
  drafts: Drafts
  onSend?: (b: Bundle) => void
  onStop?: (b: Bundle) => void
  onNewest?: () => void
}

/** What a file the Operator cannot read says, held to send. */
export let UNREAD =
  "The Operator can't read this kind of file. It is kept with your message."

/** Whether `kinds` (as `accept` names them) take `file`. */
export let reads = (kinds: string[], file: { name: string; type: string }) => {
  let name = file.name.toLowerCase(), type = file.type.toLowerCase()
  return kinds.map((k) => k.trim().toLowerCase()).some((k) =>
    k.startsWith('.')
      ? name.endsWith(k)
      : k.endsWith('/*')
      ? type.startsWith(k.slice(0, -1))
      : type == k
  )
}

// What a draft is on the server, which draws the box before the page knows
// what the person has typed.
let unwritten: Drafts = { text: () => '', type: () => {}, spend: () => {} }

/** The box, as the server and the page both draw it. */
export let Ask = (
  {
    asking,
    place,
    drafts = unwritten,
    session,
    busy,
    sending,
    said = '',
    away,
    files = [],
    request = asking.request,
    onSend = () => {},
    onStop = () => {},
    onNewest = () => {},
  }: Partial<AskProps> & { asking: Asking; place: string },
) => {
  let { at, here, operator, app, to, inline, base } = asking
  // On a helper's page the words still go to the person's conversation,
  // never the helper, and the box says so along its top.
  let asked = to
    ? `Message ${operator} in your conversation`
    : app
    ? `What should change in ${app.title || app.slug}?`
    : `Message ${operator}`
  return h(
    Conversation.Box,
    {
      place,
      drafts,
      session,
      busy,
      sending,
      said,
      words: (body) => ({ entity: { eid: request }, content: { body } }),
      onSend,
      onStop,
      name: 'say',
      placeholder: asked,
      mod: inline && 'inline',
      class: 'Talk_Box Page_Form',
      id: 'ask',
      method: 'post',
      action: at,
      enctype: 'multipart/form-data',
      top: [
        to
          ? h(
            Composer.To,
            null,
            'To ',
            h('a', { href: to }, `your conversation with ${operator}`),
            ', not this helper',
          )
          : null,
        h(Composer.Figure, { as: Idle, base }),
        h(
          Attachments,
          { mod: 'held', 'aria-label': 'Files to send', 'aria-live': 'polite' },
          files.map((f, i) =>
            h(Filed, { ...f, remove: { 'data-drop-remove': i } })
          ),
        ),
      ],
      tools: [
        h(
          Composer.Attach,
          { title: 'Add images or documents, or paste or drop them here' },
          h(Icon, { of: icons.plus }),
          'Add files',
          h(Composer.File, {
            type: 'file',
            name: 'file',
            multiple: true,
            'data-count': asking.count,
            'data-size': asking.size,
          }),
        ),
        h(Drop.Said, { role: 'status' }),
      ],
      // shown where the browser or the platform can hear (public/voice.js)
      beside: h(
        Composer.Voice,
        {
          type: 'button',
          hidden: true,
          'data-voice': '',
          'aria-pressed': 'false',
          title: 'Talk instead of typing',
        },
        h(Icon, { of: icons.mic }),
        h('span', { 'data-voice-says': '' }, 'Talk'),
      ),
    },
    // Over the middle of the box while the person has scrolled up from the
    // newest line, taking them back to it (the conversation's `away`).
    h(
      Button,
      { type: 'button', class: 'Talk_Jump', hidden: !away, onClick: onNewest },
      h(Icon, { of: icons['arrow-down'] }),
      'Newest',
    ),
    h('input', { type: 'hidden', name: 'request', value: request }),
    h('input', { type: 'hidden', name: 'page', value: here }),
    app ? h('input', { type: 'hidden', name: 'app', value: app.slug }) : null,
  )
}

// The files an input holds, as the box draws them: a picture by a source of
// its own, which the page lets go once it is drawn no more.
let held = (input: HTMLInputElement, kinds: string[]): Filed[] =>
  [...input.files ?? []].map((f) => ({
    name: f.name,
    mime: f.type,
    size: f.size,
    ...PICTURES.includes(f.type) ? { src: URL.createObjectURL(f) } : {},
    ...reads(kinds, f) ? {} : { note: UNREAD },
  }))

/** What the page does to its box. */
export type Asked = ReturnType<typeof mountAsk>

/**
 * The box mounted over what the server drew in `root`, its words the
 * person's drafts at `place`. What the page holds of it changes by `set`;
 * `focus` puts the caret in it, at the end of what it holds when asked.
 */
export let mountAsk = (
  { root, ...given }: Omit<AskProps, keyof Held> & { root: Element },
) => {
  let now: Held = {}
  let draw = () => render(h(Ask, { ...given, ...now }), root)
  draw()
  let field = () => root.querySelector('textarea')
  let input = root.querySelector<HTMLInputElement>('input[type=file]')
  input?.addEventListener('change', () => {
    for (let f of now.files ?? []) if (f.src) URL.revokeObjectURL(f.src)
    now = { ...now, files: held(input, given.asking.reads) }
    draw()
  })
  return {
    set: (change: Held) => {
      now = { ...now, ...change }
      draw()
    },
    /** what it says under itself */
    said: () => now.said ?? '',
    focus: (end = false) => {
      draw()
      let f = field()
      f?.focus()
      if (end && f) f.setSelectionRange(f.value.length, f.value.length)
    },
  }
}
