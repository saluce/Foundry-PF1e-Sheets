import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {Ledger,Problem,fail,hash,secret,text,passwordOK,passwordHash} from './store.mjs';
import {bridge} from './bridge.mjs';
import * as lookup from './lookup-service.mjs';
import {featureGet,featurePost} from './feature-routes.mjs';
const STATIC=fileURLToPath(new URL('./public/',import.meta.url));
const now=()=>Date.now();
const cookieName='party_session';
function number(value){if(value===null||value==='')return null;if(typeof value!=='number'||!Number.isFinite(value)||value<0)fail('Enter a valid non-negative number.');return value;}
export function createPortal({dataDir,dbFile,origin='',lookupService=lookup}={}){
  const directory=dataDir||path.join(process.env.LOCALAPPDATA||process.env.XDG_DATA_HOME||os.homedir(),'PF1PartyLedger');
  const ledger=new Ledger(dbFile||path.join(directory,'ledger.sqlite'));
  let bootstrapToken=ledger.db.prepare('SELECT count(*) n FROM users').get().n?null:secret(),canonical=origin||process.env.PORTAL_ORIGIN||'',activeLookups=0;
  if(canonical){const u=new URL(canonical);if(u.pathname!=='/'||u.search||u.hash||u.username||u.password)throw Error('PORTAL_ORIGIN must be just an origin, for example https://loot.example.com');if(u.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(u.hostname))throw Error('Remote access requires an HTTPS origin.');canonical=u.origin;}
  const rates=new Map();
  function limit(key,max,window=60000){const time=now(),r=rates.get(key);if(r&&r.until>time){if(++r.n>max)fail('Too many attempts. Please wait and try again.',429);}else rates.set(key,{n:1,until:time+window});if(rates.size>5000)for(const [k,v]of rates)if(v.until<time)rates.delete(k);}
  function session(req){const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);if(!token)return null;return ledger.db.prepare('SELECT u.*,s.csrf,s.token AS sessionToken,s.view_as FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.disabled=0').get(hash(token),now());}
  function json(res,value,status=200,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...headers});res.end(JSON.stringify(value));}
  async function body(req){const len=Number(req.headers['content-length']);if(req.headers['content-length']!==undefined&&(!Number.isFinite(len)||len<1||len>3000000))fail('Request is empty or too large.',413);const chunks=[];let bytes=0;for await(const part of req){bytes+=part.length;if(bytes>3000000)fail('Request too large.',413);chunks.push(part);}try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))fail('Invalid request.');return value;}catch(err){if(err instanceof Problem)throw err;fail('Invalid JSON request.');}}
  function login(res,user){const token=secret(),csrf=secret();ledger.db.prepare('DELETE FROM sessions WHERE expires<?').run(now());ledger.db.prepare('INSERT INTO sessions(token,user_id,csrf,expires) VALUES (?,?,?,?)').run(hash(token),user.id,csrf,now()+12*3600000);json(res,{ok:true,user:ledger.publicUser(user),csrf},200,{'Set-Cookie':`${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${canonical.startsWith('https:')?'; Secure':''}`});}
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try{
      const localOrigin=`http://127.0.0.1:${server.address()?.port}`,expected=canonical||localOrigin,host=req.headers.host||'';
      if(![new URL(expected).host,new URL(localOrigin).host,`localhost:${server.address()?.port}`].includes(host))fail('Unexpected host.',403);
      const route=new URL(req.url,localOrigin).pathname;
      if(route==='/api/bridge'){
        const allowed=JSON.parse(ledger.get('origins')),sentOrigin=req.headers.origin;
        if(sentOrigin&&!allowed.includes(sentOrigin))fail('Add this Foundry origin in GM settings before connecting.',403);
        if(sentOrigin){res.setHeader('Access-Control-Allow-Origin',sentOrigin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');}
        if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
        if(req.method!=='POST')fail('Use POST.',405);limit('bridge:'+req.socket.remoteAddress,120);const data=await body(req);
        if(!ledger.get('bridgeHash')||hash(data.token)!==ledger.get('bridgeHash'))fail('Invalid connection secret.',401);
        // Lookup belongs on this website; sync requests never retrieve hidden values for players.
        json(res,bridge(ledger,data));return;
      }
      if(req.method==='GET'&&!route.startsWith('/api/')){
        const files={'/':['index.html','text/html'],'/app.mjs':['app.mjs','text/javascript'],'/features.mjs':['features.mjs','text/javascript'],'/character-ui.mjs':['character-ui.mjs','text/javascript'],'/pcgen.mjs':['pcgen.mjs','text/javascript'],'/style.css':['style.css','text/css'],'/favicon.svg':['favicon.svg','image/svg+xml']};const selected=files[route];if(!selected)fail('Page not found.',404);res.writeHead(200,{'Content-Type':selected[1]+'; charset=utf-8'});res.end(fs.readFileSync(path.join(STATIC,selected[0])));return;
      }
      if(req.method==='GET'&&route==='/api/status'){json(res,{application:'pf1-party-ledger',needsSetup:!!bootstrapToken});return;}
      const user=session(req);
      const preview=user?.role==='gm'&&user.view_as?ledger.db.prepare("SELECT * FROM users WHERE id=? AND role='player'").get(user.view_as):null,effective=preview||user;
      if(req.method==='GET'){
        if(!user)fail('Please sign in.',401);
        if(route==='/api/state'){json(res,{...ledger.publicState(effective,{preview:!!preview}),preview:preview?{username:preview.username,readOnly:true}:null,csrf:user.csrf});return;}
        if(featureGet({route,ledger,user,effective,preview:!!preview,json:value=>json(res,value)}))return;
        if(route==='/api/admin'){ledger.gm(effective);json(res,{users:ledger.db.prepare('SELECT id,username,role,disabled FROM users').all().map(u=>({...u,owners:ledger.grantOwners(u)})),origins:JSON.parse(ledger.get('origins')),bridgeConfigured:!!ledger.get('bridgeHash'),world:ledger.get('world')});return;}
        if(route==='/api/backup'){ledger.gm(effective);json(res,ledger.exportBundle(),200,{'Content-Disposition':'attachment; filename="private-ledger-backup.json"'});return;}
        if(route==='/api/export'){const escape=v=>{let s=String(v??'');if(/^[\s\uFEFF]*[=+@-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};const rows=ledger.rows(),keys=['id','kind','owner','name','quantity','uses','weight','price','storage','notes','properties','pp','gp','sp','cp'];res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="player-inventory.csv"'});res.end([keys,...rows.map(r=>keys.map(k=>r[k]))].map(r=>r.map(escape).join(',')).join('\r\n'));return;}
        fail('Not found.',404);
      }
      if(req.method!=='POST')fail('Use POST.',405);
      if(req.headers.origin!==expected&&!(expected===localOrigin&&req.headers.origin===`http://localhost:${server.address()?.port}`))fail('Open this page from its normal address and try again.',403);
      if(!String(req.headers['content-type']||'').startsWith('application/json'))fail('Use a JSON request.',415);
      const data=await body(req);
      if(route==='/api/invite-info'){limit('invite-info:'+req.socket.remoteAddress,60);json(res,ledger.characterChoices(data.token));return;}
      if(route==='/api/setup'){limit('setup:'+req.socket.remoteAddress,8);if(!bootstrapToken||hash(data.token)!==hash(bootstrapToken))fail('Use the private first-run setup link from this PC.',403);const next=ledger.transaction(()=>ledger.addUser(data.username,data.password,'gm'));bootstrapToken=null;ledger.audit(next.id,'create GM account',{});login(res,next);return;}
      if(route==='/api/login'){limit('login:'+req.socket.remoteAddress,10,300000);const account=ledger.db.prepare('SELECT * FROM users WHERE username=? AND disabled=0').get(String(data.username||'').slice(0,60));const dummy='00000000000000000000000000000000:1336b3d36c9f716c9909dd04361ef799d2f922db9e0b3d171c43323e570fdc19464ba651abca4b9a86617fae0f726e9a1edec1bbf31e04ddb5d4b806348d6bc2f';if(!passwordOK(data.password,account?.password||dummy)||!account)fail('Account name or password is incorrect.',401);login(res,account);return;}
      if(route==='/api/join'){limit('join:'+req.socket.remoteAddress,10,300000);const choices=ledger.characterChoices(data.token),next=ledger.joinInvitation(data.token,data.username,data.password,data.character||(choices.characters.length===1?choices.characters[0]:null));ledger.audit(next.id,'accept invitation',{});login(res,next);return;}
      if(!user)fail('Please sign in.',401);if(req.headers['x-csrf-token']!==user.csrf)fail('Refresh the page before saving.',403);
      if(route==='/api/logout'){ledger.db.prepare('DELETE FROM sessions WHERE token=?').run(user.sessionToken);json(res,{ok:true},200,{'Set-Cookie':`${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${canonical.startsWith('https:')?'; Secure':''}`});return;}
      if(route==='/api/preview'){ledger.gm(user);if(data.userId!==null&&!ledger.db.prepare("SELECT id FROM users WHERE id=? AND role='player'").get(data.userId))fail('Choose a player account.');ledger.db.prepare('UPDATE sessions SET view_as=? WHERE token=?').run(data.userId,user.sessionToken);json(res,{ok:true});return;}
      if(preview)fail('Player preview is read-only. Exit the preview to make changes.',403);
      if(await featurePost({route,data:{...data,_origin:expected},ledger,user,json:value=>json(res,value),lookupService,limit}))return;
      if(route==='/api/password'){if(!passwordOK(data.current,user.password))fail('Current password is incorrect.',403);ledger.db.prepare('UPDATE users SET password=? WHERE id=?').run(passwordHash(data.password),user.id);ledger.db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);login(res,user);return;}
      if(route==='/api/edit'){ledger.edit(user,data.id,data.changes,data.version);}
      else if(route==='/api/private'){ledger.editPrivate(user,data.id,data.changes,data.version);}
      else if(route==='/api/reveal'){ledger.reveal(user,data.id,data.fields,data.version);}
      else if(route==='/api/add'){ledger.addRow(user,data.row);}
      else if(route==='/api/trade'){const trade=ledger.offer(user,data.id,data.recipient,data.quantity,data.storage,data.version,data.claim===true,data.mode||'give');json(res,{ok:true,trade});return;}
      else if(route==='/api/trade/answer'){ledger.answer(user,data.id,data.decision);}
      else if(route==='/api/locations'){ledger.setLocations(user,data.locations);}
      else if(route==='/api/inventory'){ledger.addInventory(user,data.name);}
      else if(route==='/api/invite'){ledger.gm(user);if(!Array.isArray(data.owners)||data.owners.length>50||data.owners.some(n=>!ledger.owners().includes(n)))fail('Choose valid character assignments.');const token=secret();ledger.db.prepare('INSERT INTO invites VALUES (?,?,?)').run(hash(token),JSON.stringify([...new Set(data.owners)]),now()+7*86400000);json(res,{url:expected+'/#invite='+token});return;}
      else if(route==='/api/user'){ledger.gm(user);const target=ledger.db.prepare('SELECT id,role FROM users WHERE id=?').get(data.id);if(!target||target.role==='gm')fail('Choose a player account.');if(!Array.isArray(data.owners)||data.owners.some(n=>!ledger.owners().includes(n)))fail('Unknown inventory.');ledger.transaction(()=>{ledger.db.prepare('DELETE FROM grants WHERE user_id=?').run(target.id);for(const owner of new Set(data.owners))ledger.db.prepare('INSERT INTO grants VALUES (?,?)').run(target.id,owner);ledger.db.prepare('UPDATE users SET disabled=? WHERE id=?').run(data.disabled===true?1:0,target.id);ledger.db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);});}
      else if(route==='/api/connect'){ledger.gm(user);if(!Array.isArray(data.origins)||data.origins.length>20)fail('Enter Foundry browser origins.');const origins=data.origins.map(raw=>{const url=new URL(raw);if(!['http:','https:'].includes(url.protocol)||url.origin!==raw||url.username||url.password)fail('Use an origin only, for example https://foundry.example.com');return url.origin;});ledger.set('origins',JSON.stringify(origins));if(data.rotate===true){const token=secret();ledger.set('bridgeHash',hash(token));json(res,{token,endpoint:expected+'/api/bridge'});return;}json(res,{ok:true,endpoint:expected+'/api/bridge'});return;}
      else if(route==='/api/import'){ledger.gm(user);ledger.importBundle(data.bundle);}
      else if(['/api/lookup/search','/api/lookup/read','/api/lookup/apply'].includes(route)){
        limit('lookup:'+user.id,30);if(activeLookups>=4)fail('Another lookup is running. Try again shortly.',429);activeLookups++;
        try{
          if(route.endsWith('/search')){json(res,{candidates:await lookupService.search(data.query)});return;}
          const result=await lookupService.read(data.url,data.name);
          if(route.endsWith('/read')){json(res,{lookup:result});return;}
          const row=ledger.row(data.id);if(!ledger.canEdit(user,row))fail('You can fill only your assigned characters.',403);ledger.checkVersion(row,data.version);if(data.signature!==result.signature)fail('Source values changed. Review the lookup again.',409);
          if(!['public','private'].includes(data.visibility)||user.role!=='gm'&&data.visibility!=='public')fail('Private prices require a GM.',403);
          const pack=data.packSize;if(!Number.isInteger(pack)||pack<1||pack>100000)fail('Use a whole pack size of 1–100000.');
          const pick=(i,values)=>{if(i===null)return null;if(!Number.isInteger(i)||!values[i])fail('Choose an available source value.');return number(values[i].value)/pack;};const price=pick(data.priceIndex,result.prices),weight=pick(data.weightIndex,result.weights);if(price===null&&weight===null)fail('Select a field to fill.');
          ledger.transaction(()=>{const updated=ledger.row(data.id);ledger.checkVersion(updated,data.version);const changes={};if(weight!==null)changes.weight=weight;if(price!==null&&data.visibility==='public')changes.price=price;if(Object.keys(changes).length)ledger.edit(user,updated.id,changes,updated.version);if(price!==null&&user.role==='gm'){const p=ledger.privateRow(row.id)||{id:row.id,owner:row.owner,trueName:row.name};ledger.putPrivate({...p,actualValue:price,valueRevealed:data.visibility==='public'||p.valueRevealed===true});if(!Object.keys(changes).length)ledger.putRow(row);ledger.bump(true);}ledger.audit(user.id,'confirmed lookup',{id:row.id,url:result.url,title:result.title,price,weight,pack,visibility:data.visibility});});
        }finally{activeLookups--;}
      }
      else fail('Not found.',404);
      json(res,{ok:true});
    }catch(err){if(res.headersSent){res.end();return;}json(res,{ok:false,error:err instanceof Problem?err.message:'The operation could not be completed. Check the values and try again.'},err instanceof Problem?err.status:400);}
  });
  server.requestTimeout=20000;server.headersTimeout=15000;
  return {server,ledger,get bootstrapToken(){return bootstrapToken;},setOrigin(value){canonical=value;},close:()=>new Promise(resolve=>server.close(()=>{ledger.close();resolve();}))};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  const args=process.argv.slice(2),arg=(name,fallback)=>{const i=args.indexOf(name);return i===-1?fallback:args[i+1];};const dataDir=arg('--data',undefined);
  if(args[0]==='import'){const file=args[1];if(!file)throw Error('Supply a private ledger JSON import file.');const p=createPortal({dataDir});console.log(JSON.stringify(p.ledger.importBundle(JSON.parse(fs.readFileSync(file,'utf8')))));p.ledger.close();}
  else{
    const app=createPortal({dataDir}),port=Number(arg('--port',process.env.PORTAL_PORT||'4317')),host=arg('--host','127.0.0.1');if(host!=='127.0.0.1'&&host!=='localhost'&&!process.env.PORTAL_ORIGIN)throw Error('Configure an HTTPS PORTAL_ORIGIN before opening a non-loopback listener.');
    const base=process.env.PORTAL_ORIGIN||`http://127.0.0.1:${port}`,setupFile=path.join(path.dirname(app.ledger.file),'setup-link.txt');
    const open=url=>{if(!args.includes('--open'))return;const command=process.platform==='win32'?['rundll32.exe',['url.dll,FileProtocolHandler',url]]:process.platform==='darwin'?['open',[url]]:['xdg-open',[url]];execFile(...command,{windowsHide:true},()=>{});};
    app.server.listen(port,host,()=>{const url=base+'/' +(app.bootstrapToken?'#setup='+app.bootstrapToken:'');console.log(`Party Ledger ready: ${base}/`);if(app.bootstrapToken){fs.writeFileSync(setupFile,url,{mode:0o600});console.log(`First-run setup link is saved privately in ${setupFile}`);}open(url);});
    app.server.on('error',async err=>{if(err.code==='EADDRINUSE'){try{const r=await fetch(`http://127.0.0.1:${port}/api/status`,{signal:AbortSignal.timeout(2000)}),s=await r.json();if(s.application==='pf1-party-ledger'){console.log('Your ledger is already running.');open(s.needsSetup?fs.readFileSync(setupFile,'utf8'):base+'/');app.ledger.close();return;}}catch{}}console.error('The ledger could not start. Check that its port is available.');app.ledger.close();process.exitCode=1;});
    for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.close().then(()=>process.exit(0)));
  }
}
