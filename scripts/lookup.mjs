import {escapeHTML as e} from './core.mjs';

export function lookupDialog({readSheet,request,dialog,root,exclusive,notifyError}){
  return async function openLookup(missingOnly=false){
    const data=await readSheet(),items=data.rows.filter(r=>r.kind==='item'&&(!missingOnly||r.price===null||r.weight===null));
    if(!items.length)throw Error(missingOnly?'No items have missing weights or values.':'Add an inventory item first.');
    dialog('Look up item — d20PFSRD',`<p>Choose an item, then search by its known name or paste a d20PFSRD item URL. Nothing changes until you confirm a result.</p><label>Item<select name="item">${items.map(r=>`<option value="${e(r.id)}">${e(r.owner)} / ${e(r.name)} — ${r.price===null?'price missing':'price '+e(r.price)+' gp'}, ${r.weight===null?'weight missing':e(r.weight)+' lb'}</option>`).join('')}</select></label><label>Search name (optional override)<input name="query" placeholder="Leave blank to use item name"></label><label>Source URL (optional)<input name="url" placeholder="https://www.d20pfsrd.com/…"></label><p>Prices are full purchase prices, not half-price sale values. This lookup does not create PF1 rules or identify items automatically.</p>`,{
      search:{label:'Find matches',callback:html=>exclusive(async()=>{
        const el=root(html),id=el.querySelector('[name=item]').value,item=items.find(r=>r.id===id),query=el.querySelector('[name=query]').value.trim()||item.name,url=el.querySelector('[name=url]').value.trim();
        ui.notifications.info('Looking up d20PFSRD…');
        if(url){const r=await request('lookupRead',{url,name:query});return showResult(item,data,r.lookup);}
        const found=await request('lookupSearch',{query});
        if(!found.candidates?.length)throw Error('No matches found. Try a shorter name or paste the exact d20PFSRD item URL.');
        dialog('Choose a d20PFSRD match',`<p>Select the exact item. Variants, size, enchantments and remaining charges can change its price.</p><select name="match">${found.candidates.map((r,i)=>`<option value="${i}">${e(r.name)}${r.url.includes('3rd-party')?' [third party]':''}</option>`).join('')}</select>`,{
          view:{label:'Review weight / price',callback:h=>exclusive(async()=>{const candidate=found.candidates[Number(root(h).querySelector('[name=match]').value)];const r=await request('lookupRead',{url:candidate.url,name:candidate.name});showResult(item,data,r.lookup);}).catch(notifyError)},cancel:{label:'Cancel'}
        });
      }).catch(notifyError)},cancel:{label:'Cancel'}
    },760);
  };
  function showResult(item,state,result){
    const prices=result.prices??[],weights=result.weights??[];
    const opts=(values,unit)=>values.map((v,i)=>`<option value="${i}">${e(v.value)} ${unit}${v.label?' — '+e(v.label):''}</option>`).join('');
    dialog('Confirm item lookup',`<p><b>${e(item.owner)} / ${e(item.name)}</b></p><p>Source: <a href="${e(result.url)}" target="_blank" rel="noopener noreferrer">${e(result.title)}</a></p>
      <p>Current public price: ${item.price===null?'unknown':e(item.price)+' gp'}; unit weight: ${item.weight===null?'unknown':e(item.weight)+' lb'}.</p>
      <label><input type="checkbox" name="price" ${prices.length?'checked':'disabled'}> Fill price</label>${prices.length?`<select name="priceChoice">${opts(prices,'gp')}</select>`:'<p>No unambiguous numeric price found.</p>'}
      <label>Price visibility<select name="visibility"><option value="private">Private GM actual value (safe default)</option value="public">Public known value — item is identified</option></select></label>
      <label><input type="checkbox" name="weight" ${weights.length?'checked':'disabled'}> Fill public unit weight</label>${weights.length?`<select name="weightChoice">${opts(weights,'lb')}</select>`:'<p>No unambiguous numeric weight found.</p>'}
      <label>Units per listed pack<input type="number" name="packSize" min="1" max="100000" step="1" value="1"></label><p>Use 1 for a single item. For bolts priced/weighed as a pack of 10, use 10 to store individual-bolt values.</p>
      <p>${e(result.warning||'Check size, material, enchantment and bundle quantity before confirming.')} A new/full wand price is not its remaining-charge value. Item name and notes will stay unchanged.</p>`,{
      apply:{label:'Fill selected fields',callback:html=>exclusive(async()=>{const el=root(html),usePrice=el.querySelector('[name=price]').checked,useWeight=el.querySelector('[name=weight]').checked;if(!usePrice&&!useWeight)throw Error('Choose at least one field to fill.');await request('lookupApply',{id:item.id,revision:state.revision,gmRevision:state.gmRevision,url:result.url,name:result.query,signature:result.signature,packSize:Number(el.querySelector('[name=packSize]').value),priceIndex:usePrice?Number(el.querySelector('[name=priceChoice]').value):null,weightIndex:useWeight?Number(el.querySelector('[name=weightChoice]').value):null,visibility:el.querySelector('[name=visibility]').value});ui.notifications.info('Selected lookup fields saved. Preview sync to update Foundry.');}).catch(notifyError)},cancel:{label:'Cancel'}
    },760);
  }
}
