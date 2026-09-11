# Renderer archetypes

`archetypes.json` freezes 432 distinct physical table sets from the September
11, 2026 scratch snapshot used for T-37058, ordered by descriptor spine id and
taking the first 432 rows of `archetype`. It contains only table names, not
entity data. This is a reproducible sample at the size of D-35546's September 10
census, not a claim to reconstruct that earlier census. The web and TUI parity
tests enumerate every set against every registered view and compare
component-based matching with archetype-based matching, including spine-only
projections.
