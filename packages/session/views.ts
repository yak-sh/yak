// The `/views` facet: how a transcript is drawn wherever this package's views
// are asked for. `views`, the portable lines every interface prints
// (./lines.ts); and `inspectViews`, the inspector's pages and parts for an
// entry and a session (./inspect.ts).

export { sessionViews as views } from './lines.ts'
export { inspectViews } from './inspect.ts'
