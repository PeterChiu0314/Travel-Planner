// Offline source audit only. Does not connect to or mutate any database.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export function tokens(sql){
 const out=[];let i=0;
 while(i<sql.length){
  const start=i,c=sql[i];
  if(/\s/.test(c)){i++;continue;}
  if(sql.startsWith('--',i)){i=sql.indexOf('\n',i);if(i<0)break;continue;}
  if(sql.startsWith('/*',i)){let depth=1;i+=2;while(i<sql.length&&depth){if(sql.startsWith('/*',i)){depth++;i+=2;}else if(sql.startsWith('*/',i)){depth--;i+=2;}else i++;}if(depth)throw Error('Unclosed comment');continue;}
  if(c==="'"){i++;let value='';let closed=false;while(i<sql.length){if(sql[i]==="'"){if(sql[i+1]==="'"){value+="'";i+=2;continue;}i++;closed=true;break;}value+=sql[i++];}if(!closed)throw Error('Unclosed string');out.push({kind:'string',value,start,end:i});continue;}
  if(c==='$'){const m=sql.slice(i).match(/^\$(?:[a-z_]\w*)?\$/i);if(m){i+=m[0].length;const end=sql.indexOf(m[0],i);if(end<0)throw Error('Unclosed dollar body');out.push({kind:'dollar',value:sql.slice(i,end),start,end:end+m[0].length,bodyStart:i});i=end+m[0].length;continue;}}
  if(/[a-z_]/i.test(c)){i++;while(i<sql.length&&/[a-z_0-9$]/i.test(sql[i]))i++;out.push({kind:'word',value:sql.slice(start,i).toLowerCase(),start,end:i});continue;}
  out.push({kind:'symbol',value:c,start,end:++i});
 }
 return out;
}
export function businessRaises(body){
 const ts=tokens(body),sites=[];
 for(let i=0;i<ts.length;i++){
  let code;
  if(ts[i].value==='errcode'&&ts[i+1]?.value==='='&&ts[i+2]?.kind==='string')code=ts[i+2].value;
  if(ts[i].value==='raise'){
   let next=i+1;if(['debug','log','info','notice','warning','exception'].includes(ts[next]?.value))next++;
   if(ts[next]?.value==='sqlstate'&&ts[next+1]?.kind==='string')code=ts[next+1].value;
   if(ts[next]?.value==='serialization_failure')code='40001';
  }
  if(code!=='40001')continue;
  let j=i;while(j>=0&&ts[j].value!=='raise'&&ts[j].value!==';')j--;
  if(j<0||ts[j].value!=='raise')throw Error('40001 assignment not attached to a reviewed RAISE');
  const message=ts.slice(j,i+3).find(t=>t.kind==='string'&&t.value!=='40001')?.value||'[dynamic message]';
  sites.push({offset:ts[i].start,message,form:ts[i].value==='errcode'?'explicit-errcode':'raise-condition'});
 }
 return sites;
}
export function definitions(source){
 const ts=tokens(source),defs=[],dynamic=[],doRaises=[];let start=0;
 for(let end=0;end<=ts.length;end++){
  if(end<ts.length&&ts[end].value!==';')continue;
  const part=ts.slice(start,end);start=end+1;if(!part.length)continue;
  let k=0;if(part[k]?.value!=='create'){
   if(part[0].value==='do'){const token=part.find(t=>t.kind==='dollar'),body=token?.value||'';doRaises.push(...businessRaises(body).map(s=>({...s,line:source.slice(0,token.bodyStart+s.offset).split('\n').length})));if(/pg_get_functiondef/i.test(body))dynamic.push({line:source.slice(0,part[0].start).split('\n').length,signatures:[...body.matchAll(/'([^']+\([^']*\))'::regprocedure/g)].map(m=>m[1]),snippet:body.slice(0,110)});}
   continue;
  }
  k++;const replace=part[k]?.value==='or';if(replace)k+=2;if(part[k++]?.value!=='function')continue;
  const schema=part[k++]?.value;if(part[k++]?.value!=='.')throw Error('Unqualified function');const name=part[k++]?.value;if(part[k++]?.value!=='(')throw Error('Bad function header');
  let depth=1,params=[],param=[];
  while(k<part.length&&depth){const t=part[k++];if(t.value==='(')depth++;if(t.value===')')depth--;if(depth===0||t.value===','&&depth===1){if(param.length)params.push(param);param=[];}else param.push(t);}
  const types=params.map(p=>{const stop=p.findIndex(t=>t.value==='default'||t.value==='=');if(stop>=0)p=p.slice(0,stop);if(['in','inout','out','variadic'].includes(p[0]?.value))p=p.slice(1);if(p.length>1&&p[0].kind==='word'&&p[1].kind==='word')p=p.slice(1);return p.map(t=>t.value).join('').replace('timestampwithtimezone','timestamptz');});
  const bodyToken=part.find((t,i)=>i>k&&part[i-1]?.value==='as'&&['dollar','string'].includes(t.kind));if(!bodyToken)throw Error(`No body: ${schema}.${name}`);
  const raises=businessRaises(bodyToken.value).map(s=>({...s,line:source.slice(0,(bodyToken.bodyStart??bodyToken.start+1)+s.offset).split('\n').length}));
  defs.push({signature:`${schema}.${name}(${types.join(',')})`,replace,line:source.slice(0,part[0].start).split('\n').length,body:bodyToken.value,bodySha256:createHash('sha256').update(bodyToken.value).digest('hex'),raises});
 }
 return {defs,dynamic,doRaises};
}
export async function audit(){
 const dir='supabase/migrations',files=(await fs.readdir(dir)).filter(f=>f.endsWith('.sql')).sort(),rows=[],latest=new Map();
 for(const file of files){const source=(await fs.readFile(`${dir}/${file}`,'utf8')).replace(/\r\n/g,'\n'),parsed=definitions(source),pending=/^202610(?:29|30)/.test(file);
  for(const d of parsed.defs)latest.set(d.signature,{...d,file});
  rows.push({file,version:file.split('_')[0],sha256:createHash('sha256').update(source).digest('hex'),pendingB7:pending,definitionCount:parsed.defs.length,raiseCount:parsed.defs.reduce((n,d)=>n+d.raises.length,0)+parsed.doRaises.length,doRaises:parsed.doRaises,functions:parsed.defs.filter(d=>d.raises.length).map(({body,...d})=>d),dynamicRewrites:parsed.dynamic});
 }
 const hotfix=await fs.readFile(`${dir}/20261031003000_rpc_business_conflicts_no_retry.sql`,'utf8');
 const hotfixSignatures=[...new Set([...hotfix.matchAll(/\('((?:public|app_private)\.[^']+)'\)/g)].map(m=>m[1]))];
 const pending=rows.filter(r=>r.pendingB7);
 const overwrite=[];
 for(const r of pending){const source=(await fs.readFile(`${dir}/${r.file}`,'utf8')).replace(/\r\n/g,'\n');for(const d of definitions(source).defs)if(hotfixSignatures.includes(d.signature))overwrite.push({file:r.file,signature:d.signature,line:d.line,raises:d.raises.length});}
 const terminal=[...latest.values()].filter(d=>/^202610(?:29|30)/.test(d.file)&&d.raises.length).map(({body,...d})=>d).sort((a,b)=>a.signature.localeCompare(b.signature));
 return {scope:'Offline lexical source audit; dynamic DO rewrites are explicitly separate; projected catalog is not a live SQL compilation',files:rows,summary:{repositoryMigrations:rows.length,pendingB7Migrations:pending.length,pendingRaiseSites:pending.reduce((n,r)=>n+r.raiseCount,0),pendingDefinitionsWithRaises:pending.reduce((n,r)=>n+r.functions.length,0),projectedTerminalDirectFunctions:terminal.length,projectedTerminalRaiseSites:terminal.reduce((n,d)=>n+d.raises.length,0),hotfixSignatures:hotfixSignatures.length},hotfixSignatures,overwrite,terminal,dynamicRewrites:pending.flatMap(r=>r.dynamicRewrites.map(d=>({file:r.file,...d})))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const r=await audit();const out=process.argv[2]||'.tmp-b7-preflight/source-audit.json';await fs.mkdir(out.slice(0,out.lastIndexOf('/')),{recursive:true});await fs.writeFile(out,JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({summary:r.summary,overwrite:r.overwrite,dynamicRewrites:r.dynamicRewrites,output:out},null,2));}
