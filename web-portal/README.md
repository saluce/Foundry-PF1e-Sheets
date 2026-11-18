# Wayfinder’s Rest — your party’s home

A local character, inventory and campaign hub. Players can use their browsers while Foundry is closed. Node.js 24 or newer is required; no npm packages or Google deployment are needed for the website.

## Start on your PC

1. Extract the entire **Party.Ledger.Server.zip** release archive into its own folder, outside Foundry's publicly served Data folder and outside shared/cloud-synced folders. Keep the sibling scripts and google-apps-script folders: they supply validation and the d20PFSRD parser.
2. On Windows, double-click **web-portal/Start Ledger.cmd**. Keep its window open. Or run `node web-portal/server.mjs --open` from the extracted root.
3. First launch opens a private setup link. Create your GM account with a unique password of at least 12 characters. The one-use setup link is also saved as setup-link.txt beside the database. It stops working once the account exists.
4. In the GM desk, import your private ledger JSON if the ledger is empty. The supplied blank server does not include campaign data. This workspace's prepared local server already has the migrated campaign imported.
5. Open **Players & accounts** from the GM sidebar, or from the GM desk. Use **Invite a player** for a one-use signup link and **Assign characters** on an existing account to choose its editable inventories. Create new character inventories using **+ Inventory**. A player creates their own account through the one-use invitation. Assign characters to control which inventories they may edit. Accounts can be reassigned or disabled; this signs the player out immediately.

Default address: **http://127.0.0.1:4317/**, accessible only on the host PC. This localhost address cannot be shared with remote players. The server binds to loopback by default and does not change your router or firewall.

Default data folder: `%LOCALAPPDATA%/PF1PartyLedger` on Windows, or `PF1PartyLedger` under XDG_DATA_HOME/home on other platforms. Use `--data /absolute/private/folder` to choose another. The prepared campaign launcher in this workspace uses outputs/portal/data instead. Never put that directory inside Foundry Data, the public/ directory, a shared drive, or the public repository.

## Internet access

Configure an HTTPS reverse proxy or tunnel to `http://127.0.0.1:4317`, then set `PORTAL_ORIGIN` to the external **origin only**, such as `https://loot.example.com`, before starting the server. The same address is used for invitations and Foundry's endpoint. Keep the listener on loopback when using a tunnel/proxy. Use a stable address and preserve the database. Do not expose the plain HTTP listener directly to the internet.

PowerShell example after configuring your HTTPS proxy:

```powershell
$env:PORTAL_ORIGIN = 'https://loot.example.com'
node web-portal/server.mjs
```

The server uses HttpOnly, SameSite cookies, Secure cookies with an HTTPS origin, same-origin checks, CSRF tokens, salted password hashes and server-side access checks. It does not trust arbitrary Origin headers or enable wildcard CORS. A trusted HTTPS proxy must route only the intended hostname. Hosting configuration, real remote connections and live Foundry integration require verification on your own network. Your PC and server process must stay running; Foundry may be closed.

## Public and private values

- Everyone signed in can view party inventories, weights and player value estimates. Players edit only assigned inventories.
- Only GM accounts receive actual values, true names, secret properties, GM notes and the differences between actual and estimated values.
- Difference is **actual unit value − player estimate per unit**. Stack difference multiplies that by quantity. If either value is unknown, the difference stays unknown.
- Revealing name, actual value or properties copies only selected fields to the player view. Notes never reveal. Revealing actual value replaces the player estimate and makes that difference zero. Previously disclosed information cannot be made secret retroactively.
- Existing migrated values remain estimates. They are not silently converted from half-sale prices or replaced with catalog values. Review migration notes and unrecorded coin denominations at the GM desk.

Select **Edit** beside an item to change it or offer a trade. Recipients or the GM accept ordinary offers. Party Loot requests require GM approval. GM transfers can be immediate. Partial stacks get new IDs and copy private records on the server. Charged stacks move in full. Concurrent edits/competing offers are rejected when the original item changes; cancel an outdated offer and create a new one. A pending offer does not reserve the item.

