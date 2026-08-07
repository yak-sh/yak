// The web keybinding card and its global `?` door. While the card is open its
// capture listener owns every key, so canvas and mode handlers beneath it
// cannot act on a hidden surface.
import { signal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { mode } from '../live.ts'
import { webKeys } from '../keybindings.ts'
import { block } from './ui.tsx'

export let keybindingsOpen = signal(false)

export let keybindingKey = (
  key: string,
  repeat = false,
  typing = false,
) => {
  if (keybindingsOpen.value) {
    if (key != '?' && key != 'Escape') return false
    keybindingsOpen.value = false
    return true
  }
  if (mode.value != 'normal' || repeat || typing || key != '?') return false
  keybindingsOpen.value = true
  return true
}

let Frame = block('div', 'Keybindings', {
  Box: 'section',
  Head: 'header',
  Title: 'h2',
  Close: 'button',
  List: 'dl',
  Row: 'div',
  Keys: 'dt',
  About: 'dd',
})
let { Box, Head, Title, Close, List, Row, Keys, About } = Frame

export let Keybindings = () => {
  let box = useRef<HTMLElement>(null)

  useEffect(() => {
    let key = (e: KeyboardEvent) => {
      if (keybindingsOpen.value) {
        e.preventDefault()
        e.stopPropagation()
        keybindingKey(e.key, e.repeat)
        return
      }
      let typing = e.target instanceof HTMLElement &&
        e.target.matches('input, textarea, select, [contenteditable]')
      if (keybindingKey(e.key, e.repeat, typing)) e.preventDefault()
    }
    addEventListener('keydown', key, true)
    return () => removeEventListener('keydown', key, true)
  }, [])

  useEffect(() => {
    if (keybindingsOpen.value) box.current?.focus()
  }, [keybindingsOpen.value])

  if (!keybindingsOpen.value) return null
  return (
    <Frame
      onMouseDown={(e: MouseEvent) =>
        e.target == e.currentTarget && (keybindingsOpen.value = false)}
      onPointerDown={(e: PointerEvent) => e.stopPropagation()}
    >
      <Box
        elRef={box}
        role='dialog'
        aria-modal='true'
        aria-labelledby='keybindings-title'
        tabIndex={-1}
      >
        <Head>
          <Title id='keybindings-title'>Keybindings</Title>
          <Close
            type='button'
            aria-label='Close keybindings'
            onClick={() => keybindingsOpen.value = false}
          >
            ×
          </Close>
        </Head>
        <List>
          {webKeys.map((binding) => (
            <Row key={binding.keys.join('-')}>
              <Keys>
                {binding.keys.flatMap((key, i) => [
                  i > 0 ? ' / ' : null,
                  <kbd key={key}>{key}</kbd>,
                ])}
              </Keys>
              <About>{binding.about}</About>
            </Row>
          ))}
        </List>
      </Box>
    </Frame>
  )
}
