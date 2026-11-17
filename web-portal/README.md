# Party Ledger — inventory outside Foundry

A local server for your party's inventories. Players can use their browsers while Foundry is closed. Node.js 24 or newer is required; no npm packages or Google deployment are needed for the website.

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
