# Village Tasks

This app belongs in the same space as `vale`, at `/village-tasks/`, with
`access: open`: each visitor may add a completion for their selected Vale hero.
The task and completion rows live here. Vale remains the home of `player` and
`villager`; neither component is declared or copied here.

The page reads Vale through `store('/vale/api/')`. It takes the selected hero
eid from Vale's `mossvale.hero` session key, checks that Vale holds that player,
and writes `village_done{task, player, at}` under an eid derived from the task
and hero. Vale reads this app through the same sibling store door when the hero
talks to Pip. A completion changes only that hero's line.
