/* PF1 Inventory · Sheets Sync, v0.2.0. Paste into a spreadsheet-bound Apps Script project. */
const ITEM_HEADERS = ['Sync ID','Owner','Item','Qty','Uses','Unit value (gp)','Unit weight (lb)','Sell','Storage','Notes'];
const WALLET_HEADERS = ['Sync ID','Owner','Storage','Platinum','Gold','Silver','Copper'];
const DATA_ROW = 6;

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Inventory Sync')
    .addItem('Set up connection', 'setupConnection')
    .addItem('Import old character tabs', 'importOldTabs')
    .addToUi();
}

function setupConnection() {
  const ui=SpreadsheetApp.getUi(), props=PropertiesService.getScriptProperties();
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  if(!ss.getSheetByName('Locations')) {
    const locations=ss.insertSheet('Locations');
    locations.getRange(2,1).setValue('GM storage locations');
    locations.getRange(5,1).setValue('Location');
    locations.getRange(6,1,2,1).setValues([['Carried'],['Bank']]);
  }
  // Never initialise over an incompatible layout.
  for(const name of ['Inventory','Loot','Wallets']) {
    const sheet=ss.getSheetByName(name);
    if(!sheet) throw Error('Import the supplied workbook template first. Missing tab: '+name);
    assertHeaders(sheet,name==='Wallets'?WALLET_HEADERS:ITEM_HEADERS);
    sheet.hideColumns(1);
    sheet.setFrozenRows(5);
    if(!sheet.getFilter()) sheet.getRange(5,1,sheet.getMaxRows()-4,name==='Wallets'?8:13).createFilter();
  }
  props.setProperty('SPREADSHEET_ID',ss.getId());
  if(!props.getProperty('TOKEN')) props.setProperty('TOKEN',Utilities.getUuid()+Utilities.getUuid());
  if(!props.getProperty('BINDING')) props.setProperty('BINDING',Utilities.getUuid());
  if(!props.getProperty('LOOT_OWNERS')) props.setProperty('LOOT_OWNERS','Party Loot');
  const state=readState(ss);
  setLocations(ss,[...new Set([...locationNames(ss),...state.rows.map(r=>r.storage)])],state.rows);
  const locations=ss.getSheetByName('Locations');
  const protection=locations.getProtections(SpreadsheetApp.ProtectionType.SHEET).find(p=>p.getDescription()==='GM storage locations')||locations.protect();
  protection.setDescription('GM storage locations');
  protection.removeEditors(protection.getEditors());
  if(protection.canDomainEdit())protection.setDomainEdit(false);
  ui.alert('Connection secret',props.getProperty('TOKEN')+'\n\nCopy this into the Foundry module settings. Keep it private. Then deploy this script as a web app, executing as you, with access set to Anyone.\n\nLoot owners: Party Loot. To add more chest / loot owners, edit LOOT_OWNERS in Project Settings → Script properties (comma-separated).',ui.ButtonSet.OK);
}

