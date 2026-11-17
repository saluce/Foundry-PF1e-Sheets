/* v0.3.0 — install ONLY in a private standalone Apps Script project. */
const ITEM_HEADERS=['Sync ID','Item','Qty','Uses','Storage','Player notes','Known value (gp)','Unit weight (lb)','Known properties','Sell','Stack weight (lb)','Stack value (gp)'];
const WALLET_HEADERS=['Sync ID','Owner','Storage','Platinum','Gold','Silver','Copper','Total (gp)'];
const GM_HEADERS=['Sync ID','Owner','True name','Actual value (gp)','Secret properties','GM notes','Name revealed','Value revealed','Properties revealed'];
function setupConnection(){
  if(SpreadsheetApp.getActiveSpreadsheet())throw Error('Use a new private standalone Apps Script project, not a script attached to the player workbook.');
  const p=PropertiesService.getScriptProperties(),id=p.getProperty('PUBLIC_SPREADSHEET_ID');if(!id)throw Error('Set PUBLIC_SPREADSHEET_ID in Project Settings.');
  const pub=SpreadsheetApp.openById(id);
  if(!p.getProperty('GM_SPREADSHEET_ID')){const gm=SpreadsheetApp.create('PF1 Private GM Records'),s=gm.getSheets()[0];s.setName('GMDetails');s.getRange(5,1,1,9).setValues([GM_HEADERS]);p.setProperty('GM_SPREADSHEET_ID',gm.getId());}
  const gm=openGM();readOwners(pub);
  if(!p.getProperty('TOKEN'))p.setProperty('TOKEN',Utilities.getUuid()+Utilities.getUuid());
  if(!p.getProperty('BINDING'))p.setProperty('BINDING',Utilities.getUuid());
  const current=readPublic(pub);setLocations(pub,[...new Set([...locationNames(pub),...current.rows.map(r=>r.storage)])],current.rows);
  protect(pub.getSheetByName('Owners'),'GM owner registry');protect(pub.getSheetByName('Banks'),'Public bank view');
  for(const {sheet}of readOwners(pub))formatPlayerSheet(sheet);
  pub.getSheetByName('Wallets').hideColumns(1);pub.getSheetByName('Owners').hideSheet();pub.getSheetByName('Locations').hideSheet();
  return {player:pub.getUrl(),gm:gm.getUrl(),message:'Copy TOKEN from this private project’s Script properties. Do not share the project with players.'};
}
function assertPrivateWorkbook(id){
  const p=PropertiesService.getScriptProperties();if(!id||id===p.getProperty('PUBLIC_SPREADSHEET_ID'))throw Error('Use a separate private GM workbook.');
  const email=Session.getEffectiveUser().getEmail().toLowerCase();if(!email)throw Error('Cannot verify the GM owner.');
  const allowed=new Set([email,...(p.getProperty('GM_ALLOWED_EMAILS')||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean)]);
  const response=UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id)+'/permissions?fields=permissions(type,emailAddress,role)&supportsAllDrives=true',{headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true});
  if(response.getResponseCode()!==200)throw Error('Cannot verify private GM workbook access.');
  const permissions=JSON.parse(response.getContentText()).permissions;
  if(!Array.isArray(permissions)||!permissions.some(p=>p.role==='owner'&&String(p.emailAddress).toLowerCase()===email))throw Error('The GM workbook must be owned by the deployment account.');
  if(permissions.some(p=>p.type!=='user'||!allowed.has(String(p.emailAddress).toLowerCase())))throw Error('Remove unapproved sharing from the GM workbook before syncing.');
}
function openGM(){const id=PropertiesService.getScriptProperties().getProperty('GM_SPREADSHEET_ID');assertPrivateWorkbook(id);const ss=SpreadsheetApp.openById(id);headers(ss.getSheetByName('GMDetails'),5,GM_HEADERS);return ss;}
function publicBook(){const id=PropertiesService.getScriptProperties().getProperty('PUBLIC_SPREADSHEET_ID');if(!id)throw Error('Set up the private connection first.');return SpreadsheetApp.openById(id);}
function headers(s,row,expected){if(!s||JSON.stringify(s.getRange(row,1,1,expected.length).getValues()[0])!==JSON.stringify(expected))throw Error('Workbook layout does not match version 0.3.');}
function num(v,label,blank,whole){if(v===''||v==null)return blank;if(typeof v==='boolean'||!/^\d+(\.\d+)?$/.test(String(v).trim()))throw Error(label+': enter a non-negative number.');const n=Number(v);if(!Number.isFinite(n)||(whole&&!Number.isInteger(n)))throw Error(label+': invalid number.');return n;}
function bool(v){const x=typeof v==='string'?v.trim().toLowerCase():v;if([true,1,'true','yes','x','1'].includes(x))return true;if([false,0,'false','no','','0',null,undefined].includes(x))return false;throw Error('Invalid checkbox value.');}
function literal(v){return typeof v==='string'&&/^[=+\-@]/.test(v)?"'"+v:v==null?'':v;}
function digest(v){return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(v),Utilities.Charset.UTF_8));}
function cleanRow(r){
  const x={kind:r.kind,id:String(r.id||'').trim(),owner:String(r.owner||'').trim(),storage:String(r.storage||'Carried').trim()};
  if(!['item','wallet'].includes(x.kind)||!x.id||!x.owner)throw Error('Every row needs an ID and owner.');if(x.storage.length>120||/[\u0000-\u001f]/.test(x.storage))throw Error('Invalid storage location.');
  if(x.kind==='wallet')for(const k of ['pp','gp','sp','cp'])x[k]=num(r[k],'Coin balance',null,true);
  else{x.name=String(r.name||'').trim();if(!x.name)throw Error('Item name is required.');x.quantity=num(r.quantity,'Quantity',1,false);for(const k of ['uses','price','weight'])x[k]=num(r[k],k,null,k==='uses');x.sell=bool(r.sell);x.notes=String(r.notes||'');x.properties=String(r.properties||'');}return x;
}
function validateRows(rows){if(!Array.isArray(rows)||rows.length>10000)throw Error('Expected up to 10,000 public rows.');const ids=new Set(),wallets=new Set();return rows.map(r=>{const x=cleanRow(r);if(ids.has(x.id))throw Error('Duplicate item ID.');ids.add(x.id);if(x.kind==='wallet'){const k=JSON.stringify([x.owner,x.storage]);if(wallets.has(k))throw Error('Duplicate owner / location wallet.');wallets.add(k);}return x;});}
function readOwners(ss){
  const s=ss.getSheetByName('Owners');headers(s,5,['Owner','Tab']);const n=Math.max(s.getLastRow()-5,0),values=n?s.getRange(6,1,n,2).getValues():[],owners=new Set(),tabs=new Set();
  return values.filter(r=>r.some(Boolean)).map(r=>{const owner=String(r[0]).trim(),tab=ss.getSheetByName(String(r[1]).trim());if(!owner||!tab||owners.has(owner)||tabs.has(tab.getSheetId()))throw Error('Check the GM owner / tab registry.');owners.add(owner);tabs.add(tab.getSheetId());headers(tab,6,ITEM_HEADERS);return {owner,sheet:tab};});
}
function readPublic(ss){
  const rows=[],raw=[];
  for(const {owner,sheet}of readOwners(ss)){const n=Math.max(sheet.getLastRow()-6,0);if(n>10000)throw Error('Inventory is too large.');const values=n?sheet.getRange(7,1,n,10).getValues():[];
    for(let i=0;i<values.length;i++){const v=values[i];if(v.every(c=>c==='')||(!v[1]&&!v[0]))continue;if(!v[0]){v[0]=Utilities.getUuid();sheet.getRange(i+7,1).setValue(v[0]);}rows.push(cleanRow({kind:'item',id:v[0],owner,name:v[1],quantity:v[2],uses:v[3],storage:v[4],notes:v[5],price:v[6],weight:v[7],properties:v[8],sell:v[9]}));}raw.push([owner,sheet.getSheetId(),values]);}
  const wallet=ss.getSheetByName('Wallets');headers(wallet,5,WALLET_HEADERS);const n=Math.max(wallet.getLastRow()-5,0),values=n?wallet.getRange(6,1,n,7).getValues():[];
  for(let i=0;i<values.length;i++){const v=values[i];if(v.every(c=>c==='')||(!v[1]&&!v[0]))continue;if(!v[0]){v[0]=Utilities.getUuid();wallet.getRange(i+6,1).setValue(v[0]);}rows.push(cleanRow({kind:'wallet',id:v[0],owner:v[1],storage:v[2],pp:v[3],gp:v[4],sp:v[5],cp:v[6]}));}
  raw.push(['Wallets',values],['Locations',locationNames(ss)]);return {rows:validateRows(rows),raw};
}
function cleanGM(r){if(!r||!String(r.id||'').trim())throw Error('Missing private item ID.');return {id:String(r.id),owner:String(r.owner||''),trueName:String(r.trueName||''),actualValue:num(r.actualValue,'Actual value',null,false),secretProperties:String(r.secretProperties||''),gmNotes:String(r.gmNotes||''),nameRevealed:bool(r.nameRevealed),valueRevealed:bool(r.valueRevealed),propertiesRevealed:bool(r.propertiesRevealed)};}
function readPrivate(ss){const s=ss.getSheetByName('GMDetails');headers(s,5,GM_HEADERS);const n=Math.max(s.getLastRow()-5,0),values=n?s.getRange(6,1,n,9).getValues():[],ids=new Set();const rows=values.filter(v=>v[0]).map(v=>{const r=cleanGM({id:v[0],owner:v[1],trueName:v[2],actualValue:v[3],secretProperties:v[4],gmNotes:v[5],nameRevealed:v[6],valueRevealed:v[7],propertiesRevealed:v[8]});if(ids.has(r.id))throw Error('Duplicate private item ID.');ids.add(r.id);return r;});return {rows,revision:digest(values)};}
function writeGrid(s,start,width,values){const n=Math.max(s.getLastRow()-start+1,values.length,1);if(s.getMaxRows()<n+start-1)s.insertRowsAfter(s.getMaxRows(),n+start-1-s.getMaxRows());s.getRange(start,1,n,width).setValues([...values.map(r=>r.map(literal)),...Array.from({length:n-values.length},()=>Array(width).fill(''))]);return n;}
function writePrivate(ss,rows){writeGrid(ss.getSheetByName('GMDetails'),6,9,rows.map(r=>[r.id,r.owner,r.trueName,r.actualValue,r.secretProperties,r.gmNotes,r.nameRevealed,r.valueRevealed,r.propertiesRevealed]));SpreadsheetApp.flush();}
function formatPlayerSheet(s){s.hideColumns(1);s.setFrozenRows(6);s.setColumnWidth(2,340);s.setColumnWidths(3,2,65);s.setColumnWidth(5,155);s.setColumnWidth(6,310);s.setColumnWidths(7,2,140);s.setColumnWidth(9,300);s.getRange(7,2,s.getMaxRows()-6,9).setWrap(true);if(s.getColumnGroupDepth(7)===0)s.getRange('G:L').shiftColumnGroupDepth(1);s.getColumnGroup(7,1).collapse();}
function ensureOwner(ss,owner){if(readOwners(ss).some(x=>x.owner===owner))return;let name=owner.replace(/[\[\]*?:\/\\]/g,' ').trim().slice(0,80)||'Inventory',i=2,base=name;while(ss.getSheetByName(name))name=base+' '+i++;const s=ss.insertSheet(name);s.getRange(2,2).setValue(owner);s.getRange(3,2).setValue('Editable inventory. Expand Details for known values and properties.');s.getRange(6,1,1,12).setValues([ITEM_HEADERS]);s.getRange(6,1,1,12).setBackground('#243B53').setFontColor('#ffffff').setFontWeight('bold');formatPlayerSheet(s);const registry=ss.getSheetByName('Owners');registry.getRange(Math.max(registry.getLastRow()+1,6),1,1,2).setValues([[literal(owner),literal(name)]]);}
function writePublic(ss,rows){
  rows=validateRows(rows);const locations=locationNames(ss);if(rows.some(r=>!locations.includes(r.storage)))throw Error('Ask the GM to register the storage location first.');
  for(const owner of [...new Set(rows.map(r=>r.owner))])ensureOwner(ss,owner);
  for(const {owner,sheet}of readOwners(ss)){const items=rows.filter(r=>r.kind==='item'&&r.owner===owner),n=writeGrid(sheet,7,10,items.map(r=>[r.id,r.name,r.quantity,r.uses,r.storage,r.notes,r.price,r.weight,r.properties,r.sell]));sheet.getRange(7,11,n,2).setFormulas(Array.from({length:n},(_,i)=>{const r=i+7;return [`=IF(B${r}="","",IF(H${r}="","",C${r}*H${r}))`,`=IF(B${r}="","",IF(G${r}="","",C${r}*G${r}))`];}));sheet.getRange(4,11,1,2).setFormulas([[`=SUM(K7:K${n+6})`,`=SUM(L7:L${n+6})`]]);}
  const n=writeGrid(ss.getSheetByName('Wallets'),6,7,rows.filter(r=>r.kind==='wallet').map(r=>[r.id,r.owner,r.storage,r.pp,r.gp,r.sp,r.cp]));ss.getSheetByName('Wallets').getRange(6,8,n,1).setFormulas(Array.from({length:n},(_,i)=>{const r=i+6;return [`=IF(B${r}="","",IF(COUNT(D${r}:G${r})<4,"Check coins",D${r}*10+E${r}+F${r}/10+G${r}/100))`];}));
  const banks=ss.getSheetByName('Banks');if(!banks)throw Error('Missing Banks view.');banks.getRange(5,1,1,6).setValues([['Location','Owner','Item','Qty','Known stack value (gp)','Listed stack weight (lb)']]);writeGrid(banks,6,6,rows.filter(r=>r.kind==='item'&&r.storage!=='Carried').map(r=>[r.storage,r.owner,r.name,r.quantity,r.price===null?null:r.price*r.quantity,r.weight===null?null:r.weight*r.quantity]));SpreadsheetApp.flush();
}
function protect(s,description){const p=s.getProtections(SpreadsheetApp.ProtectionType.SHEET).find(p=>p.getDescription()===description)||s.protect();p.setDescription(description);p.removeEditors(p.getEditors());if(p.canDomainEdit())p.setDomainEdit(false);}
function locationNames(ss){const s=ss.getSheetByName('Locations');if(!s)throw Error('Missing Locations tab.');const n=Math.max(s.getLastRow()-5,0);return [...new Set(['Carried',...(n?s.getRange(6,1,n,1).getValues().flat():[]).map(v=>String(v).trim()).filter(Boolean)])];}
function setLocations(ss,names,rows){
  if(!Array.isArray(names)||names.length>200||names.some(n=>typeof n!=='string'||!n.trim()||n.length>120||/[\u0000-\u001f]/.test(n)))throw Error('Use up to 200 valid location names.');names=[...new Set(['Carried',...names.map(n=>n.trim())])];if(names.length>200)throw Error('Use up to 200 locations.');if(rows.some(r=>!names.includes(r.storage)))throw Error('Move inventory and wallets out of a location before removing it.');
  const s=ss.getSheetByName('Locations');writeGrid(s,6,1,names.map(n=>[n]));protect(s,'GM storage locations');const rule=SpreadsheetApp.newDataValidation().requireValueInRange(s.getRange('A6:A'),true).setAllowInvalid(false).build();for(const {sheet}of readOwners(ss)){sheet.getRange(7,5,sheet.getMaxRows()-6,1).setDataValidation(rule);sheet.hideColumns(1);if(!sheet.getFilter())sheet.getRange(6,1,sheet.getMaxRows()-5,12).createFilter();}ss.getSheetByName('Wallets').getRange(6,3,ss.getSheetByName('Wallets').getMaxRows()-5,1).setDataValidation(rule);
}
function state(pub,gm){const p=readPublic(pub),g=readPrivate(gm);return {schema:3,rows:p.rows,owners:readOwners(pub).map(o=>o.owner),revision:digest([p.raw,g.revision]),gmRevision:g.revision,locations:locationNames(pub),binding:PropertiesService.getScriptProperties().getProperty('BINDING')};}
function saveRecovery(gm,publicRows,privateRows){const s=gm.getSheetByName('_Recovery')||gm.insertSheet('_Recovery');s.clearContents();const rows=[...publicRows.map(r=>['public',JSON.stringify(r)]),...privateRows.map(r=>['private',JSON.stringify(r)])];if(rows.length)s.getRange(1,1,rows.length,2).setValues(rows.map(r=>r.map(literal)));s.hideSheet();}
function doPost(e){let lock;try{
  const body=JSON.parse(e.postData.contents),p=PropertiesService.getScriptProperties();if(!p.getProperty('TOKEN')||body.token!==p.getProperty('TOKEN'))throw Error('Invalid connection secret.');if(typeof body.world!=='string'||!body.world)throw Error('Missing world ID.');lock=LockService.getScriptLock();if(!lock.tryLock(15000))throw Error('Another GM operation is running.');if(p.getProperty('WORLD')&&p.getProperty('WORLD')!==body.world)throw Error('Connection belongs to another world.');
  const gm=openGM(),pub=publicBook(),before=state(pub,gm),privateState=readPrivate(gm),privateRows=privateState.rows;
  if(!['read','commit','locations','gmRead','gmSave','reveal','migratePrivate','clonePrivate'].includes(body.action))throw Error('Unknown action.');let extra={};
  if(body.action==='locations')setLocations(pub,body.locations,before.rows);
  if(body.action==='commit'){if(body.revision!==before.revision)throw Error('Inventory or GM details changed. Preview again.');const rows=validateRows(body.rows);saveRecovery(gm,before.rows,privateRows);try{writePublic(pub,rows);}catch(err){try{writePublic(pub,before.rows);}catch(ignore){}throw Error('Public sheet update failed. Check the GM recovery tab before retrying.');}for(const row of rows.filter(r=>r.kind==='item')){const existing=privateRows.find(g=>g.id===row.id);if(existing)existing.owner=row.owner;else privateRows.push(cleanGM({id:row.id,owner:row.owner,trueName:row.name,actualValue:row.price}));}writePrivate(gm,privateRows);}
  if(body.action==='gmRead'){const row=before.rows.find(r=>r.id===body.id&&r.kind==='item');if(!row)throw Error('Choose a current public item.');extra.record=privateRows.find(r=>r.id===body.id)||cleanGM({id:row.id,owner:row.owner,trueName:row.name,actualValue:row.price});}
  if(body.action==='gmSave'){if(body.gmRevision!==privateState.revision)throw Error('GM details changed. Reload this item.');const row=before.rows.find(r=>r.id===body.id&&r.kind==='item');if(!row)throw Error('Choose a current public item.');const prior=privateRows.find(r=>r.id===row.id),next=cleanGM({...prior,...body.record,id:row.id,owner:row.owner});if(prior)Object.assign(prior,next);else privateRows.push(next);writePrivate(gm,privateRows);extra.record=next;}
  if(body.action==='migratePrivate'){if(!Array.isArray(body.records)||body.records.length>10000)throw Error('Invalid private migration.');for(const raw of body.records){const r=cleanGM(raw),old=privateRows.find(x=>x.id===r.id);if(old){if(r.gmNotes&&!old.gmNotes.includes(r.gmNotes))old.gmNotes+=(old.gmNotes?'\n':'')+r.gmNotes;}else privateRows.push(r);}writePrivate(gm,privateRows);}
  if(body.action==='clonePrivate'){const source=privateRows.find(r=>r.id===body.sourceId);if(!source)throw Error('Sync this item or save its GM details before splitting it.');if(typeof body.targetId!=='string'||!body.targetId||body.targetId.length>256)throw Error('Invalid target item ID.');if(body.sourceId!==body.targetId&&!privateRows.some(r=>r.id===body.targetId)){privateRows.push({...source,id:body.targetId});writePrivate(gm,privateRows);}}
  if(body.action==='reveal'){
    if(body.revision!==before.revision||body.gmRevision!==privateState.revision)throw Error('Inventory or private details changed. Reload before revealing.');if(!Array.isArray(body.fields)||!body.fields.length||body.fields.some(f=>!['name','price','properties'].includes(f)))throw Error('Only name, value or properties can be revealed.');const record=privateRows.find(r=>r.id===body.id),row=before.rows.find(r=>r.id===body.id&&r.kind==='item');if(!record||!row)throw Error('Save the GM record before revealing.');
    if(body.fields.includes('name')){if(!record.trueName.trim())throw Error('Enter a true name first.');row.name=record.trueName.trim();record.nameRevealed=true;}if(body.fields.includes('price')){if(record.actualValue===null)throw Error('Enter an actual value first.');row.price=record.actualValue;record.valueRevealed=true;}if(body.fields.includes('properties')){row.properties=record.secretProperties;record.propertiesRevealed=true;}
    saveRecovery(gm,readPublic(pub).rows,readPrivate(gm).rows);writePublic(pub,before.rows);writePrivate(gm,privateRows);
  }
  p.setProperty('WORLD',body.world);return json({ok:true,...state(pub,gm),...extra});
}catch(err){return json({ok:false,error:err.message});}finally{if(lock)lock.releaseLock();}}
function json(v){return ContentService.createTextOutput(JSON.stringify(v)).setMimeType(ContentService.MimeType.JSON);}
