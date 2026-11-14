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
// operator-box-browser.ts mounts it (`mountAsk`).
import { h } from 'preact'
import type { Bundle } from '@yaks/graph'
import type { Drafts } from '@yaks/ux'
import { Conversation } from '@yaks/ux/conversation'
import { Attachments, Button, Composer, Drop, Icon } from '@yaks/ui/parts'
import { Idle } from './mascot.ts'
import { icons } from './icons.ts'
import { Filed } from './operator-draw.ts'

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
