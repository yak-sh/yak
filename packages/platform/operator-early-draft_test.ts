import { equal, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { earlyDraftScript, takeEarlyDraft } from './operator-early-draft.ts'

let disk = () => {
  let values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, text: string) => {
      values.set(key, text)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
}

let box = (scope: string, storage: ReturnType<typeof disk>) => {
  let { document, Event } = parseHTML(
    `<section data-early-draft="${scope}"><form>
      <textarea name="say"></textarea><button type="submit">Send</button>
    </form></section><script></script>`,
  )
  let script = document.querySelector('script')!
  new Function('document', 'window', earlyDraftScript())(
    { currentScript: script },
    { localStorage: storage, crypto, requestAnimationFrame: () => {} },
  )
  let field = document.querySelector('textarea')!
  return {
    type: (text: string) => {
      field.value = text
      field.dispatchEvent(new Event('input'))
    },
    sent: (kept = true) => {
      let restored: string[] = []
      takeEarlyDraft(
        script.previousElementSibling!,
        (text) => {
          restored.push(text)
          return kept
        },
        new AbortController().signal,
      )
      return restored
    },
  }
}

test('early composer edits survive a reload and are handed to the matching draft once', () => {
  let storage = disk()
  let first = box('person:chat', storage)
  let other = box('other:chat', storage)
  first.type('Kept before reload')
  other.type('Another person’s words')
  let reopened = box('person:chat', storage)
  reopened.type('Typed before sync')
  equal(reopened.sent(), ['Kept before reload', 'Typed before sync'])
  equal(box('person:chat', storage).sent(), [])
  equal(other.sent(), ['Another person’s words'])
})

test('clearing an early edit takes it out of recovery', () => {
  let storage = disk()
  let first = box('person:chat', storage)
  first.type('Changed my mind')
  first.type('')
  equal(box('person:chat', storage).sent(), [])
})

test('the early copy stays when the draft desk cannot keep it', () => {
  let storage = disk()
  let first = box('person:chat', storage)
  first.type('Still here')
  equal(first.sent(false), ['Still here'])
  equal(box('person:chat', storage).sent(), ['Still here'])
})
