import {ID, normalize, indexRows, same} from "./core.mjs";

const physical = item => item.isPhysical ?? ["weapon", "equipment", "consumable", "loot", "container"].includes(item.type);
const readFlag = item => item.flags?.[ID] ?? {};
const walletKey = id => "w" + [...id].map(c=>c.codePointAt(0).toString(16).padStart(6,"0")).join("");
export function assertGM() {
  if (!game.user?.isGM) throw Error("Only a GM can synchronise inventories.");
  if (game.system.id !== "pf1" || String(game.version).split(".")[0] !== "13") throw Error("This version requires Pathfinder 1 on Foundry 13.");
}
export function mappedActors(mapping) {
  const ids = new Set();
  return Object.entries(mapping).map(([owner, id]) => {
    const actor = game.actors.get(id);
    if (!actor || !actor.isOwner) throw Error(`Choose an available actor for ${owner}.`);
    if (ids.has(id)) throw Error("Each actor can only be mapped to one owner.");
    ids.add(id);
    return {owner, actor};
  });
}
export function snapshot(mapping, sheetRows = [], baseRows = [], refs = {}) {
  const rows = [], links = new Map(), legacyNotes=[],lineages=[];
  const actors=mappedActors(mapping);
  const claimants=new Map();
  for(const {actor} of actors) for(const item of actor.items) {
    const id=readFlag(item).rowId;
    if(id) { if(!claimants.has(id)) claimants.set(id,[]); claimants.get(id).push({actor,item}); }
  }
  for (const {owner, actor} of actors) {
    const items = [...actor.items].filter(physical);
    for (const item of items) {
      const source = item.toObject(), s = source.system, f = readFlag(source);
      let id = f.rowId || `${actor.id}:${item.id}`;
      // Trade modules may copy flags when splitting a stack. Only one instance
      // keeps the old row ID; the new stack gets its own ID and quantity.
      if(f.rowId && claimants.get(f.rowId)?.length>1) {
        const candidates=claimants.get(f.rowId);
        const original=candidates.find(c=>refs[f.rowId] === `${c.actor.id}:${c.item.id}`)
          ?? candidates.find(c=>baseRows.find(b=>b.id===f.rowId)?.owner === actors.find(a=>a.actor.id===c.actor.id)?.owner)
          ?? candidates[0];
        if(original.item !== item) {id=`${actor.id}:${item.id}`;lineages.push({sourceId:f.rowId,targetId:id});}
      }
      if (!f.rowId && !baseRows.some(r => r.id === id)) {
        const candidates = sheetRows.filter(r => r.kind === "item" && r.owner === owner && r.name === item.name && !baseRows.some(b=>b.id===r.id));
        if (candidates.length && (candidates.length !== 1 || items.filter(i => i.name === item.name).length !== 1)) {
          throw Error(`Ambiguous first match for ${owner} / ${item.name}. Give different items distinct names before first sync.`);
        }
        if (candidates.length === 1) id = candidates[0].id;
      }
      const uses = s.uses?.per ? s.uses.value : f.uses;
      if(f.notes||f.gmNotes||f.trueName||f.secretProperties||f.actualValue!=null)legacyNotes.push({id,owner,trueName:f.trueName??item.name,actualValue:f.actualValue??s.price,secretProperties:f.secretProperties??'',gmNotes:[f.notes,f.gmNotes].filter(Boolean).join('\n')});
      const r = normalize({kind:"item", id, owner, name:item.name, quantity:s.quantity, uses,
        price:f.unknownPrice && s.price === 0 ? null : s.price, weight:f.unknownWeight && s.weight === 0 ? null : s.weight, sell:f.sell ?? false,
        storage:s.carried === false ? f.storage || "Bank" : "Carried", notes:f.publicNotes ?? "",properties:f.publicProperties ?? ""});
      rows.push(r); links.set(id, {actor, item});
    }
    const previous=[...baseRows,...sheetRows].filter(r=>r.kind === "wallet" && r.owner === owner);
    const carried=previous.find(r=>r.storage === "Carried");
    const carriedId=carried?.id ?? `${actor.id}:wallet:Carried`;
    rows.push(normalize({kind:"wallet",id:carriedId,owner,storage:"Carried",...actor.toObject().system.currency}));
    links.set(carriedId,{actor});
    const flags=actor.flags?.[ID] ?? {};
    for(const bank of Object.values(flags.wallets ?? {})) {
      rows.push(normalize({kind:"wallet",id:bank.id,owner,storage:bank.storage,...bank.coins}));
      links.set(bank.id,{actor});
    }
    if(flags.bank && !flags.bankMigrated) {
      const old=previous.find(r=>r.storage === "Bank");
      const id=old?.id ?? `${actor.id}:wallet:Bank`;
      rows.push(normalize({kind:"wallet",id,owner,storage:"Bank",...flags.bank}));
      links.set(id,{actor});
    }
  }
  indexRows(rows);
  return {rows, links, legacyNotes,lineages};
}
export function validateApply(rows, mapping, links,{allowTransfers=false}={}) {
  const owners = new Set(Object.keys(mapping));
  indexRows(rows);
  for (const r of rows) {
    if (!owners.has(r.owner)) throw Error(`Map an actor for ${r.owner} first.`);
    const link = links.get(r.id);
    if (link && link.actor.id !== mapping[r.owner] && (!allowTransfers||r.kind!=='item')) throw Error(`${r.name || r.owner}: transfer items using Foundry's trade tools, then sync. Editing Owner in the sheet cannot transfer a linked item.`);
  }
}
async function applyBasicRows(rows, mapping, links, {privateReady=false}={}) {
  assertGM(); validateApply(rows, mapping, links);
  if(rows.some(r=>r.kind==='wallet'&&['pp','gp','sp','cp'].some(k=>r[k]===null)))throw Error('Record unknown coin balances before syncing.');
  if(!privateReady && [...links.values()].some(v=>['notes','gmNotes','trueName','actualValue','secretProperties'].some(k=>v.item?.flags?.[ID]?.[k]!=null&&v.item.flags[ID][k]!=='')))throw Error('Save legacy notes in the private GM workbook before updating these items.');
  for (const r of rows) {
    const actor = game.actors.get(mapping[r.owner]);
    if (r.kind === "wallet") {
      const coins = Object.fromEntries(["pp","gp","sp","cp"].map(k => [k, r[k]]));
      const current = r.storage === "Carried" ? actor.toObject().system.currency : actor.flags?.[ID]?.wallets?.[walletKey(r.id)]?.coins;
      if(r.storage !== "Carried") {
        const wallets={...actor.flags?.[ID]?.wallets,[walletKey(r.id)]:{id:r.id,storage:r.storage,coins}};
        await actor.update({[`flags.${ID}.wallets`]:wallets,[`flags.${ID}.bankMigrated`]:true,...(r.storage === "Bank"?{[`flags.${ID}.bank`]:coins}:{})});
        continue;
      }
      if (!same(coins, Object.fromEntries(["pp","gp","sp","cp"].map(k => [k, current?.[k] ?? 0])))) {
        await actor.update(r.storage === "Carried" ? Object.fromEntries(Object.entries(coins).map(([k,v]) => [`system.currency.${k}`,v])) : {[`flags.${ID}.bank`]:coins});
      }
      continue;
    }
    const item = links.get(r.id)?.item;
    const update = {
      name:r.name, "system.quantity":r.quantity, "system.carried":r.storage === "Carried",
      [`flags.${ID}.rowId`]:r.id, [`flags.${ID}.sell`]:r.sell, [`flags.${ID}.publicNotes`]:r.notes,
      [`flags.${ID}.publicProperties`]:r.properties??'',
      [`flags.${ID}.uses`]:r.uses
    };
    update[`flags.${ID}.storage`]=r.storage;
    // Legacy notes are migrated to the private service before this write.
    for(const key of ['notes','gmNotes','trueName','actualValue','secretProperties'])update[`flags.${ID}.-=${key}`]=null;
    for (const field of ["price", "weight"]) {
      if (r[field] !== null) update[`system.${field}`] = r[field];
      update[`flags.${ID}.unknown${field === "price"?"Price":"Weight"}`] = r[field] === null;
    }
    if (item?.toObject().system.uses?.per && r.uses !== null) update["system.uses.value"] = r.uses;
    if (item) {
      // Don't touch actions, descriptions, native containers or other mechanics.
      await actor.updateEmbeddedDocuments("Item", [{_id:item.id, ...update}]);
    } else {
      const system = {quantity:r.quantity, carried:r.storage === "Carried", price:r.price ?? 0, weight:r.weight ?? 0, identified:true};
      const created = await actor.createEmbeddedDocuments("Item", [{name:r.name, type:"loot", img:"icons/svg/item-bag.svg", system,
        flags:{[ID]:{rowId:r.id,sell:r.sell,publicNotes:r.notes,publicProperties:r.properties??'',uses:r.uses,storage:r.storage,unknownPrice:r.price === null,unknownWeight:r.weight === null}}}]);
      links.set(r.id, {actor, item:created[0]});
    }
  }
}