function assertHeaders(sheet,headers) {
  const got=sheet.getRange(5,1,1,headers.length).getValues()[0];
  if(JSON.stringify(got)!==JSON.stringify(headers)) throw Error(sheet.getName()+': row 5 headers do not match the template.');
}
function numberValue(v,label,blank,whole) {
  if(v==='' || v==null) return blank;
  if(typeof v==='boolean' || !/^\d+(\.\d+)?$/.test(String(v).trim())) throw Error(label+': enter a non-negative number.');
  const n=Number(v);
  if(!Number.isFinite(n) || (whole && !Number.isInteger(n))) throw Error(label+': invalid number.');
  return n;
}
function booleanValue(v) {
  const value=typeof v==='string'?v.toLowerCase().trim():v;
  if([true,1,'1','true','yes','x'].includes(value)) return true;
  if([false,0,'0','false','no','',null,undefined].includes(value)) return false;
  throw Error('Invalid sell flag: '+v);
}
function cleanRecord(r) {
  const x={kind:r.kind,id:String(r.id||'').trim(),owner:String(r.owner||'').trim(),storage:String(r.storage||'Carried').trim()};
  if(!['item','wallet'].includes(x.kind) || !x.id || !x.owner) throw Error('Every row needs a Sync ID and Owner.');
  if(x.storage.length>120 || /[\u0000-\u001f]/.test(x.storage)) throw Error('Use a location name of at most 120 characters.');
  if(x.kind==='wallet') for(const k of ['pp','gp','sp','cp']) x[k]=numberValue(r[k],k,0,true);
  else {
    x.name=String(r.name||'').trim(); if(!x.name) throw Error('Item name is required.');
    x.quantity=numberValue(r.quantity,x.name+' quantity',1,false);
    for(const k of ['uses','price','weight']) x[k]=numberValue(r[k],x.name+' '+k,null,k==='uses');
    x.sell=booleanValue(r.sell); x.notes=String(r.notes||'');
  }
  return x;
}
function validateRecords(rows) {
  if(!Array.isArray(rows) || rows.length>10000) throw Error('Expected at most 10,000 inventory rows.');
  const ids=new Set(),wallets=new Set();
  return rows.map(r=>{
    const x=cleanRecord(r);
    if(ids.has(x.id)) throw Error('Duplicate Sync ID: '+x.id); ids.add(x.id);
    if(x.kind==='wallet') {
      const k=JSON.stringify([x.owner,x.storage]);
      if(wallets.has(k)) throw Error('Duplicate wallet: '+x.owner+' / '+x.storage); wallets.add(k);
    }
    return x;
  });
}
function workbook() {
  const id=PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if(!id) throw Error('Run Set up connection from the spreadsheet menu first.');
  return SpreadsheetApp.openById(id);
}
function readState(ss) {
  const rows=[],raw=[];
  for(const name of ['Inventory','Loot','Wallets']) {
    const sheet=ss.getSheetByName(name),wallet=name==='Wallets',headers=wallet?WALLET_HEADERS:ITEM_HEADERS;
    if(!sheet) throw Error('Missing '+name+' tab.'); assertHeaders(sheet,headers);
    const count=Math.max(0,sheet.getLastRow()-DATA_ROW+1);
    const values=count?sheet.getRange(DATA_ROW,1,count,headers.length).getValues():[];
    raw.push([name,values]);
    for(let i=0;i<values.length;i++) {
      const v=values[i];
      // Reserved template rows and genuinely empty rows are ignored.
      if(v.every(c=>c==='')) continue;
      if(!v[wallet?1:2] && !v[0]) continue;
      if(!v[0]) {
        v[0]=Utilities.getUuid(); sheet.getRange(DATA_ROW+i,1).setValue(v[0]);
      }
      rows.push(cleanRecord(wallet?{kind:'wallet',id:v[0],owner:v[1],storage:v[2],pp:v[3],gp:v[4],sp:v[5],cp:v[6]}
        :{kind:'item',id:v[0],owner:v[1],name:v[2],quantity:v[3],uses:v[4],price:v[5],weight:v[6],sell:v[7],storage:v[8],notes:v[9]}));
    }
  }
  const hash=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(raw),Utilities.Charset.UTF_8);
  return {rows:validateRecords(rows),revision:Utilities.base64EncodeWebSafe(hash)};
}
function literal(v) {
  // All external text must remain text, never a spreadsheet formula.
  return typeof v==='string' && /^[=+\-@]/.test(v)?"'"+v:v;
}
function locationNames(ss) {
  const sheet=ss.getSheetByName('Locations');
  if(!sheet) return ['Carried','Bank'];
  const n=Math.max(sheet.getLastRow()-5,0);
  return [...new Set(['Carried',...(n?sheet.getRange(6,1,n,1).getValues().flat():[]).map(v=>String(v).trim()).filter(Boolean)])];
}
function setLocations(ss,names,rows) {
  if(!Array.isArray(names) || names.length>200 || names.some(n=>typeof n!=='string' || !n.trim() || n.trim().length>120 || /[\u0000-\u001f]/.test(n))) throw Error('Provide up to 200 non-empty location names, at most 120 characters each.');
  names=[...new Set(['Carried',...names.map(n=>n.trim())])];
  if(names.length>200)throw Error('Use at most 200 locations including Carried.');
  const inUse=rows.filter(r=>!names.includes(r.storage));
  if(inUse.length) throw Error('Move inventory and wallet rows out of '+[...new Set(inUse.map(r=>r.storage))].join(', ')+' before removing that location.');
  const sheet=ss.getSheetByName('Locations')||ss.insertSheet('Locations');
  const n=Math.max(sheet.getLastRow()-5,names.length,1);
  if(sheet.getMaxRows()<n+5)sheet.insertRowsAfter(sheet.getMaxRows(),n+5-sheet.getMaxRows());
  sheet.getRange(5,1).setValue('Location');
  sheet.getRange(6,1,n,1).setValues(Array.from({length:n},(_,i)=>[names[i]?literal(names[i]):'']));
  // A full-column list expands automatically when the GM adds locations.
  const rule=SpreadsheetApp.newDataValidation().requireValueInRange(sheet.getRange('A6:A'),true).setAllowInvalid(false).build();
  for(const tab of ['Inventory','Loot','Wallets']) {
    const target=ss.getSheetByName(tab);
    target.getRange(6,tab==='Wallets'?3:9,target.getMaxRows()-5,1).setDataValidation(rule);
  }
  SpreadsheetApp.flush();
  return names;
}
function writeState(ss,rows) {
  rows=validateRecords(rows);
  const locations=locationNames(ss);
  if(ss.getSheetByName('Locations') && rows.some(r=>!locations.includes(r.storage))) throw Error('Ask the GM to add the storage location before syncing.');
  const props=PropertiesService.getScriptProperties();
  const lootOwners=new Set((props.getProperty('LOOT_OWNERS')||'Party Loot').split(',').map(v=>v.trim()).filter(Boolean));
  const groups={Inventory:[],Loot:[],Wallets:[]};
  for(const r of rows) {
    const wallet=r.kind==='wallet';
    const vals=wallet?[r.id,r.owner,r.storage,r.pp,r.gp,r.sp,r.cp]
      :[r.id,r.owner,r.name,r.quantity,r.uses,r.price,r.weight,r.sell,r.storage,r.notes];
    groups[wallet?'Wallets':lootOwners.has(r.owner)?'Loot':'Inventory'].push(vals.map(v=>literal(v==null?'':v)));
  }
  // Back up the input cells before writes; keep the last recovery snapshot.
  const recovery={};
  for(const name of Object.keys(groups)) {
    const sheet=ss.getSheetByName(name),width=name==='Wallets'?7:10;
    const count=Math.max(sheet.getLastRow()-5,groups[name].length,1);
    if(sheet.getMaxRows()<count+5) sheet.insertRowsAfter(sheet.getMaxRows(),count+5-sheet.getMaxRows());
    recovery[name]=sheet.getRange(6,1,count,width).getValues();
  }
  const backup=ss.getSheetByName('_Last sync backup')||ss.insertSheet('_Last sync backup');
  backup.clearContents();
  const backupRows=Object.entries(recovery).flatMap(([name,values])=>values.map((v,i)=>[name,i+6,...v]));
  if(backupRows.length) backup.getRange(1,1,backupRows.length,12).setValues(backupRows.map(r=>[...r,...Array(12-r.length).fill('')]).map(r=>r.map(literal)));
  backup.hideSheet();
  try {
    for(const name of Object.keys(groups)) {
      const sheet=ss.getSheetByName(name),width=name==='Wallets'?7:10;
      const count=recovery[name].length,values=groups[name];
      sheet.getRange(6,1,count,width).setValues([...values,...Array.from({length:count-values.length},()=>Array(width).fill(''))]);
      if(name!=='Wallets') {
        sheet.getRange(4,11,1,3).setFormulas([[`=SUM(K6:K${count+5})`,`=SUM(L6:L${count+5})`,`=SUM(M6:M${count+5})`]]);
        sheet.getRange(6,11,count,3).setFormulas(Array.from({length:count},(_,i)=>{
          const r=i+6;
          return [`=IF(C${r}="","",IF(G${r}="","",D${r}*G${r}))`,`=IF(C${r}="","",IF(F${r}="","",D${r}*F${r}))`,`=IF(C${r}="","",IF(OR(H${r}=TRUE,H${r}="TRUE"),IF(L${r}="","",L${r}/2),0))`];
        }));
      } else {
        sheet.getRange(6,8,count,1).setFormulas(Array.from({length:count},(_,i)=>[`=IF(B${i+6}="","",D${i+6}*10+E${i+6}+F${i+6}/10+G${i+6}/100)`]));
      }
    }
    SpreadsheetApp.flush();
  } catch(err) {
    for(const name of Object.keys(recovery)) ss.getSheetByName(name).getRange(6,1,recovery[name].length,name==='Wallets'?7:10).setValues(recovery[name].map(r=>r.map(literal)));
    throw Error('Sheet write failed; input cells restored. '+err.message);
  }
}
function doPost(e) {
  let lock;
  try {
    const body=JSON.parse(e.postData.contents),props=PropertiesService.getScriptProperties();
    if(!props.getProperty('TOKEN') || body.token!==props.getProperty('TOKEN')) throw Error('Invalid connection secret.');
    if(!body.world || typeof body.world!=='string') throw Error('Missing Foundry world ID.');
    lock=LockService.getScriptLock(); if(!lock.tryLock(15000)) throw Error('Another sync is running. Try again shortly.');
    if(props.getProperty('WORLD') && props.getProperty('WORLD')!==body.world) throw Error('This sheet is paired to a different Foundry world.');
    if(!['read','commit','locations'].includes(body.action)) throw Error('Unknown action.');
    const ss=workbook(),before=readState(ss);
    if(body.action==='locations') setLocations(ss,body.locations,before.rows);
    if(body.action==='commit') {
      if(body.revision!==before.revision) throw Error('The sheet changed since preview. Preview again.');
      writeState(ss,body.rows);
    }
    props.setProperty('WORLD',body.world);
    const state=body.action==='commit'?readState(ss):before;
    return json({ok:true,...state,binding:props.getProperty('BINDING'),locations:locationNames(ss)});
  } catch(err) {return json({ok:false,error:err.message});}
  finally {if(lock) lock.releaseLock();}
}
function json(value) {return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}

