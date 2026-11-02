// Lossless archive of already-applied bytes. Never changes or executes the SQL.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {gzipSync,gunzipSync} from 'node:zlib';
import {hash} from './b7-forward-artifacts.mjs';
const dir='docs/operations/budget-b7-production/candidate';
const manifest=JSON.parse(await fs.readFile(dir+'/packet-manifest.json','utf8'));
assert.equal(manifest.executed,true,'Archive only the completed execution');
const source=await fs.readFile(dir+'/dormant-and-budget-reset.sql');
assert.equal(hash(source),manifest.packetSha256);
const archive=(gzipSync(source,{level:9}).toString('base64').match(/.{1,76}/g).join('\n'))+'\n';
assert.deepEqual(gunzipSync(Buffer.from(archive,'base64')),source);
const file='applied-packet.sql.gz.base64';
try{assert.equal(await fs.readFile(dir+'/'+file,'utf8'),archive,'Never overwrite a different execution archive');}catch(e){if(e.code!=='ENOENT')throw e;await fs.writeFile(dir+'/'+file,archive);}
manifest.losslessArchive={file,private:true,tracked:false,sha256:hash(archive),decodedSqlSha256:hash(source),encoding:'base64(gzip(original UTF8 bytes)); LF wrapping',bytes:Buffer.byteLength(archive),replayAllowed:false};
await fs.writeFile(dir+'/packet-manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({archive:file,sqlSha256:hash(source),roundTripExact:true,sqlModified:false}));
