// The near-duplicate ("twin") facts the doc view's Similar section reads,
// kept platform-free and apart from the server's embedder (@yaks/embedding).

// A doc's text as one string: title and body. A doc with none has no
// neighbours to ask for.
export let textOf = (title: unknown, body: unknown) =>
  `${String(title ?? '')}\n${String(body ?? '')}`.trim().slice(0, 2000)

// How close counts as a twin. A floor belongs to the embedder's space, so it
// moves when the configured model does. In granite-embedding-30m-english, over
// the tasks known to be duplicates, 0.86 lets the twin through for about three
// tasks in four, and the nearest task that is not a twin for about two in five.
export let FLOOR = 0.86
