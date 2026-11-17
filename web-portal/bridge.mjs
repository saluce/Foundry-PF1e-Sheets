import {cleanRow,fail} from './store.mjs';

// Compatibility with the module's existing preview/reconcile flow. No Google service is used.
export function bridge(ledger,body){
  const world=String(body.world||'');if(!world||world.length>200)fail('Missing world ID.');if(ledger.get('world')&&ledger.get('world')!==world)fail('Connection belongs to another world.',409);
  const before=ledger.bridgeState();let extra={};
  ledger.transaction(()=>{
    switch(body.action){
      case 'read':break;
      case 'commit':{
        if(body.revision!==before.revision)fail('The website changed. Preview again.',409);
        if(!Array.isArray(body.rows)||body.rows.length>10000)fail('Invalid inventory rows.');const rows=body.rows.map(cleanRow),ids=new Set(),wallets=new Set();
        if(rows.some(r=>r.kind==='item'&&r.owner==='Party Loot'&&r.storage==='Carried'))fail('Assign a real carrier to carried party loot on the website before syncing.',409);
        for(const row of rows){if(ids.has(row.id))fail('Duplicate item ID.');ids.add(row.id);if(!ledger.owners().includes(row.owner)||!ledger.locations().includes(row.storage))fail('Unknown owner or location.');if(row.kind==='wallet'){const key=JSON.stringify([row.owner,row.storage]);if(wallets.has(key))fail('Duplicate wallet.');wallets.add(key);}}
        ledger.audit('Foundry','pre-sync recovery',ledger.exportBundle());
        for(const row of rows){const old=ledger.db.prepare('SELECT body FROM rows WHERE id=?').get(row.id);if(!old||old.body!==JSON.stringify(row)){if(old)ledger.prepareFoundryRow?.(JSON.parse(old.body),row);ledger.putRow(row);ledger.audit('Foundry',old?'synced item change':'synced new item',{id:row.id,before:old?JSON.parse(old.body):null,after:row});}if(row.kind==='item'){const p=ledger.privateRow(row.id);if(p)ledger.putPrivate({...p,owner:row.owner});else ledger.putPrivate({id:row.id,owner:row.owner,trueName:row.name,actualValue:null});}}
        for(const old of ledger.rows())if(!ids.has(old.id)){ledger.audit('Foundry','synced removed item',{id:old.id,before:old,after:null});ledger.db.prepare('DELETE FROM rows WHERE id=?').run(old.id);}
        ledger.bump();ledger.bump(true);break;
      }
      case 'locations':ledger.setLocations({role:'gm',id:'Foundry'},body.locations);break;
      case 'gmRead':{const r=ledger.row(body.id);extra.record=ledger.privateRow(r.id)||{id:r.id,owner:r.owner,trueName:r.name,actualValue:null,gmNotes:'',secretProperties:''};break;}
      case 'gmSave':{
        if(body.gmRevision!==before.gmRevision)fail('GM details changed. Reload this item.',409);const row=ledger.row(body.id);ledger.putPrivate({...ledger.privateRow(row.id),...body.record,id:row.id,owner:row.owner});ledger.putRow(row);ledger.bump(true);extra.record=ledger.privateRow(row.id);break;
      }
      case 'migratePrivate':{
        if(!Array.isArray(body.records)||body.records.length>10000)fail('Invalid private migration.');let changed=false;
        for(const raw of body.records){const id=String(raw.id||'');if(!id||id.length>256)fail('Invalid private record ID.');const p=ledger.privateRow(id);if(!p){ledger.putPrivate(raw);changed=true;}else if(raw.gmNotes&&!p.gmNotes.includes(raw.gmNotes)){ledger.putPrivate({...p,gmNotes:p.gmNotes+(p.gmNotes?'\n':'')+raw.gmNotes});changed=true;}}
        if(changed)ledger.bump(true);break;
      }
      case 'clonePrivate':{
        const p=ledger.privateRow(body.sourceId);if(!p)fail('Preserve the private record before splitting.');const id=String(body.targetId||'');if(!id||id.length>256)fail('Invalid target item ID.');if(!ledger.privateRow(id)){ledger.putPrivate({...p,id});if(ledger.details&&ledger.saveDetails)ledger.saveDetails(id,ledger.details(body.sourceId));ledger.bump(true);}break;
      }
      case 'reveal':{
        if(body.revision!==before.revision||body.gmRevision!==before.gmRevision)fail('The ledger changed. Reload before revealing.',409);ledger.reveal({role:'gm',id:'Foundry'},body.id,body.fields,ledger.row(body.id).version);break;
      }
      default:fail('Use the website for item lookups. This bridge action is not supported.');
    }
    ledger.set('world',world);
  });
  return {ok:true,...ledger.bridgeState(),...extra};
}
