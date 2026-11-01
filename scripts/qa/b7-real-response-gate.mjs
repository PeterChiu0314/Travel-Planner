// A finite gate for an actual HTTP response. No synthetic payload is accepted.
export async function qaDeadline(work,{ms=8000,label='QA phase',onTimeout=()=>{}}={}){
 let timer;try{return await Promise.race([Promise.resolve(work),new Promise((_,reject)=>{timer=setTimeout(()=>{try{onTimeout();}finally{reject(Error(label+' deadline exceeded'));}},ms);})]);}finally{clearTimeout(timer);}
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});return {promise,resolve,reject};};
export async function gateOneRealResponse({page,pattern,match,validate,record=()=>{},fetchMs=6000,holdMs=10000}){
 const captured=deferred(),released=deferred(),settled=deferred();let taken=false,finished=false,reason=null,holdTimer;
 const release=()=>{reason??='deliver';released.resolve();};
 const abort=()=>{reason='cancel';released.resolve();};
 const handler=async route=>{
  if(taken||!match(route.request()))return route.continue();taken=true;record('route-fetch-started');
  try{
   const response=await qaDeadline(route.fetch({timeout:fetchMs,maxRetries:0}),{ms:fetchMs+250,label:'real response fetch',onTimeout:()=>{void route.abort('timedout').catch(()=>{});}});
   await validate(response);record('real-response-captured');captured.resolve({status:response.status()});
   holdTimer=setTimeout(()=>{reason='hold-deadline';released.resolve();record('hold-deadline');},holdMs);
   await released.promise;clearTimeout(holdTimer);
   if(reason==='deliver'){await qaDeadline(route.fulfill({response}),{ms:3000,label:'actual response delivery'});record('actual-response-delivered');}
   else{await qaDeadline(route.abort('aborted'),{ms:2000,label:'held response cancellation'});record('held-response-cancelled');}
  }catch(error){captured.reject(error);record('gate-error');try{await qaDeadline(route.abort('failed'),{ms:1000,label:'gate abort'});}catch{} }
  finally{clearTimeout(holdTimer);finished=true;settled.resolve();}
 };
 await page.route(pattern,handler);
 return {captured:captured.promise,release,abort,get outcome(){return {taken,finished,reason};},async dispose(){
  abort();if(taken&&!finished)await qaDeadline(settled.promise,{ms:4000,label:'route settlement'});
  // Do not wait for unrelated handlers or a reload that depends on this gate.
  await qaDeadline(page.unroute(pattern,handler),{ms:3000,label:'route removal'});
 }};
}
