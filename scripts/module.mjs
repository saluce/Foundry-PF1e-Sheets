import {createHealthFeed} from './health.mjs';
import {ID, escapeHTML as e, indexRows, reconcile, resolvePlan, convertLegacy, same} from "./core.mjs";
import {assertGM, mappedActors, snapshot, validateApply, applyRows} from "./foundry.mjs";
import {tradeDialog} from "./trade.mjs";
import {publicState,cleanGMRecord,migratedPrivate} from './privacy.mjs';
import {lookupDialog} from './lookup.mjs';
import {inventoryConnection,sourceStateKey} from './connection.mjs';

let busy = false;
const perWorld = new Set(["baseline","refs","binding","privacySchema","healthBaseline","healthEnabled"]);
const stateKey=()=>sourceStateKey(game.world.id,game.settings.get(ID,'backend'));
const setting = key => {
  const value=game.settings.get(ID,key);
  return perWorld.has(key) ? value[stateKey()] ?? (key === "baseline"?[]:key === "binding"?"":key==='privacySchema'?0:key==='healthEnabled'?false:{}) : value;
};
const save = (key,value) => game.settings.set(ID,key,perWorld.has(key)?{...game.settings.get(ID,key),[stateKey()]:value}:value);
function notifyError(err) { console.error(`${ID} | Operation failed; private payloads are not logged.`); ui.notifications.error(err.message); }
function dialog(title, content, buttons, width = 720) {
  return new Dialog({title,content:`<div class="pf1-sync">${content}</div>`,buttons}, {width,classes:['dialog','pf1-sync-dialog']}).render(true);
}
const root = html => html instanceof HTMLElement ? html : html[0];
async function exclusive(fn) {
  if (busy) throw Error("A sync is already running in this browser.");
  busy = true;
  try { assertGM(); return await fn(); } finally { busy = false; }
}
async function request(action, extra = {}) {
  assertGM();
  const {portal,url,token}=inventoryConnection(setting);
  const response = await fetch(url, {method:"POST", redirect:"follow", credentials:"omit",
    headers:{"Content-Type":"text/plain;charset=utf-8"},
    body:JSON.stringify({action,token,world:game.world.id,...extra}), signal:AbortSignal.timeout(45000)});
  if (!response.ok) throw Error(`Google Sheets returned HTTP ${response.status}.`);
  let data;
  try { data = await response.json(); } catch { throw Error("Google returned a sign-in page instead of data. Check the web-app deployment and Anyone access."); }
  if (!data.ok) {
    if(action.startsWith('lookup')&&data.error==='Unknown action.')throw Error('Update Code.gs to version 0.4 and deploy a new web-app version before using item lookup.');
    throw Error(data.error || "The sheet connection failed.");
  }
  return data;
}

Hooks.once("init", () => {
  game.settings.register(ID,'backend',{name:'Inventory connection type',scope:'client',config:true,type:String,choices:{sheets:'Google Sheets',portal:'Website / home server'},default:'sheets'});
  game.settings.register(ID,'portalEndpoint',{name:'Website connection URL',hint:'Your Party Ledger address ending in /api/bridge.',scope:'client',config:true,type:String,default:''});
  game.settings.register(ID,'portalToken',{name:'Website connection secret (GM browser only)',hint:'Generate this at the website GM desk. Keep it private.',scope:'client',config:true,type:String,default:''});
  game.settings.register(ID,"endpoint", {name:"Google Sheets connection URL",hint:"The /exec URL from the supplied Google Apps Script deployment.",scope:"client",config:true,type:String,default:""});
  game.settings.register(ID,"token", {name:"Connection secret (GM browser only)",hint:"The secret from Apps Script. This is stored in this browser; do not share it with players.",scope:"client",config:true,type:String,default:""});
  for (const key of ["mapping","baseline","refs","binding","privacySchema","healthBaseline","healthEnabled"]) game.settings.register(ID,key,{scope:key === "mapping"?"world":"client",config:false,type:Object,default:{},restricted:true});
});
Hooks.once("ready", () => {
  game.modules.get(ID).api = {open:openPanel};
  if(game.user?.isGM)healthFeed.start();
});
Hooks.on("renderActorDirectory", (_app, html) => {
  if (!game.user?.isGM || game.system.id !== "pf1") return;
  const el = root(html);
  if (el.querySelector(".pf1-sync-button")) return;
  const button = document.createElement("button"); button.className = "pf1-sync-button";
  button.textContent = "Inventory · Sheets Sync"; button.addEventListener("click",openPanel);
  (el.querySelector(".directory-footer") ?? el).append(button);
});