export async function applyRows(rows,mapping,links,options={}){
  if(!options.allowTransfers)return applyBasicRows(rows,mapping,links,options);
  assertGM();validateApply(rows,mapping,links,{allowTransfers:true});
  const originals=new Map([...links].filter(([,v])=>v.item).map(([id,v])=>[id,{...v,data:v.item.toObject()}])),work=new Map(links),ancestry=new Map((options.lineages??[]).map(r=>[r.targetId,r.sourceId]));
  const actorBackups=new Map(Object.values(mapping).map(id=>{const a=game.actors.get(id);return [id,{actor:a,data:a.toObject()}];}));
  const created=[],moves=[],clones=[];
  const standalone=source=>{const d=source.data,physical=['weapon','equipment','consumable','loot','container'].includes(source.item.type),linked=d.system.links&&Object.values(d.system.links).some(v=>Array.isArray(v)?v.length:!!v);if(!physical||source.item.inContainer||linked||[...source.actor.items].some(i=>i.toObject().system.containerId===source.item.id))throw Error('Unpack linked containers and ammunition relationships before syncing website transfers.');};
  for(const r of rows.filter(r=>r.kind==='item')){
    const existing=originals.get(r.id),moving=existing&&existing.actor.id!==mapping[r.owner];
    if(existing&&!moving)continue;
    let source=existing,id=r.id,visited=new Set();
    while(!source&&ancestry.has(id)){if(visited.has(id)||visited.size>50)throw Error('Invalid website stack ancestry.');visited.add(id);id=ancestry.get(id);source=originals.get(id);}
    if(!source){if([...visited,id].some(k=>(options.nativeSourceIds??[]).includes(k)))throw Error('A website transfer source is missing in Foundry. Restore or resolve the original item before syncing.');continue;}
    standalone(source);clones.push({r,source,moving});
  }
  try{
    // Create all recipient copies before reducing or deleting any original stack.
    for(const {r,source,moving}of clones){const actor=game.actors.get(mapping[r.owner]),data=structuredClone(source.data);delete data._id;delete data._stats;data.system.quantity=r.quantity;data.flags??={};data.flags[ID]={...data.flags[ID],rowId:r.id};for(const key of ['notes','gmNotes','trueName','actualValue','secretProperties'])delete data.flags[ID][key];const result=await actor.createEmbeddedDocuments('Item',[data]);if(result.length!==1)throw Error('A recipient could not create its item.');created.push({actor,item:result[0]});work.set(r.id,{actor,item:result[0]});if(moving)moves.push(source);}
    await applyBasicRows(rows,mapping,work,options);
    for(const source of moves)await source.actor.deleteEmbeddedDocuments('Item',[source.item.id]);
    links.clear();for(const [id,value]of work)links.set(id,value);
  }catch(err){
    let restored=true;
    const originalKeys=new Set([...originals.values()].map(v=>v.actor.id+':'+v.item.id)),cleanup=new Map(created.map(v=>[v.actor.id+':'+v.item.id,v]));
    for(const v of work.values())if(v.item&&!originalKeys.has(v.actor.id+':'+v.item.id))cleanup.set(v.actor.id+':'+v.item.id,v);
    for(const v of cleanup.values())try{if(v.actor.items.get(v.item.id))await v.actor.deleteEmbeddedDocuments('Item',[v.item.id]);}catch{restored=false;}
    for(const v of originals.values())try{if(v.actor.items.get(v.item.id))await v.actor.updateEmbeddedDocuments('Item',[v.data],{diff:false,recursive:false});else await v.actor.createEmbeddedDocuments('Item',[v.data],{keepId:true});}catch{restored=false;}
    for(const {actor,data}of actorBackups.values())try{await actor.update({'system.currency':data.system.currency,...(data.flags?.[ID]?{[`flags.${ID}`]:data.flags[ID]}:{[`flags.-=${ID}`]:null})});}catch{restored=false;}
    if(!restored)throw Error('Website sync failed and rollback was incomplete. Restore the pre-sync actor backup before retrying.');
    throw err;
  }
}
