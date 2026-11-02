// Local Production signing adapter. No network endpoint, file storage or UI import.
import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
export const productionCredentialProject='lqvuqamzmchepgxkftcw';
const endpoint=`https://${productionCredentialProject}.supabase.co`;
export function createProductionCredentialProvider({admin,anon,secret,now=()=>Math.floor(Date.now()/1000)}){
 if(!Buffer.isBuffer(secret)||secret.length<32)throw Error('In-memory signing Buffer required');
 function validate(token,role){
  let parts,header,payload;
  try{parts=token.split('.');header=JSON.parse(Buffer.from(parts[0],'base64url'));payload=JSON.parse(Buffer.from(parts[1],'base64url'));}catch{throw Error('Invalid Production credential format');}
  if(parts.length!==3||header.alg!=='HS256'||payload.ref!==productionCredentialProject||payload.role!==role||!Number.isInteger(payload.exp)||payload.exp<=now())throw Error('Production project role or expiry rejected');
  const signature=createHmac('sha256',secret).update(parts[0]+'.'+parts[1]).digest(),actual=Buffer.from(parts[2],'base64url');
  if(signature.length!==actual.length||!timingSafeEqual(signature,actual))throw Error('Production signature rejected');
 }
 try{validate(admin,'service_role');validate(anon,'anon');}catch(e){secret.fill(0);throw e;}
 let stopped=false;
 return {
  issue(){
   if(stopped)throw Error('Production credential provider stopped');
   const iat=now();if(!Number.isInteger(iat)||iat<1)throw Error('Invalid signing time');
   const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
   const claims=Buffer.from(JSON.stringify({role:'budget_receipt_worker',ref:productionCredentialProject,iss:endpoint+'/auth/v1',aud:'authenticated',sub:randomUUID(),iat,exp:iat+900})).toString('base64url');
   const worker=header+'.'+claims+'.'+createHmac('sha256',secret).update(header+'.'+claims).digest('base64url');
   return {admin,anon,worker};
  },
  stop(){stopped=true;secret.fill(0);admin=null;anon=null;}
 };
}
