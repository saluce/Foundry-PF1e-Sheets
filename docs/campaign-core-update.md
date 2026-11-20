# 0.11 campaign hub implementation

One combined release, tested against an isolated database before live migration.

- Preserve inventory on character import; explicit replacement/merge proposals require GM approval.
- Editable locations, private prepared loot, resumable item review, read-only Obsidian folders.
- Game logo, simplified navigation, limited profiles, party health and trade badges.
- Conditions/custom approval, spell preparation/use, rest, equipment baselines and comparisons.
- Rules/house rules, Golarion/custom calendar, categories/fields and per-player permissions.
- Foundry combat/time relay with stale state, independent combat trade restriction/action guidance.
- Personal accessibility/preferences, co-GM grants, backups, log retention/clearing.

Owner and authorized GMs always receive detailed health; hidden death remains bleeding out to others until revealed. Four health bands default to 25% each, with three movable internal boundaries. Private vault paths and true item data never enter player state. No PDF import in this release.