function openPanel() {
  try { assertGM(); } catch(err) { notifyError(err); return; }
  dialog("Inventory · Sheets Sync", `<p>Sync selected character and loot actors with your party sheet.</p>
    <p>Preview changes before applying them. Removing sheet rows never deletes in-game items. Foundry trades, splits and spent items update the sheet after review.</p>
    <p>New sheet items become basic loot entries. Existing items keep their Pathfinder rules and actions.</p>`, {
    mapping:{label:"Choose owners / actors",callback:()=>chooseMapping().catch(notifyError)},
    health:{label:"Review website HP feed",callback:()=>{if(setting('backend')!=='portal')return ui.notifications.warn('HP feed requires the website connection.');healthFeed.preview();}},
    stopHealth:{label:"Stop live HP feed",callback:()=>healthFeed.stop().catch(notifyError)},
    sync:{label:"Preview sync",callback:()=>exclusive(preview).catch(notifyError)},
    trade:{label:"Distribute loot",callback:()=>readSheet().then(s=>tradeDialog(exclusive,s.locations,prepareTransfer)).catch(notifyError)},
    secrets:{label:'GM item details / reveal',callback:()=>chooseGMItem().catch(notifyError)},
    lookup:{label:'Look up item (d20PFSRD)',callback:()=>launchLookup().catch(notifyError)},
    missing:{label:'Check missing weights / values',callback:()=>launchLookup(true).catch(notifyError)},
    locations:{label:"Manage locations (GM)",callback:()=>manageLocations().catch(notifyError)},
    legacy:{label:"Convert old tab (CSV)",callback:()=>legacyDialog()},
    close:{label:"Close"}
  });
}
const openLookup=lookupDialog({readSheet,request,dialog,root,exclusive,notifyError});
async function launchLookup(missing=false){if(setting('backend')==='portal'){const u=new URL(setting('portalEndpoint'));window.open(u.origin+'/','_blank','noopener,noreferrer');ui.notifications.info('Use Look up beside an item on the inventory website.');return;}return openLookup(missing);}
async function readSheet() {
  const data = publicState(await request("read"));
  if (setting('privacySchema')===3 && setting("binding") && setting("binding") !== data.binding) throw Error("This world was paired with another sheet. Restore the original connection.");
  indexRows(data.rows);
  return data;
}
async function prepareTransfer({sourceId,targetId,legacy}) {
  if(legacy)await request('migratePrivate',{records:[legacy]});
  await request('clonePrivate',{sourceId,targetId});
}
async function chooseGMItem(){
  assertGM();const data=await readSheet(),items=data.rows.filter(r=>r.kind==='item');
  if(!items.length)throw Error('Sync or add an item before editing GM details.');
  dialog('Private GM item details',`<p>These records live in the separate private GM workbook. Saving does not reveal them.</p><label>Item<select name="item">${items.map(r=>`<option value="${e(r.id)}">${e(r.owner)} / ${e(r.name)} / ${e(r.storage)}</option>`).join('')}</select></label>`,{
    open:{label:'Open private record',callback:html=>editGMItem(root(html).querySelector('[name=item]').value).catch(notifyError)},cancel:{label:'Cancel'}
  });
}
async function editGMItem(id){
  assertGM();const data=await request('gmRead',{id});const r=data.record;
  const form=`<p>Private GM information. Only checked reveal fields are copied to the player workbook. GM notes always stay private.</p>
    <label>True name<input name="trueName" value="${e(r.trueName)}"></label>
    <label>Actual unit value (gp)<input name="actualValue" type="number" min="0" step="any" value="${e(r.actualValue)}"></label>
    <label>Secret properties<textarea name="secretProperties" rows="4">${e(r.secretProperties)}</textarea></label>
    <label>GM notes<textarea name="gmNotes" rows="6">${e(r.gmNotes)}</textarea></label>
    <p>Reveal to players:</p>${[['name','True name'],['price','Actual value'],['properties','Properties']].map(([key,label])=>`<label><input type="checkbox" name="reveal-${key}"> ${label}</label>`).join('')}
    <p class="hint">Revealed information cannot be made secret again. After revealing, Preview sync updates Foundry.</p>`;
  const saveForm=async(html,reveal)=>{
    const el=root(html),record=cleanGMRecord(Object.fromEntries(['trueName','actualValue','secretProperties','gmNotes'].map(k=>[k,el.querySelector(`[name=${k}]`).value])),id);
    const fields=['name','price','properties'].filter(k=>el.querySelector(`[name=reveal-${k}]`).checked);
    if(reveal&&!fields.length)throw Error('Select at least one field to reveal.');
    const saved=await request('gmSave',{id,record,gmRevision:data.gmRevision});
    if(reveal)await request('reveal',{id,fields,gmRevision:saved.gmRevision,revision:saved.revision});
    ui.notifications.info(reveal?'Selected details revealed in the player sheet. Preview sync to update Foundry.':'Private GM details saved. Nothing was revealed.');
  };
  dialog('GM details — private',form,{save:{label:'Save private details',callback:html=>exclusive(()=>saveForm(html,false)).catch(notifyError)},reveal:{label:'Save and reveal selected',callback:html=>exclusive(()=>saveForm(html,true)).catch(notifyError)},cancel:{label:'Cancel'}},760);
}
async function manageLocations() {
  assertGM();
  const sheet=await readSheet();
  const names=[...new Set([...(sheet.locations ?? ['Carried','Bank']),...sheet.rows.map(r=>r.storage)])];
  dialog('GM storage locations',`<p>One location per line. Carried is reserved for gear and coins on an actor. Add a town bank, chest or stash by name. Move all items and wallet rows out of a location before removing it.</p><label>Locations<textarea name="locations" rows="10">${e(names.join('\n'))}</textarea></label>`,{
    save:{label:'Save locations',callback:html=>exclusive(async()=>{
      const locations=root(html).querySelector('[name=locations]').value.split('\n').map(s=>s.trim()).filter(Boolean);
      const allowed=new Set(['Carried',...locations]);
      if(snapshot(setting('mapping')).rows.some(r=>!allowed.has(r.storage))) throw Error('Move local Foundry inventory and coins out of a location before removing it.');
      await request('locations',{locations});
      ui.notifications.info('Storage locations saved. They are now available in the sheet dropdowns.');
    }).catch(notifyError)},cancel:{label:'Cancel'}
  });
}
async function chooseMapping() {
  const sheet = await readSheet();
  const mapping = setting("mapping");
  const owners = [...new Set([...Object.keys(mapping),...sheet.owners, ...sheet.rows.map(r=>r.owner)])];
  const actors = [...game.actors].filter(a=>a.isOwner).sort((a,b)=>a.name.localeCompare(b.name));
  dialog("Choose inventory owners", `<p>Map each sheet owner to one actor. Use an NPC or loot actor for shared loot and chests.</p>
    <label>Additional owners (one per line)<textarea name="extra" rows="3" placeholder="ExampleHero&#10;Party Loot"></textarea></label>
    ${owners.map((owner,i)=>`<label>${e(owner)}<select name="owner${i}"><option value="">Do not sync</option>${actors.map(a=>`<option value="${e(a.id)}" ${mapping[owner] === a.id ? "selected" : ""}>${e(a.name)}</option>`).join("")}</select></label>`).join("")}`, {
    save:{label:"Save / add owners",callback:async html=>{
      try {
        const el = root(html), next = {};
        owners.forEach((o,i)=>{const id=el.querySelector(`[name=owner${i}]`).value;if(id) next[o]=id;});
        const additions = el.querySelector("[name=extra]").value.split("\n").map(s=>s.trim()).filter(Boolean);
        for(const owner of additions) {
          if (!Object.hasOwn(next,owner)) {
            const matches=actors.filter(a=>a.name===owner);
            next[owner]=matches.length===1?matches[0].id:"";
          }
        }
        // Unmapped additions are saved so the next view can offer an actor selector.
        if(Object.values(next).every(Boolean)) mappedActors(next);
        await save("mapping",next);
        if(additions.length) await chooseMapping(); else ui.notifications.info("Inventory owners saved.");
      } catch(err) {notifyError(err);}
    }}, cancel:{label:"Cancel"}
  });
}

