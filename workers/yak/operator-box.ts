// The Operator chat page's message box: @yaks/ux's `Conversation.Box`, with
// what is the page's own handed to it. Drawn on the server into the page,
// where it posts as a form when no script runs, and again in the browser
// over what the server drew, as part of `_talk.js` (operator-rows.ts).
//
// The box holds the person's words as their draft and says when they are
// sent or Stop is pressed; the page says where each goes (operator-page.ts
// `chatScript`). The page's own along it: who the words go to on a helper's
// page, the yak beside it (mascot.ts `Idle`), its file slot, the microphone
// (public/voice.js), and over it Newest, while the reader has scrolled up
// from the newest line. operator-box-browser.ts mounts it (`mountAsk`).
//
// The file slot is the files held to send: picked by Add files, or pasted
// or dropped anywhere on the box (the box's `onFiles`), each joining those
// held, within the most the box takes (`within`), and each drawn as a sent
// one is (@yaks/session/conversation `Filed`) with a button that takes it
// back. The page holds them in the form's file input, so they go with the
// words however the form is sent.
import { h } from 'preact'
import { appQuestion } from '@yaks/platform/app-canvas-view'
import type { Bundle } from '@yaks/graph'
import type { Drafts } from '@yaks/ux'
import { Conversation } from '@yaks/ux/conversation'
import { Attachments, Button, Composer, Drop, Form, Icon } from '@yaks/ui/parts'
import { Idle } from './mascot.ts'
import { icons } from './icons.ts'
import { Filed } from '@yaks/session/conversation'

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
  /** the most files a message takes */
  count: number
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
  /** what was left out of them, past the most the box takes */
  left?: string
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
  /** files picked, pasted or dropped, to join those held */
  onFiles?: (files: File[]) => void
  /** the held file at its place, taken back */
  onRemove?: (at: number) => void
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

/** The files a box holds and what it says when more were picked. */
export let within = <F>(
  files: F[],
  { count }: { count: number },
): { kept: F[]; left: string } => ({
  kept: files.slice(0, count),
  left: files.length > count
    ? `Up to ${count} files go at a time, so the rest were left out.`
    : '',
})

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
    left = '',
    request = asking.request,
    onSend = () => {},
    onStop = () => {},
    onNewest = () => {},
    onFiles,
    onRemove = () => {},
  }: Partial<AskProps> & { asking: Asking; place: string },
) => {
  let { at, here, operator, app, to, inline, base } = asking
  // On a helper's page the words still go to the person's conversation,
  // never the helper, and the box says so along its top.
  let asked = to
    ? `Message ${operator} in your conversation`
    : app
    ? appQuestion(app)
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
      onFiles,
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
            h(Filed, { ...f, remove: { onClick: () => onRemove(i) } })
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
            onChange: (ev: Event) =>
              onFiles?.([
                ...(ev.currentTarget as HTMLInputElement).files ?? [],
              ]),
          }),
        ),
        h(Drop.Said, { role: 'status' }, left),
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
    h(Form.Hidden, { name: 'request', value: request }),
    h(Form.Hidden, { name: 'page', value: here }),
    app ? h(Form.Hidden, { name: 'app', value: app.slug }) : null,
  )
}
