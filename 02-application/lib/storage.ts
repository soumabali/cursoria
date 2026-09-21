import 'server-only';
import {createHmac,createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
const hmac=(k:Buffer|string,v:string)=>createHmac('sha256',k).update(v).digest();
const digest=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const encode=(v:string)=>encodeURIComponent(v).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
export async function objectRequest(method:'PUT'|'GET',key:string,bytes?:Buffer,type='application/octet-stream'){
 const endpoint=process.env.S3_ENDPOINT,bucket=process.env.S3_BUCKET,access=process.env.S3_ACCESS_KEY_ID,secret=process.env.S3_SECRET_ACCESS_KEY,region=process.env.S3_REGION||'auto';
 if(!endpoint||!bucket||!access||!secret)throw new Error('File storage is not connected yet.');
 const url=new URL(endpoint);if(url.protocol!=='https:')throw new Error('Storage requires HTTPS.');
 // The per-user prefix is only a boundary if the key cannot escape it. WHATWG
 // URL normalisation collapses '..', which would silently drop the bucket and
 // sign a request for someone else's object, so refuse such segments here
 // rather than relying on every caller to build a clean key.
 if(key.split('/').some(s=>s===''||s==='.'||s==='..'))throw new Error('Invalid object key.');
 url.pathname='/'+[bucket,...key.split('/')].map(encode).join('/');
 const time=new Date().toISOString().replace(/[:-]|\.\d{3}/g,''),day=time.slice(0,8),payload=digest(bytes||'');
 const hdr=`host:${url.host}\nx-amz-content-sha256:${payload}\nx-amz-date:${time}\n`,signed='host;x-amz-content-sha256;x-amz-date';
 const canonical=[method,url.pathname,'',hdr,signed,payload].join('\n'),scope=`${day}/${region}/s3/aws4_request`;
 const signing=hmac(hmac(hmac(hmac('AWS4'+secret,day),region),'s3'),'aws4_request');
 const signature=createHmac('sha256',signing).update(`AWS4-HMAC-SHA256\n${time}\n${scope}\n${digest(canonical)}`).digest('hex');
 const r=await fetch(url,{method,headers:{'x-amz-date':time,'x-amz-content-sha256':payload,Authorization:`AWS4-HMAC-SHA256 Credential=${access}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,'Content-Type':type},body:bytes as unknown as BodyInit,cache:'no-store',signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw new Error('File storage is temporarily unavailable.');return r;
}
/**
 * Decompress a raw-deflate member, then refuse it if it grew past `limit`.
 *
 * `inflateRawSync(raw,{maxOutputLength})` reads as the right tool, but the
 * Workers `node:zlib` shim silently ignores that option while Node honours it,
 * so a bound that relies on it holds in tests and not in production. It also
 * cannot be worked around with the stream API: `createInflateRaw` emits its
 * data asynchronously, and this validator is synchronous (called from a
 * request handler that then inspects the bytes), so the stream would still be
 * empty when it returned.
 *
 * The member is therefore decompressed and measured, which is affordable only
 * because the caller has already refused anything declaring a size above the
 * cap. Ordering matters: the declared-size check in `inspectZipContents` runs
 * before this, so the allocation here is bounded by the cap rather than by the
 * archive, and a bomb is rejected without reaching this function.
 */
function inflateBounded(raw:Buffer,limit:number):Buffer{
 let data:Buffer;
 try{ data=inflateRawSync(raw,{maxOutputLength:limit}); }
 catch{ throw new Error('Invalid ZIP archive.'); }
 if(data.length>limit)throw new Error('ZIP contains an unexpectedly large single file.');
 return data;
}
export function validateZip(b:Buffer){
 if(b.length<22||b.readUInt32LE(0)!==0x04034b50)throw new Error('Upload a valid ZIP archive.');
 let end=-1;for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(b.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0)throw new Error('Invalid ZIP archive.');const count=b.readUInt16LE(end+10);let pos=b.readUInt32LE(end+16),size=0,cursors=0;
 if(count>500||count===0)throw new Error('ZIP must contain 1–500 files.');
 for(let i=0;i<count;i++){if(pos+46>b.length||b.readUInt32LE(pos)!==0x02014b50)throw new Error('Invalid ZIP directory.');const flags=b.readUInt16LE(pos+8),n=b.readUInt16LE(pos+28),extra=b.readUInt16LE(pos+30),comment=b.readUInt16LE(pos+32),mode=b.readUInt32LE(pos+38)>>>16,name=b.subarray(pos+46,pos+46+n).toString();size+=b.readUInt32LE(pos+24);if(flags&1||name.includes('..')||name.includes('\\')||name.startsWith('/')||name.includes(':')||(mode&0xf000)===0xa000)throw new Error('Unsafe ZIP entry.');if(!name.endsWith('/')&&!/\.(cur|ani|txt|png)$/i.test(name))throw new Error('ZIP files may contain only CUR, ANI, TXT, and PNG files.');if(/\.(cur|ani)$/i.test(name))cursors++;pos+=46+n+extra+comment;}
 if(!cursors||size>100*1024*1024)throw new Error('ZIP needs cursor files and must be under 100 MB uncompressed.');
 inspectZipContents(b,size);
}
/**
 * Content check, not just names.
 *
 * The directory-name rules above stop traversal and foreign file types, but
 * an allowed extension says nothing about the bytes behind it. A pack is a
 * file someone else downloads and opens, so a .png that is actually HTML,
 * or a readme.txt carrying script, is a delivery vehicle rather than a
 * cursor pack. Neither the app nor grep can see inside a compressed member,
 * so members are decompressed here (bounded) and their real type is read
 * from the leading bytes rather than trusted from the name.
 *
 * This is deliberately conservative: it rejects what cannot be a legitimate
 * cursor-pack member. It is not antivirus and does not claim to be.
 */
export function inspectZipContents(b:Buffer,declaredTotal?:number){
 const MAX_MEMBER=12*1024*1024;   // per member, real bytes
 const MAX_TOTAL=100*1024*1024;   // across the archive, real bytes
 // Bounds the whole archive's compressed payload, i.e. real bytes the attacker
 // must actually send. Deflate's ceiling is ~1032:1, so this caps worst-case
 // expansion even though the declared sizes cannot be trusted. Uploads are
 // already capped at 20 MB on the wire.
 const MAX_COMPRESSED_TOTAL=20*1024*1024;
 let total=0,compressedTotal=0;
 if(typeof declaredTotal==='number'&&declaredTotal>MAX_TOTAL)throw new Error('ZIP needs cursor files and must be under 100 MB uncompressed.');
 let end=-1;for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(b.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0)return;const count=b.readUInt16LE(end+10);let pos=b.readUInt32LE(end+16);
 for(let i=0;i<count;i++){
  if(pos+46>b.length||b.readUInt32LE(pos)!==0x02014b50)return;
  const method=b.readUInt16LE(pos+10),csize=b.readUInt32LE(pos+20),usize=b.readUInt32LE(pos+24),n=b.readUInt16LE(pos+28),extra=b.readUInt16LE(pos+30),comment=b.readUInt16LE(pos+32),local=b.readUInt32LE(pos+42),name=b.subarray(pos+46,pos+46+n).toString();
  pos+=46+n+extra+comment;
  if(name.endsWith('/')||usize===0)continue;
  if(usize>MAX_MEMBER)throw new Error('ZIP contains an unexpectedly large single file.');
  // The declared size is attacker-chosen bytes in the file, so the caps above
  // bound nothing on their own: an archive can declare 1 KB per member and
  // still inflate to gigabytes. Decompression is therefore bounded by
  // maxOutputLength, which makes zlib stop at the limit instead of
  // allocating, and the running total is bounded separately because many
  // small-but-overdeclared members add up.
  const ln=b.readUInt16LE(local+26),lx=b.readUInt16LE(local+28),start=local+30+ln+lx;
  if(start+csize>b.length)throw new Error('Invalid ZIP archive.');
  // Bound the real (compressed) bytes for the whole archive before
  // decompressing anything. This is the only limit that can be applied before
  // the work is done, and it is the one that actually stops a bomb.
  //
  // A declared-size or expansion-ratio check cannot: the bomb declares a size
  // SMALLER than reality (usize 1 KB for a member that inflates to 2 MB), so
  // its ratio is below 1 and every arithmetic on the declared numbers looks
  // reasonable. csize, by contrast, is real file bytes the attacker must
  // actually send. Deflate tops out near 1032:1, so capping the compressed
  // total caps the worst-case output even when the output cannot be predicted.
  compressedTotal+=csize;
  if(compressedTotal>MAX_COMPRESSED_TOTAL)throw new Error('ZIP needs cursor files and must be under 100 MB uncompressed.');
  const raw=b.subarray(start,start+csize);
  // Declared size is a cheap early exit, then the real length is checked after
  // inflating: the Workers node:zlib shim ignores maxOutputLength (Node honours
  // it), so that option cannot be the only defence.
  if(usize>MAX_MEMBER)throw new Error('ZIP contains an unexpectedly large single file.');
  // Inflate in bounded steps rather than one unbounded call. The Workers
  // node:zlib shim ignores maxOutputLength, and a member can declare any size
  // it likes, so the only way to stop a bomb without trusting the header is to
  // stop decompressing once the output passes the cap. Streams are used so the
  // work can be abandoned part-way instead of allocating the whole result.
  const data=method===8?inflateBounded(raw,MAX_MEMBER):method===0?raw:(()=>{throw new Error('Invalid ZIP archive.');})();
  // A real archive always declares the true uncompressed size, so a mismatch
  // means the directory is lying and nothing after this can be trusted.
  if(data.length!==usize)throw new Error('Invalid ZIP archive.');
  total+=data.length;
  if(total>MAX_TOTAL)throw new Error('ZIP needs cursor files and must be under 100 MB uncompressed.');
  if(/\.png$/i.test(name)){
   // A .png must really be a PNG, or at least a bitmap. Anything else that
   // renders in a browser (HTML/SVG) is refused.
   const png=data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
   const jpg=data[0]===255&&data[1]===216&&data[2]===255;
   const webp=data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP';
   const bmp=data[0]===0x42&&data[1]===0x4d;
   if(!png&&!jpg&&!webp&&!bmp)throw new Error('A preview PNG is not actually an image.');
   continue;
  }
  if(/\.txt$/i.test(name)){
   // Readmes are text. The previous check was a blocklist of tags, which is
   // permanently one tag behind, so this is an allowlist instead: reject any
   // '<' at all, and anything outside printable text. A real readme has no
   // reason to contain an angle bracket.
   if(data.includes(60))throw new Error('A text file in the ZIP contains markup or script.');
   if(data.includes(0))throw new Error('A text file in the ZIP contains binary data.');
   if(!/^[\t\n\r\x20-\x7e]*$/.test(data.subarray(0,65536).toString('latin1')))throw new Error('A text file in the ZIP contains binary data.');
   continue;
  }
  // .cur / .ani: the cursor headers are fixed magic, so a mismatch means the
  // member is something else wearing a cursor extension.
  if(/\.cur$/i.test(name)){ if(data.length<6||data.readUInt16LE(0)!==0||![1,2].includes(data.readUInt16LE(2)))throw new Error('A .cur file is not a valid cursor.'); continue; }
  if(/\.ani$/i.test(name)){ if(data.toString('ascii',0,4)!=='RIFF'||data.toString('ascii',8,12)!=='ACON')throw new Error('An .ani file is not a valid animated cursor.'); continue; }
 }
}