async function preview() {
  const mapping = setting("mapping"); mappedActors(mapping);
  if (!Object.keys(mapping).length) throw Error("Choose owners / actors first.");
  let sheet = await readSheet();
  const base = setting("baseline").map(r=>setting('privacySchema')===3?r:{...r,notes:'',properties:''});
  const selected = sheet.rows.filter(r=>Object.hasOwn(mapping,r.owner));
  if(selected.some(r=>(sheet.unassignedCarriers??[]).includes(r.id)))throw Error('Assign a real carrier to carried party loot on the website before syncing.');
  if(sheet.locations && selected.some(r=>!sheet.locations.includes(r.storage))) throw Error('Use Manage locations to register each storage location first.');
  if(selected.some(r=>r.kind==='wallet'&&['pp','gp','sp','cp'].some(k=>r[k]===null)))throw Error('Fill in the unrecorded coin balances in Wallets before syncing these owners.');
  const beforePrivate=sheet.rows,refs=setting("refs"), local = snapshot(mapping,selected,base,refs);
  const targets=new Set(local.lineages.map(r=>r.targetId));
  const privateRecords=local.rows.filter(r=>r.kind==='item'&&!targets.has(r.id)).map(r=>({id:r.id,owner:r.owner,trueName:r.name,actualValue:r.price,gmNotes:''}));
  await request('migratePrivate',{records:[...privateRecords,...local.legacyNotes]});
  for(const lineage of local.lineages)await request('clonePrivate',lineage);
  sheet=await readSheet();
  if(!same(beforePrivate,sheet.rows))throw Error('The player inventory changed while preparing private records. Preview again.');
  const plan = reconcile(base,local.rows,selected);
  // Owners stay fixed, and carried wallets remain separate from stored ones.
  for (const r of selected.filter(r=>r.kind === "wallet")) {
    const b=base.find(x=>x.id===r.id);
    if(b && r.owner!==b.owner) throw Error("Keep wallet Owner fixed; move money by changing the balances.");
    if(b && ((r.storage === "Carried") !== (b.storage === "Carried"))) throw Error("Keep carried and stored wallets separate. Move coins by changing their balances.");
  }
  const labels = new Map([...base,...plan.rows].map(r=>[r.id,`${r.owner} / ${r.name || r.storage + " coins"}`]));
  const changeHTML = plan.changes.map(c=>`<tr><td>${e(labels.get(c.id))}</td><td>${e(c.field)}</td><td>${e(c.target)}${c.restored?" (restore missing row)":""}</td><td>${e(c.field === "row" && typeof c.value === "object" ? "Add or restore" : c.value)}</td></tr>`).join("");
  const display=v=>v===null?"Removed in Foundry":typeof v === "object"?JSON.stringify(v):v;
  const conflictsHTML = plan.conflicts.map((c,i)=>`<tr><td>${e(labels.get(c.id))}<br>${e(c.field)}</td><td>${e(display(c.foundry))}</td><td>${e(display(c.sheet))}</td><td><select name="conflict${i}"><option value="">Choose…</option><option value="foundry">Keep Foundry</option><option value="sheet">Keep Sheet</option></select></td></tr>`).join("");
  dialog("Review inventory sync", `<p>${plan.changes.length} changes · ${plan.conflicts.length} conflicts. Matching is by stored ID; first sync links unique, identical item names within each owner.</p>
    <div class="scroll"><table><thead><tr><th>Inventory</th><th>Field</th><th>Destination</th><th>New value</th></tr></thead><tbody>${changeHTML || "<tr><td colspan=4>No automatic changes.</td></tr>"}</tbody></table>
    ${conflictsHTML?`<h3>Choose conflicting values</h3><table><thead><tr><th>Inventory / field</th><th>Foundry</th><th>Sheet</th><th>Keep</th></tr></thead><tbody>${conflictsHTML}</tbody></table>`:""}</div>
    <p class="hint">An automatic recovery download contains the mapped actors before any changes. Keep this until you have checked the result.</p>`, {
    apply:{label:"Apply reviewed sync",callback:html=>exclusive(async()=>{
      const choices=plan.conflicts.map((_,i)=>root(html).querySelector(`[name=conflict${i}]`).value);
      const desired=resolvePlan(plan,choices);
      if(sheet.locations && desired.some(r=>!sheet.locations.includes(r.storage))) throw Error('The selected location is not registered. Use Manage locations first.');
      validateApply(desired,mapping,local.links,{allowTransfers:setting('backend')==='portal'});
      indexRows([...sheet.rows.filter(r=>!Object.hasOwn(mapping,r.owner)),...desired]);
      // Any intervening inventory edit invalidates the preview; unrelated actor changes do not.
      if (!same(mapping,setting("mapping")) || !same(local.rows,snapshot(mapping,selected,base,refs).rows)) throw Error("Foundry inventory changed since preview. Preview again.");
      const latest=await readSheet();
      if(latest.locations && desired.some(r=>!latest.locations.includes(r.storage))) throw Error('Locations changed since preview. Preview again.');
      if(latest.revision!==sheet.revision) throw Error("The sheet changed since preview. Preview again.");
      if(!same(local.rows,snapshot(mapping,selected,base,refs).rows)) throw Error("Foundry inventory changed while checking the sheet. Preview again.");
      const backup={version:1,world:game.world.id,created:new Date().toISOString(),baseline:base,sheet,
        actors:mappedActors(mapping).map(({actor})=>actor.toObject())};
      foundry.utils.saveDataToFile(JSON.stringify(backup,null,2),"application/json",`inventory-backup-${Date.now()}.json`);
      await applyRows(desired,mapping,local.links,{privateReady:true,allowTransfers:setting('backend')==='portal',lineages:sheet.lineages,nativeSourceIds:Object.keys(refs)});
      const afterState=snapshot(mapping,desired,desired,refs),after=afterState.rows;
      const untouched=sheet.rows.filter(r=>!Object.hasOwn(mapping,r.owner));
      try {
        await request("commit",{revision:sheet.revision,rows:[...untouched,...after]});
      } catch(err) {
        throw Error(`Foundry was updated but the sheet was not confirmed. Baseline kept unchanged. Check the sheet, then preview again. ${err.message}`);
      }
      await save("baseline",after); await save("binding",sheet.binding);
      await save('privacySchema',3);
      await save("refs",Object.fromEntries([...afterState.links].filter(([,v])=>v.item).map(([id,v])=>[id,`${v.actor.id}:${v.item.id}`])));
      ui.notifications.info("Inventories and sheet synchronised.");
    }).catch(notifyError)}, cancel:{label:"Cancel"}
  }, 960);
}