**Look up** searches d20PFSRD and lets you confirm a source, variant and pack size before saving. Weight is public; GM price defaults to private actual value. Players may fill their own public estimates. Pack size divides both selected source values. Source URLs and confirmed values are recorded only in the private database audit history. Lookup does not calculate custom enchantments, sizes or remaining-charge prices. Search may miss items; paste a specific d20PFSRD URL if needed.

## Foundry connection

1. Install module v0.5.0 or later. In its settings select **Inventory connection type → Website / home server**.
2. At the website GM desk → Configure connection, list the exact Foundry browser origins, for example `http://localhost:30000` or `https://foundry.example.com`, without trailing slashes. Generate a connection secret and copy it privately; it is shown once. Changing the secret invalidates the old one.
3. Enter the website's `/api/bridge` URL and website secret in the module's website settings. Keep your old Google settings for the archive. Google and website baselines are stored separately.
4. Choose owners/actors and preview the first sync carefully. The imported row IDs are preserved. Website edits do not directly rewrite Foundry world files. Each sync requires an active GM client and confirmation; the website continues working when Foundry is closed.

An HTTPS Foundry page needs an HTTPS website endpoint; browsers can block an HTTP endpoint as mixed content. A locally hosted desktop/browser Foundry can use the local HTTP endpoint for testing. CORS allows only the origins configured by the GM, and the bridge secret is always required. The bridge binds to the first world ID that connects. Retain its database and binding when changing addresses.

Foundry's item lookup buttons open the website when using this connection. Manage new character inventories at the website before mapping them. Native PF1 mechanics retain their normal Foundry visibility. This website's private fields do not hide arbitrary existing descriptions or effects on player-owned actors.

## Backups and recovery

Use **Download private backup** at the GM desk. It contains item IDs, quantities, wallets, private records and migration notes; keep it private. Player CSV export excludes all private fields. JSON imports are accepted only into an empty ledger and never replace an existing campaign silently. A local import can also be run with `node web-portal/server.mjs import /path/to/private-backup.json --data /path/to/empty-data-folder`.

For a complete account/session/trade backup, stop the server and copy its whole data directory, including the SQLite database and any WAL files. Restore it only while the server is stopped. The private database audit contains pre-sync recovery data. Do not edit Foundry databases directly. Passwords and connection secrets are not included in the portable inventory JSON export.

## Checks

From the server archive root: `node --test web-portal/tests/*.test.mjs`. From the full source repository: `node --test tests/*.test.mjs web-portal/tests/*.test.mjs`. Automated checks cover role separation, stale writes, estimates/reveals, invitations, password hashing, CSRF, CORS, public exports, lookups, transfers and the Foundry bridge. The local GM/player pages are also checked in a browser. Internet hosting and live Foundry sync need a test on the target installation.

## Version 0.6: players, review and journals

Use **Players & accounts → Invite player** to let a player choose an available character. The GM desk setting **Require GM approval for character selection** sends selections to **Review queue** before granting editing access; existing assignments are retained. **View as player** is a read-only preview that excludes the player's private notes. **My settings** controls display name, preferred inventory, row spacing and use confirmations.

Drag an item's grip onto a character to open a quantity and ownership confirmation, or use **View item → Hand over / trade**. Handing over to carry preserves legal ownership; giving/allocating changes it. Players' offers await acceptance, and party claims need GM approval. **Party Loot** lists party-owned gear wherever it is carried or stored. Weight counts against the physical carrier. Existing carried Party Loot without a carrier must be assigned to a real character before Foundry sync.

