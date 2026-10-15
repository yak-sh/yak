// The same villager entity id on every page and in the app's worker.
import { uuidOf } from '@yaks/game'

export let eidOf = (id: string): string => uuidOf(`villager/${id}`)
