// Human-facing graph addresses. Transport stays local through TASKS_HOST;
// anything handed to a person uses the board's stable public door.

let origin = 'https://tasks.yak.sh'

export let entityUrl = (id: string) => `${origin}/${id}`
