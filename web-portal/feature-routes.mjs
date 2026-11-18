import {fail,hash,secret} from './store.mjs';
let activeLookups=0;
export function createInvitation(ledger,user,data){ledger.gm(user);if(!Array.isArray(data.owners)||data.owners.length>50||data.owners.some(n=>!ledger.owners().includes(n)))fail('Choose valid character options.');const token=secret(),choices=[...new Set(data.owners)].filter(n=>n!=='Party Loot'&&ledger.characterMeta(n)?.status!=='deceased');ledger.transaction(()=>{ledger.db.prepare('INSERT INTO invites VALUES (?,?,?)').run(hash(token),JSON.stringify(choices),Date.now()+7*86400000);ledger.db.prepare('INSERT INTO invite_choices VALUES (?,?)').run(hash(token),JSON.stringify({selfSelect:data.selfSelect!==false,choices}));ledger.audit(user.id,'created player invitation',{choices,selfSelect:data.selfSelect!==false});});return token;}

export function featureGet({route,ledger,user,effective,preview,json}){
  if(route==='/api/activity'){ledger.gm(effective);json({events:ledger.activity()});return true;}
  if(route==='/api/my-notes'){if(preview)fail('Private notes are omitted from previews.',403);json({notes:ledger.visibleNotes(user).filter(n=>n.author===user.id)});return true;}
  return false;
}
export async function featurePost({route,data,ledger,user,json,lookupService,limit}){
  if(route==='/api/character-sheet'){json({ok:true,sheet:ledger.saveCharacter(user,data)});return true;}
  if(route==='/api/preferences'){ledger.savePreferences(user,data);json({ok:true});return true;}
  if(route==='/api/note'){const note=ledger.saveNote(user,data);json({ok:true,id:note.id});return true;}
  if(route==='/api/game-session'){const session=ledger.addGameSession(user,data);json({ok:true,session});return true;}
  if(route==='/api/use'){ledger.useItem(user,data.id,data.amount,data.version);json({ok:true});return true;}
  if(route==='/api/item-details'){ledger.configureItem(user,data.id,data.changes,data.version);json({ok:true});return true;}
  if(route==='/api/custom'){const review=ledger.proposeCustom(user,data);json({ok:true,reviewId:review.id});return true;}
  if(route==='/api/review'){const review=ledger.approveReview(user,data.id,data);json({ok:true,review});return true;}
  if(route==='/api/gm-settings'){ledger.gm(user);const before=ledger.get('requireCharacterApproval')==='true';ledger.set('requireCharacterApproval',data.requireCharacterApproval===true?'true':'false');ledger.audit(user.id,'GM setting changed',{before:{requireCharacterApproval:before},after:{requireCharacterApproval:data.requireCharacterApproval===true}});json({ok:true});return true;}
  if(route==='/api/invite'){const token=createInvitation(ledger,user,data);json({url:data._origin+'/#invite='+token});return true;}
  if(route==='/api/user'){
    ledger.gm(user);const target=ledger.db.prepare('SELECT id,username,role,disabled FROM users WHERE id=?').get(data.id);if(!target||target.role!=='player')fail('Choose a player account.');if(!Array.isArray(data.owners)||data.owners.some(n=>!ledger.owners().includes(n)))fail('Unknown inventory.');const before={owners:ledger.grantOwners(target),disabled:!!target.disabled};ledger.transaction(()=>{ledger.db.prepare('DELETE FROM grants WHERE user_id=?').run(target.id);for(const owner of new Set(data.owners))ledger.db.prepare('INSERT INTO grants VALUES (?,?)').run(target.id,owner);ledger.db.prepare('UPDATE users SET disabled=? WHERE id=?').run(data.disabled===true?1:0,target.id);ledger.db.prepare('DELETE FROM sessions WHERE user_id=? AND game_id=?').run(target.id,ledger.gameId);ledger.audit(user.id,'player access changed',{account:target.username,before,after:{owners:data.owners,disabled:data.disabled===true}});});json({ok:true});return true;
  }
  if(['/api/lookup/apply','/api/lookup/propose'].includes(route)){
    limit('lookup:'+user.id,30);if(activeLookups>=4)fail('Another lookup is running. Try again shortly.',429);activeLookups++;
    try{const result=await lookupService.read(data.url,data.name);const review=ledger.proposeMatch(user,data,result);json({ok:true,pending:user.role!=='gm',reviewId:review.id});}finally{activeLookups--;}return true;
  }
  return false;
}
