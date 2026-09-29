// The near-duplicate ("twin") facts the doc view's Similar section reads,
// kept platform-free and apart from the server's embedder (@yaks/embedding).

// A doc's text as one string: title and body. A doc with none has no
// neighbours to ask for.
export let textOf = (title: unknown, body: unknown) =>
  `${String(title ?? '')}\n${String(body ?? '')}`.trim().slice(0, 2000)

// How close counts as a twin. A floor belongs to the embedder's space, so it
// moves when the configured model does. In potion-retrieval-32M#256, over the
// tasks known to be duplicates, 0.66 lets the twin through for about three
// tasks in four, and something that is not a twin through for about as many.
export let FLOOR = 0.66