function legacyDialog() {
  dialog("Convert an old inventory tab", `<p>In your old Google Sheet, open one character tab, then File → Download → CSV. Upload that CSV here. Conversion adds rows to the new sheet; it never edits the original.</p>
    <label>Owner name<input name="owner" placeholder="ExampleHero"></label>
    <label>Old tab CSV<input type="file" name="file" accept=".csv,text/csv"></label>
    <label><input type="checkbox" name="stackValues"> Old Value column is for the whole stack</label>
    <label><input type="checkbox" name="stackWeights"> Old Weight column is for the whole stack</label>
    <p>Uses the screenshot layout: A:F = Item, Qty, Uses, unit value, unit weight, sell flag. BANK + Qty and the carried coin block are detected separately. CSV cannot include cell notes or colour meanings.</p>`, {
    convert:{label:"Preview conversion",callback:html=>exclusive(async()=>{
      const el=root(html),owner=el.querySelector("[name=owner]").value.trim(),file=el.querySelector("[name=file]").files[0];
      if(!owner || !file) throw Error("Enter an owner and select a CSV.");
      const rows=convertLegacy(await file.text(),owner,()=>crypto.randomUUID(),{stackValues:el.querySelector("[name=stackValues]").checked,stackWeights:el.querySelector("[name=stackWeights]").checked});
      const sheet=await readSheet();
      if(sheet.rows.some(r=>r.owner===owner)) throw Error("This owner already has sheet rows. Import into an empty owner to avoid duplicate inventories.");
      dialog("Review converted inventory", `<p>${rows.length} rows for ${e(owner)}. ${rows.filter(r=>r.notes?.includes("Quantity was blank")).length} blank quantities imported as 1 and flagged in Notes. Stack amounts were converted according to your choices.</p>
        <div class="scroll"><table><thead><tr><th>Item / wallet</th><th>Qty / gp</th><th>Storage</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${e(r.name || "Coins")}</td><td>${e(r.quantity ?? r.gp)}</td><td>${e(r.storage)}</td></tr>`).join("")}</tbody></table></div>`, {
        import:{label:"Add to new sheet",callback:()=>exclusive(async()=>{
          await request('migratePrivate',{records:rows.filter(r=>r.kind==='item').map(migratedPrivate)});
          const current=await readSheet();if(!same(current.rows,sheet.rows))throw Error('Inventory changed during import. Preview again.');
          await request("commit",{revision:current.revision,rows:[...sheet.rows,...rows.map(r=>r.kind==='item'?{...r,notes:'',properties:''}:r)]});
          ui.notifications.info("Old inventory converted. Choose its actor, then preview sync.");
        }).catch(notifyError)},cancel:{label:"Cancel"}
      });
    }).catch(notifyError)},cancel:{label:"Cancel"}
  });
}

const healthFeed=createHealthFeed({read:readSheet,request,mapping:()=>setting('mapping'),baseline:()=>setting('healthBaseline'),saveBaseline:value=>save('healthBaseline',value),enabled:()=>setting('backend')==='portal'&&setting('healthEnabled')===true,setEnabled:value=>save('healthEnabled',value),dialog,root,e,notifyError});
