// Every host importing builders installs the same output-choice invariant.
import { choices } from './choice.ts'
export let rules = () => [choices()]
