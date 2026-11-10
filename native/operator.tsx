// The Operator, drawn natively: the person's conversation as the chat page's
// socket sends it, each line as the entries it draws
// (workers/yak/operator-draw.ts `Lines`), drawn by the drawing the web page
// uses and painted by @yaks/native as a kit-built app is (kit.tsx). Words
// typed here are sent the way the page's box sends them.
import { type ComponentRef, useEffect, useRef, useState } from 'react'
import { KeyboardAvoidingView, ScrollView, StyleSheet } from 'react-native'
import { h, type VNode } from 'preact'
import { useEffect as useSoon, useState as useHeld } from 'preact/hooks'
import { Button, Field, Notice, Transcript } from '@yaks/ui'
import { look, mount, type Node } from '@yaks/native'
import {
  drawLines,
  type Lines,
  look as talkLook,
} from '../workers/yak/operator-draw.ts'
import { colors, Draw } from './kit.tsx'
import { report } from './report.ts'
import { APEX, type Space } from './yaks.ts'

let looks = (() => {
  let kit = look(colors)
  return { ...kit, classes: { ...kit.classes, ...talkLook(colors) } }
})()

// Each line drawn, by the id it is put by, in the order the page shows them.
type Drawn = Map<string, VNode | string | null>
let drawnOf = (sent: Lines | null | undefined, into: Drawn = new Map()) => {
  let next = new Map(into)
  for (let { id, node } of sent ? drawLines(sent) : []) {
    next.set(id, node as VNode)
  }
  return next
}

/** One frame of the page's socket (operator-view.ts `frame`), as read here. */
type Frame = {
  operator?: {
    task: string
    lines?: Lines
    typing?: string
    now?: string
    refresh?: boolean
  }
}

// The conversation, its lines kept current by the socket, with the box to
// write in under it.
let Talk = ({ space }: { space: Space }) => {
  let at = `${APEX}/manage/${space.slug}/operator`
  let [lines, setLines] = useHeld<Drawn>(new Map())
  let [now, setNow] = useHeld('')
  let [typing, setTyping] = useHeld('')
  let [words, setWords] = useHeld('')
  let [trouble, setTrouble] = useHeld('')
  // The person's one conversation, read whole.
  let read = async () => {
    let r = await fetch(`${at}?talk=&lines=1`)
    if (!r.ok) throw new Error('Your conversation could not be read.')
    let got = await r.json() as { task: string; lines?: Lines; now?: string }
    setLines(drawnOf(got.lines))
    setNow(got.now ?? '')
    return got.task
  }
  useSoon(() => {
    let socket: WebSocket | undefined, gone = false, mine = ''
    // A drop the socket recovers from says nothing; one it has not reopened
    // from in thirty seconds is reported, once while it lasts, as
    // @yaks/sync's `Dropped` is.
    let down = 0, tries = 0, told = false
    let hear = (frame: Frame) => {
      let o = frame.operator
      if (o?.refresh) return void read().catch((e) => setTrouble(e.message))
      if (!o || (mine && o.task != mine)) return
      if (o.typing) return void setTyping((was) => was + o.typing)
      setTyping('')
      setLines((was) => drawnOf(o.lines, was))
      setNow(o.now ?? '')
    }
    let listen = () => {
      socket = new WebSocket(`${at.replace(/^http/, 'ws')}?live=1&lines=1`)
      // Opened again, it may have missed steps: the conversation is read
      // again, as the page does.
      socket.onopen = () => {
        down = tries = 0
        told = false
        read().then((t) => void (mine = t), (e) => setTrouble(e.message))
      }
      socket.onmessage = (e) => hear(JSON.parse(String(e.data)))
      socket.onclose = (e) => {
        if (gone) return
        down ||= Date.now()
        tries++
        if (!told && Date.now() - down >= 30_000) {
          told = true
          report(
            Error(`The Operator's socket closed (${e.code}) and stays shut`, {
              cause: `it has not reopened: ${tries} attempts`,
            }),
          )
        }
        setTimeout(listen, 3000)
      }
    }
    listen()
    return () => {
      gone = true
      socket?.close()
    }
  }, [at])
  let send = async (e?: Event) => {
    e?.preventDefault()
    let say = words.trim()
    if (!say) return
    setWords('')
    setTrouble('')
    let form = new FormData()
    form.append('say', say)
    let r = await fetch(at, { method: 'POST', body: form }).catch(() => null)
    // Words not taken stay in the box, to send again.
    if (!r?.ok) {
      setWords(say)
      setTrouble('Your message could not be sent. Try again.')
    }
  }
  return h(
    Transcript.Lines,
    {
      as: 'main',
      onClick: async (e: Event) => {
        let button = (e.target as Element).closest?.('[data-archive-entries]')
        if (!button) return
        try {
          let response = await fetch(`${at}?archive=1`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              ids: button.getAttribute('data-archive-entries')!.split(','),
              restore: button.getAttribute('data-restore') == 'true',
            }),
          })
          if (!response.ok) {
            throw new Error('These entries could not be changed. Try again.')
          }
          await read()
        } catch (e) {
          setTrouble((e as Error).message)
        }
      },
    },
    [...lines].map(([id, node]) => h('div', { key: id }, node)),
    typing ? h(Transcript.Reply, { as: 'p' }, typing) : null,
    now ? h(Transcript.Status, {}, now) : null,
    trouble ? h(Notice, { mod: 'negative' }, trouble) : null,
    h(
      'form',
      { onSubmit: send },
      h(Field, {
        value: words,
        lines: true,
        placeholder: `Message ${space.title}’s Operator`,
        onInput: (e: Event) =>
          setWords((e.target as HTMLTextAreaElement).value),
      }),
      h(Button, { type: 'submit', mod: 'go' }, 'Send'),
    ),
  )
}

/** The space's Operator, drawn natively, kept scrolled to its newest line. */
export let Operator = ({ space }: { space: Space }) => {
  let [node, setNode] = useState<Node | null>(null)
  let scroll = useRef<ComponentRef<typeof ScrollView>>(null)
  useEffect(
    () => mount(h(Talk, { space }), looks, setNode, { fell: report }),
    [space.slug],
  )
  return (
    <KeyboardAvoidingView style={styles.page} behavior='padding'>
      <ScrollView
        ref={scroll}
        style={styles.page}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps='handled'
        onContentSizeChange={() =>
          scroll.current?.scrollToEnd({ animated: false })}
      >
        {node ? <Draw node={node} /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

let styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 24 },
})
