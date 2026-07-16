import { useEffect, useRef } from 'preact/hooks'
import { signal } from '@preact/signals'
import { camera, mode } from '../live.ts'
import { block } from './ui.tsx'

let Frame = block('footer', 'Status', {
  Mode: 'span',
  Colon: 'span',
  Cmd: 'input',
  Msg: 'span',
})
let { Mode, Colon, Cmd, Msg } = Frame

let msg = signal('')

// The : commands, harness-style. A command returns a statusbar message (or
// nothing); unknown names say so. Grows by adding a key.
let commands: Record<string, (args: string[]) => string | void> = {
  zoom: ([n]) => {
    let z = Math.min(4, Math.max(0.25, Number(n) || 1))
    camera.value = { ...camera.value, zoom: z }
    return `zoom ${z}`
  },
}

let run = (line: string) => {
  let [name, ...args] = line.trim().split(/\s+/)
  if (!name) return
  let c = commands[name]
  msg.value = c ? c(args) ?? '' : `not a command: ${name}`
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
    return () => {
      removeEventListener('keydown', key)
      document.removeEventListener('selectionchange', sel)
    }
  }, [])

  // The command line grabs focus the moment it appears.
  useEffect(() => {
    if (mode.value == 'command') input.current?.focus()
  })

  let cmdKey = (e: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (e.key == 'Enter') {
      run(e.currentTarget.value)
      e.currentTarget.value = ''
      mode.value = 'normal'
    } else if (e.key == 'Escape') {
      e.currentTarget.value = ''
      mode.value = 'normal'
    }
  }

  return (
    <Frame>
      {mode.value == 'command'
        ? (
          <>
            <Colon>:</Colon>
            <Cmd elRef={input} onKeyDown={cmdKey} />
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
    </Frame>
  )
}
