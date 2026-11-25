/**
 * What a `Copy` (./Copy.ts) does in the browser: its button shows, and a press
 * puts the words beside it on the clipboard, a check in its place for a
 * moment. Where the clipboard is refused, the words are selected, so the
 * person's own copy keystroke lands.
 *
 * @module
 */

// Put the words beside `go` on the clipboard.
let copy = async (go: HTMLElement) => {
  let words = go.previousElementSibling!
  let box = go.parentElement!
  try {
    await navigator.clipboard.writeText(words.textContent ?? '')
    box.classList.add('Copy-copied')
    setTimeout(() => box.classList.remove('Copy-copied'), 2000)
  } catch {
    let range = document.createRange()
    range.selectNodeContents(words)
    let picked = getSelection()
    picked?.removeAllRanges()
    picked?.addRange(range)
  }
}

/** Show the copy buttons in `root`; call it again once `root` is drawn anew. */
export let shown = (root: ParentNode): void => {
  for (let go of root.querySelectorAll<HTMLElement>('.Copy_Go')) {
    go.hidden = false
  }
}

/** Work every copy button in `root`, now and as it is drawn again. The
 * answer lets go of it. */
export let copying = (root: HTMLElement): () => void => {
  let click = (e: Event) => {
    let go = (e.target as Element).closest<HTMLElement>('.Copy_Go')
    if (go) void copy(go)
  }
  root.addEventListener('click', click)
  shown(root)
  return () => root.removeEventListener('click', click)
}
