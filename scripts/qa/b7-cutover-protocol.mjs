// TUS renders the Storage error message as text, not its JSON error code.
// A generic rejection or an expired sample is never revocation evidence.
export function isRevokedUploadResponse({status,body,tokenStillWithinExpiry}){
 if(!tokenStillWithinExpiry||![400,401].includes(status))return false;
 if(body.trim()==='signature verification failed')return true;
 try{const v=JSON.parse(body);return ['InvalidJWT','InvalidSignature'].includes(v.error||v.code);}catch{return false;}
}
