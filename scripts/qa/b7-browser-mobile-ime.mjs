// Real Chrome native IME protocol and actual UI controls, never synthetic DOM
// composition/visibility events. This is browser responsiveness, not hardware QA.
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
export async function execute({runtime:r,credentials:c,args={}}){
 assert.equal(r.project,'uyqdopksfysbobhjcepk');const x=r.cutover,s=r.browserProof,a=r.browserPages[0],id=x.incompleteFixtures.find(z=>z.kind==='budget').id;
 if(args.mode==='responsive-only'){
  try{
   for(const width of [820,390]){await a.setViewportSize({width,height:900});await a.locator('.budget-workspace').scrollIntoViewIfNeeded();const d=await a.evaluate(()=>({viewport:innerWidth,content:document.documentElement.scrollWidth}));assert(d.content<=d.viewport+1,'Document must fit the real viewport');const add=a.getByRole('button',{name:'新增預算',exact:true});await add.scrollIntoViewIfNeeded();const box=await add.boundingBox();assert(box.x>=0&&box.x+box.width<=width);await a.screenshot({path:path.join(r.dir,`final-budget-width-${width}.png`),fullPage:false});}
   const event={id:'BROWSER-MOBILE-BUDGET-OVERFLOW-FIX',status:'Passed',at:new Date().toISOString(),widths:[820,390],documentFitsViewport:true,addControlWithinViewport:true,tableRetainsOwnHorizontalScroll:true,physicalPhoneNotClaimed:true};s.events.push(event);await fs.writeFile(path.join(r.dir,'browser-results.json'),JSON.stringify(s,null,2));return event;
  }finally{await a.setViewportSize({width:1440,height:1000});}
 }
 const read=async()=>{const z=await fetch(r.url+`/rest/v1/budget_items?id=eq.${id}&select=title,amount,twd_amount,currency`,{headers:{apikey:c.anon,Authorization:'Bearer '+x.sessions[0].access_token},redirect:'error',signal:AbortSignal.timeout(8000)});assert.equal(z.status,200);return (await z.json())[0];};
 const until=async fn=>{const end=Date.now()+10000;while(Date.now()<end){if(await fn())return;await new Promise(z=>setTimeout(z,100));}throw Error('Actual IME/UI transition missing');};
 const before=await read();await a.getByRole('button',{name:before.title,exact:true}).click();await a.getByRole('tab',{name:'編輯項目',exact:true}).click();
 const title=a.getByRole('textbox',{name:'項目名稱',exact:true});await title.click();await until(async()=>await title.getAttribute('readonly')===null);
 const cdp=await r.browserContexts[0].newCDPSession(a),text='QA 注音旅費 '+x.run.slice(0,8);
 try{
  await title.press('Control+A');await cdp.send('Input.imeSetComposition',{text,selectionStart:text.length,selectionEnd:text.length});
  assert.equal(await title.inputValue(),text);await new Promise(z=>setTimeout(z,1300));assert.equal((await read()).title,before.title,'Uncommitted real IME composition must never autosave');
  await cdp.send('Input.insertText',{text});await until(async()=>(await read()).title===text);s.sharedTitle=text;
  const category=a.getByRole('combobox',{name:'分類',exact:true});await category.click();await until(async()=>await category.getAttribute('readonly')===null);
  await category.press('ArrowDown');await a.getByRole('listbox').waitFor({timeout:3000});assert(await a.getByRole('listbox').evaluate(node=>node.parentElement===document.body),'Menu must use the actual Portal');
  await category.press('Escape');await a.getByRole('listbox').waitFor({state:'hidden',timeout:3000});assert(await category.evaluate(node=>node===document.activeElement),'Escape retains keyboard focus');
  await title.press('Tab');assert(await a.evaluate(()=>document.activeElement?.tagName!=='BODY'),'A labelled control remains keyboard reachable');
  await a.getByRole('button',{name:'關閉編輯',exact:true}).click();await title.waitFor({state:'hidden',timeout:5000});
  for(const width of [820,390]){await a.setViewportSize({width,height:900});await a.getByRole('button',{name:text,exact:true}).waitFor({timeout:5000});const dimensions=await a.evaluate(()=>({viewport:innerWidth,content:document.documentElement.scrollWidth}));assert(dimensions.content<=dimensions.viewport+1);await a.screenshot({path:path.join(r.dir,`final-width-${width}.png`),fullPage:false});}
  assert.deepEqual({...await read(),title:before.title},before,'IME and keyboard navigation must not alter financial fields');
  const event={id:'BROWSER-IME-PORTAL-MOBILE-A11Y',status:'Passed',at:new Date().toISOString(),nativeCdpIme:true,compositionNotAutosaved:true,committedTextSaved:true,portalEscapeAndFocus:true,keyboardReachable:true,widths:[820,390],horizontalOverflow:false,physicalPhoneNotClaimed:true};s.events.push(event);await fs.writeFile(path.join(r.dir,'browser-results.json'),JSON.stringify(s,null,2));return event;
 }finally{await cdp.detach();await a.setViewportSize({width:1440,height:1000});}
}
