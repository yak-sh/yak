// The same villager entity id on every page and in the app's worker.
import { uuidOf } from './rand.ts'

export let eidOf = (id: string): string => uuidOf(`villager/${id}`)
