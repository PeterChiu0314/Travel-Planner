// QA-only loopback server. Native Chrome owns locked files in ignored scratch
// directories; Vite must never watch those profiles or private QA evidence.
import {createServer} from 'vite';
const server=await createServer({mode:'staging',server:{host:'127.0.0.1',port:5189,strictPort:true,watch:{ignored:['**/.tmp-*/**']}}});
await server.listen();
server.printUrls();
// Emit only after the owned strict-port listener succeeds; URLs can contain
// terminal styling or arrive split across pipe chunks.
console.log('QA_STAGING_VITE_READY:5189');
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await server.close();process.exit(0);});