**(!)** means an item has no approved source/custom status, or its approved public details differ. Choose a source/variant or propose a custom item; player proposals go to the GM review queue. Nothing is automatically trusted from a name match. Public weight updates on approval; estimated price remains independently editable. Actual value stays GM-only unless explicitly revealed. Source descriptions and links are shared only with explicit GM approval. Full rules remain on the linked source page.

**View item** shows known details and personal item notes. GM item configuration chooses whether **Use item** spends charges or quantity; unknown modes are disabled. **Journal & sessions** provides personal notes with optional links to items, characters, locations and GM-created sessions. Every note is private to its author by default, including from GM accounts through the app; sharing is per note. The PC/database owner can access the underlying database, so this is application privacy, not end-to-end encryption. Shared notes are visible to signed-in campaign members.

**Change log** shows GM activity with before/after inventory changes. Personal note events record activity/sharing metadata, never note text. Portable inventory JSON excludes personal notes, accounts and settings. Back up the complete SQLite data directory to preserve these. Existing items, IDs, wallets, grants and accounts migrate in place.

## Character hub and live map HP (0.7)

Open **Character sheets**, select an assigned character and choose **Import from PCGen**. Both saved **.pcg v2** files and **OpenRPG / 3eProfiler XML exports** are supported. Review the character and confirm before saving. XML gives calculated values; PCG build scores/ranks are labelled and unknown derived totals remain blank. PCG files rely on PCGen rule datasets for final calculations; the website does not run those datasets. Use an XML export or enter verified totals. Unsupported or malformed files are rejected.

The hub provides Combat, Skills, Spells, Features, Equipment and Details sections. **Update HP & play status** tracks current HP, temporary HP, conditions and named counters for spell slots or class abilities. **Use 1** spends a counter use. These are manual trackers; conditions do not recalculate rules. **Sheet totals** provides explicit verified overrides.

A re-import replaces the build snapshot but retains current play status and verified totals. Review those after levelling up. Missing current HP can initialise from a newly imported known HP value. Imported equipment is reference-only; it never overwrites the live loot ledger. Sheets are visible only to assigned accounts and GM accounts. Personal journal privacy is unchanged. Character snapshots/play state are included in the GM portable private inventory backup and full database backup. The per-character download is a sheet-only JSON snapshot.

For map HP, update the Foundry module to **0.7.0**, select the website connection and map character owners to actors. Open **Inventory · Sheets Sync → Review website HP feed**, check the actor/token list, then choose **Apply & start live HP feed**. The active GM browser checks every five seconds. Keep that browser, the website server and its HTTPS connection running. The first active GM by ID drives automatic updates; use one GM browser tab.

The feed sends current and temporary HP only. Foundry's maximum stays calculated from the actor; mismatches are shown during review. Linked tokens follow actor HP. Unlinked copies across scenes are listed and updated separately. Configure each token's resource **Bar 1 → attributes.hp** and its usual display visibility to show the bar on the map. Maximum HP, conditions, spells and other statistics are not pushed by this feed.

Native HP edits, new unlinked tokens, remapping or failed connection checks pause the feed for review instead of overwriting an in-game change. Use **Review website HP feed** to resume or **Stop live HP feed** to stop. Reopening the GM browser resumes an enabled feed only if its saved baseline still matches Foundry. Full live Foundry integration must be checked on a test world; automated actor/token tests cover mapping, stale writes, conflict pauses and rollback.

## Wayfinder’s Rest hub (0.8)

Players land on their last-used active character sheet after sign-in. Sheet, Inventory, Journal and Memorials keep the campaign together. The Appearance selector works on the login page and throughout the hub: System, Light, Charcoal Dark or OLED Dark. System uses Charcoal for a dark device setting. OLED uses true-black surfaces. Light shows a doused woodland fire and smoke; both dark themes show a glowing night fire. An explicit login-page choice is saved to the account after sign-in.

