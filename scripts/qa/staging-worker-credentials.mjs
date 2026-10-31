// Local trusted signing only, never an HTTP endpoint or frontend import.
import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
export const credentialProject='uyqdopksfysbobhjcepk';
const endpoint=`https://${credentialProject}.supabase.co`;
const claims=token=>{try{return JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());}catch{throw Error('Invalid Staging credential format');}};
function verifyLegacy(token,role,secret){
 const p=token?.split('.')||[];let header;try{header=JSON.parse(Buffer.from(p[0],'base64url').toString());}catch{throw Error('Invalid Staging credential format');}
 const c=claims(token);
 if(p.length!==3||header.alg!=='HS256'||c.ref!==credentialProject||c.role!==role||!Number.isInteger(c.exp)||c.exp<=Date.now()/1000)throw Error('Staging role/project/expiry validation failed');
 const expected=createHmac('sha256',secret).update(p[0]+'.'+p[1]).digest(),actual=Buffer.from(p[2],'base64url');
 if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw Error('Staging signing secret does not match existing credential');
}
export function createStagingCredentialProvider({admin,anon,secret,now=()=>Math.floor(Date.now()/1000)}){
 if(!Buffer.isBuffer(secret)||secret.length<32)throw Error('In-memory signing secret Buffer required');
 try{verifyLegacy(admin,'service_role',secret);verifyLegacy(anon,'anon',secret);}catch(error){secret.fill(0);throw error;}
 let stopped=false;
 return {
  issue(){
   if(stopped)throw Error('Credential provider stopped');
   const issued=now();if(!Number.isInteger(issued)||issued<1)throw Error('Invalid signing time');
   const head=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
   const body=Buffer.from(JSON.stringify({role:'budget_receipt_worker',ref:credentialProject,iss:endpoint+'/auth/v1',aud:'authenticated',sub:randomUUID(),iat:issued,exp:issued+900})).toString('base64url');
   const worker=head+'.'+body+'.'+createHmac('sha256',secret).update(head+'.'+body).digest('base64url');
   return {admin,anon,worker};
  },
  stop(){stopped=true;secret.fill(0);admin=null;anon=null;}
 };
}
