// @yaks/logic: a relational runtime in the miniKanren manner. Terms unify
// (./term.ts), goals answer every env in which they hold and defer what they
// cannot answer yet (./goal.ts), and relations answer from whichever of their
// arguments are bound (./relations.ts). Effects are data, performed by `race`.
export * from './term.ts'
export * from './goal.ts'
export * from './relations.ts'
