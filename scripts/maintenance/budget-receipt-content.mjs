import {createHash} from 'node:crypto';

// Container signatures and byte identity, not malware scanning or a promise
// that every document/image decoder will accept the file.
export function verifyReceiptBytes(bytes,expected){
 const b=Buffer.from(bytes);
 if(!Number.isSafeInteger(expected.size)||expected.size<1||expected.size>10485760||b.length!==expected.size)throw Error('Receipt size mismatch');
 const digest=createHash('sha256').update(b).digest('hex');
 if(digest!==expected.digest)throw Error('Receipt SHA-256 mismatch');
 let type=null;
 if(b.length>=20&&b.subarray(0,5).toString('ascii')==='%PDF-'&&/%%EOF\s*$/.test(b.subarray(-1024).toString('latin1')))type='application/pdf';
 if(b.length>=45&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&b.readUInt32BE(8)===13&&b.subarray(12,16).toString('ascii')==='IHDR'&&b.readUInt32BE(16)>0&&b.readUInt32BE(20)>0&&b.subarray(-12).equals(Buffer.from([0,0,0,0,73,69,78,68,174,66,96,130])))type='image/png';
 if(b.length>=12&&b[0]===255&&b[1]===216&&b[2]===255&&b[b.length-2]===255&&b[b.length-1]===217)type='image/jpeg';
 if(b.length>=20&&b.subarray(0,4).toString('ascii')==='RIFF'&&b.readUInt32LE(4)+8===b.length&&b.subarray(8,12).toString('ascii')==='WEBP'&&['VP8 ','VP8L','VP8X'].includes(b.subarray(12,16).toString('ascii')))type='image/webp';
 if(type!==expected.type)throw Error('Receipt content does not match its MIME type');
 return {digest,size:b.length,type};
}
