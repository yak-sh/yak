import { play } from './play.ts'
import { field, pine, traveler } from './world.ts'

await play(field(pine), traveler())