**Games** lets existing GMs create games. Accounts are shared, but roles, memberships, characters, notes, loot, approvals, exports and connections belong to the selected game. A person can be GM in one game and a player in another. Existing account credentials and campaign records migrate into the first game. The SQLite file stores global identities and explicitly separated game tables; never share the database file. Switching games rotates the session’s CSRF protection and clears player preview. Existing users join another game using its invitation and their existing account name/password.

GM **Create character** supports an assigned blank sheet or a PCGen import, with an explicit initial approval. An unassigned character can be offered through an invitation. **Edit build** includes basic stats, skills, attacks, feats, languages and spell text. Player imports, manual build edits, verified totals and resource definitions go to Review queue. Accepted builds stay in play until approved; ordinary HP, temporary HP and resource spending remain immediate and logged. Re-importing or changing build content requires fresh approval. Missing references are never treated as verified simply because a name matches; the GM explicitly approves custom content as part of the review. Source references must use HTTPS d20PFSRD URLs; a reference is a GM-reviewed citation, not an automated rules validation. New player-created inventory items also enter review. Existing builds receive a baseline-review flag without interrupting play.

**Mark deceased** asks for a cause of death, optional last words/session and a separate typed-name confirmation. Player editing stops; pending trades/builds close; HP feed excludes the character. Belongings remain for GM distribution. This never deletes or automatically marks an actor/token in Foundry. **Memorials** is visible within the game and lets everyone add remembrances. Only assigned accounts/GMs can open the full memorial sheet. Private journal notes remain private. GMs can add NPC-attributed recollections, amend death records, moderate tributes and restore a character. Restoration does not duplicate distributed items or reopen cancelled actions. Re-review the HP feed after death/restoration before resuming it.

Choose **Create game → This is a test game** for a persistent fictional test player. It uses the ordinary invitation, signup, PCGen parsing, build proposal and GM approval paths. No Foundry connection is configured. In that game, **Games → Test player sign-in** provides a private, one-use password-setup link valid for one hour. Open it in a separate browser profile and set the password yourself. Never commit or share this link. The generated account is available in Players & accounts for read-only preview too.

Before upgrading from 0.7, stop the old server and back up the entire data directory. Start 0.8 against the same SQLite file; do not run the old server afterward because the migrated tables have new game scopes. Rollback requires restoring the entire pre-upgrade backup with the old server stopped. Portable private backups restore into a new empty game and include character lifecycle/memorial records; they do not replace global accounts, membership history, personal notes or account theme settings. A complete database backup preserves all of those. Never combine backups from unrelated game directories manually.

## Session checklist (0.9)

Open **Session checklist** in the sidebar before playing. It shows required progress, optional checks, what needs attention and links to the relevant hub page. Automatic checks cannot be ticked manually. Manual checks are your confirmations, not an automatic test of a microphone, internet access, Foundry map or live HP feed. The checklist guides preparation; it never blocks normal hub access.

Choose a campaign session and, for players, an active assigned character. The default is the nearest upcoming dated session, falling back to the latest created session; without sessions it shows General setup. Confirmations are separate for each game, account, session and character. A new session starts with fresh manual checks. Confirmations persist across sign-ins and server restarts in the full SQLite backup; they are not included in portable inventory-only backups.

Player checks include assignment, accepted sheet/build, verified/current HP, item approvals, equipment/charges/coins and session preparation. Foundry and voice steps appear when the GM enables them. GM checks include player assignments, sheet reviews, pending approvals, loot carriers, backups, the public link and session preparation. **Game requirements** controls whether Foundry, voice chat and inventory review are required for checklist readiness; it does not change game permissions or approval rules.

The GM overview shows each player’s active characters and incomplete check titles. It contains no private note content. Shared login accounts retain separate progress in each game. A recent Foundry contact means the configured bridge was reached successfully within fifteen minutes; it does not prove the HP feed is enabled. Use Foundry’s reviewed feed controls to test that separately. Changing the public origin, secret or configured Foundry origins invalidates the corresponding hosting/mapping confirmations.
