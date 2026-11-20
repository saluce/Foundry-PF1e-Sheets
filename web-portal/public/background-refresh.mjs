// Polling must never navigate, replace a user's draft or apply an out-of-date response.
export function createBackgroundRefresh({snapshot,canApply,read,apply,onUnauthorized}){
 let running=false;
 return {async tick(){if(running||!canApply())return false;const before=snapshot();if(!before.state)return false;running=true;try{const next=await read(),current=snapshot();if(current.state!==before.state||current.page!==before.page||current.selected!==before.selected||!canApply())return false;await apply(next,before);return true;}catch(error){if(error.status===401&&snapshot().state===before.state)onUnauthorized?.();return false;}finally{running=false;}}};
}
export function accessChanged(before,next){return JSON.stringify([before.game?.id,before.user?.id,before.user?.role,before.user?.owners,before.preview,before.campaign?.capabilities])!==JSON.stringify([next.game?.id,next.user?.id,next.user?.role,next.user?.owners,next.preview,next.campaign?.capabilities]);}
export function inventoryChanged(before,next){return JSON.stringify([before.rows,before.itemDetails,before.privateRecords])!==JSON.stringify([next.rows,next.itemDetails,next.privateRecords]);}
export function liveContentChanged(before,next){const select=s=>[s.roster,s.characterSheets,s.news,s.campaign?.play,s.campaign?.carrying,s.campaign?.calendar?.date,s.campaign?.settings?.gmHealth,s.campaign?.combat?{...s.campaign.combat,updatedAt:undefined}:null];return JSON.stringify(select(before))!==JSON.stringify(select(next));}
export function captureView(doc=document,win=window){
 const nodes=[...doc.querySelectorAll('[id],.table-scroll,.party-panel,.workspace')],scrolls=nodes.map((node,index)=>({id:node.id||null,index,left:node.scrollLeft,top:node.scrollTop})).filter(p=>p.left||p.top),details=[...doc.querySelectorAll('details')].map((node,index)=>({index,open:node.open})),active=doc.activeElement;
 const focus=active&&active!==doc.body?{id:active.id||null,action:active.dataset?.action,idValue:active.dataset?.id,owner:active.dataset?.owner}:null;
 return {x:win.scrollX,y:win.scrollY,scrolls,details,focus};
}
export function restoreView(view,doc=document,win=window){
 const nodes=[...doc.querySelectorAll('[id],.table-scroll,.party-panel,.workspace')];
 for(const p of view.scrolls){const node=p.id?doc.getElementById(p.id):nodes[p.index];if(node){node.scrollLeft=p.left;node.scrollTop=p.top;}}
 const details=[...doc.querySelectorAll('details')];for(const p of view.details)if(details[p.index])details[p.index].open=p.open;
 if(view.focus&&(!doc.hasFocus||doc.hasFocus())&&!doc.querySelector('#modal')?.open&&(!doc.activeElement||doc.activeElement===doc.body)){const f=view.focus,node=f.id?doc.getElementById(f.id):[...doc.querySelectorAll('[data-action]')].find(n=>n.dataset.action===f.action&&n.dataset.id===f.idValue&&n.dataset.owner===f.owner);node?.focus({preventScroll:true});}
 win.scrollTo(view.x,view.y);
}
