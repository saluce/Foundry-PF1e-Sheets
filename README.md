# PF1 Inventory · Sheets Sync

Version 0.3.0 for Foundry VTT 13 / Pathfinder 1e 11.x. Editable character inventories, party loot, separate bank wallets and reviewable two-way sync.

Install manifest: https://github.com/saluce/Foundry-PF1e-Sheets/releases/latest/download/module.json

Download both blank templates from [the latest release](https://github.com/saluce/Foundry-PF1e-Sheets/releases/latest), import them as separate Google spreadsheets, and follow [the setup guide](docs/setup.md). The private GM workbook requires a new private standalone Apps Script deployment. Do not reuse a script attached to a player-shared workbook.

GM-only names, values, properties and notes stay in a separate private file. Reveal name, value and properties independently; notes never reveal. GM-managed locations and partial-stack transfers preserve private record links. Existing PF1 mechanics retain normal Foundry visibility.

Run `node --test tests/*.test.mjs`. All 30 checks pass locally; live Google/Foundry integration still needs a test-world check. Back up your world before first use. No campaign inventories or secrets are included here.