function importOldTabs() {
  const ui=SpreadsheetApp.getUi(),answer=ui.prompt('Import old character tabs','Paste the OLD spreadsheet URL or ID. It will only be read.',ui.ButtonSet.OK_CANCEL);
  if(answer.getSelectedButton()!==ui.Button.OK) return;
  const input=answer.getResponseText().trim(),id=(input.match(/\/d\/([\w-]+)/)||[])[1]||input;
  const source=SpreadsheetApp.openById(id),target=workbook();
  if(source.getId()===target.getId()) throw Error('Choose the old spreadsheet, not this template.');
  const valuesAnswer=ui.alert('Old Value column','Does Value contain the total for the WHOLE STACK? Yes converts it to a unit price. No keeps the existing per-item value.',ui.ButtonSet.YES_NO_CANCEL);
  if(valuesAnswer===ui.Button.CANCEL) return;
  const weightsAnswer=ui.alert('Old Weight column','Does Weight contain the weight of the WHOLE STACK? Yes converts it to unit weight. No keeps the existing per-item weight.',ui.ButtonSet.YES_NO_CANCEL);
  if(weightsAnswer===ui.Button.CANCEL) return;
  const additions=[],found=[],skipped=[];
  for(const sheet of source.getSheets()) {
    const range=sheet.getDataRange(),grid=range.getValues(),notes=range.getNotes();
    const header=grid.findIndex(r=>/^item$/i.test(String(r[0]).trim()) && /^qty$/i.test(String(r[1]).trim()));
    if(header<0) {skipped.push(sheet.getName());continue;}
    const owner=sheet.getName(); found.push(owner);
    for(let i=header+1;i<grid.length;i++) {
      const r=grid[i]; if(!String(r[0]).trim()) continue;
      let rowNotes=notes[i].map((n,c)=>n?String(grid[header][c]||'Column '+(c+1))+': '+n:'').filter(Boolean).join('\n');
      const qty=numberValue(r[1],owner+' quantity',1,false);
      if(r[1]==='') rowNotes+=(rowNotes?'\n':'')+'Quantity was blank in the old sheet; imported as 1. Please check.';
      const convert=(value,stack,label)=>{
        const n=numberValue(value,label,null,false);
        if(n===null || !stack) return n;
        if(!qty && n) throw Error(owner+': zero quantity with non-zero '+label);
        return qty?n/qty:0;
      };
      additions.push(cleanRecord({kind:'item',id:Utilities.getUuid(),owner,name:r[0],quantity:qty,uses:r[2],
        price:convert(r[3],valuesAnswer===ui.Button.YES,'value'),weight:convert(r[4],weightsAnswer===ui.Button.YES,'weight'),sell:r[5],storage:'Carried',notes:rowNotes}));
    }
    for(let ri=0;ri<grid.length;ri++) for(let ci=6;ci<grid[ri].length;ci++) {
      if(/^bank$/i.test(String(grid[ri][ci]).trim()) && /^qty$/i.test(String(grid[ri][ci+1]).trim())) {
        for(let j=ri+1;j<grid.length;j++) if(String(grid[j][ci]||'').trim()) additions.push(cleanRecord({kind:'item',id:Utilities.getUuid(),owner,name:grid[j][ci],quantity:grid[j][ci+1],storage:'Bank',notes:notes[j][ci]||''}));
      }
    }
    const wallet={kind:'wallet',id:Utilities.getUuid(),owner,storage:'Carried',pp:0,gp:0,sp:0,cp:0};
    let count=0;
    const coins={platinum:'pp',gold:'gp',silver:'sp',copper:'cp'};
    for(const r of grid) for(let ci=6;ci<r.length;ci++) {
      const coin=coins[String(r[ci]).trim().toLowerCase()];
      if(coin) {wallet[coin]=numberValue(r[ci+1],owner+' '+coin,0,true);count++;}
    }
    if(count) additions.push(cleanRecord(wallet));
  }
  if(!additions.length) {ui.alert('No character tabs with Item / Qty in columns A / B were found.');return;}
  const summary=additions.length+' rows from '+found.join(', ')+'.\nSkipped: '+(skipped.join(', ')||'none')+'\n\n'+additions.filter(r=>r.notes && r.notes.includes('Quantity was blank')).length+' blank quantities imported as 1 and flagged in Notes. Stack amounts converted according to your choices. Colours and formulas are not copied. Item cell notes are copied into Notes.\n\nAdd to this template?';
  if(ui.alert('Review import',summary,ui.ButtonSet.YES_NO)!==ui.Button.YES) return;
  const lock=LockService.getScriptLock();lock.waitLock(15000);
  try {
    const current=readState(target);
    if(current.rows.some(r=>found.includes(r.owner))) throw Error('One of these owners already has rows. Import into an empty owner to prevent duplicates.');
    writeState(target,[...current.rows,...additions]);
    ui.alert('Imported. Review the new Inventory and Wallets tabs, then map owners in Foundry.');
  } finally {lock.releaseLock();}
}
