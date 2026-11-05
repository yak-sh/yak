/** Browser-safe command grammar, completion and help text, with no runtime IO. */
export * from './args.ts'
export { complete, type Lookup, quoted } from './complete.ts'
export { type Prop, type Schema } from './tool.ts'
export { toolHelp, toolLines } from './show.ts'
