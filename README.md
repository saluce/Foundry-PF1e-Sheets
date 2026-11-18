# PF1 Inventory · Sheets Sync

Version 0.7.0 for Foundry VTT 13 / Pathfinder 1e 11.x. Editable character inventories, party loot, separate bank wallets and reviewable two-way sync.

Install manifest: https://github.com/saluce/Foundry-PF1e-Sheets/releases/latest/download/module.json

Download both blank templates from [the latest release](https://github.com/saluce/Foundry-PF1e-Sheets/releases/latest), import them as separate Google spreadsheets, and follow [the setup guide](docs/setup.md). The private GM workbook requires a new private standalone Apps Script deployment. Do not reuse a script attached to a player-shared workbook.

GM-only names, values, properties and notes stay in a separate private file. Reveal name, value and properties independently; notes never reveal. GM-managed locations and partial-stack transfers preserve private record links. Existing PF1 mechanics retain normal Foundry visibility. Confirm d20PFSRD matches to fill weights and full purchase prices, with private prices by default, variant choices and explicit pack conversion.

Run `node --test tests/*.test.mjs web-portal/tests/*.test.mjs`. All 95 checks pass locally; live Google/Foundry integration still needs a test-world check. Back up your world before first use. No campaign inventories or secrets are included here.

## Website outside Foundry

Download **Party.Ledger.Server.zip** from the latest release and follow the [home-server guide](web-portal/README.md). Players can sign in, edit assigned inventories, look up weights/estimates, and offer trades while Foundry is closed. Actual values, differences and notes stay on the server for GM accounts. Node.js 24 or newer is required. The server defaults to localhost; configure an HTTPS proxy/tunnel for remote players. Google Sheets remains an optional connection.

## Character hub and map HP

Open Character sheets on the website to import PCGen .pcg or XML exports, track HP and resources, and use combat, skills, spells and feature sections. In Foundry 13, Review website HP feed starts an automatic five-second current/temporary HP feed after the GM checks the initial changes. The feed pauses on native HP changes. Foundry keeps calculated maximum HP. See the home-server guide for setup and limitations.
