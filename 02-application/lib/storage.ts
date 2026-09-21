import 'server-only';
import {createHmac,createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
const hmac=(k:Buffer|string,v:string)=>createHmac('sha256',k).update(v).digest();
const digest=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const encode=(v:string)=>encodeURIComponent(v).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
export async function objectRequest(method:'PUT'|'GET',key:string,bytes?:Buffer,type='application/octet-stream'){
 const endpoint=process.env.S3_ENDPOINT,bucket=process.env.S3_BUCKET,access=process.env.S3_ACCESS_KEY_ID,secret=process.env.S3_SECRET_ACCESS_KEY,region=process.env.S3_REGION||'auto';
 if(!endpoint||!bucket||!access||!secret)throw new Error('File storage is not connected yet.');
 const url=new URL(endpoint);if(url.protocol!=='https:')throw new Error('Storage requires HTTPS.');url.pathname='/'+[bucket,...key.split('/')].map(encode).join('/');
 const time=new Date().toISOString().replace(/[:-]|\.\d{3}/g,''),day=time.slice(0,8),payload=digest(bytes||'');
 const hdr=`host:${url.host}\nx-amz-content-sha256:${payload}\nx-amz-date:${time}\n`,signed='host;x-amz-content-sha256;x-amz-date';
 const canonical=[method,url.pathname,'',hdr,signed,payload].join('\n'),scope=`${day}/${region}/s3/aws4_request`;
 const signing=hmac(hmac(hmac(hmac('AWS4'+secret,day),region),'s3'),'aws4_request');
 const signature=createHmac('sha256',signing).update(`AWS4-HMAC-SHA256\n${time}\n${scope}\n${digest(canonical)}`).digest('hex');
 const r=await fetch(url,{method,headers:{'x-amz-date':time,'x-amz-content-sha256':payload,Authorization:`AWS4-HMAC-SHA256 Credential=${access}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,'Content-Type':type},body:bytes as unknown as BodyInit,cache:'no-store'});
 if(!r.ok)throw new Error('File storage is temporarily unavailable.');return r;
}
export function validateZip(b:Buffer){
 if(b.length<22||b.readUInt32LE(0)!==0x04034b50)throw new Error('Upload a valid ZIP archive.');
 let end=-1;for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(b.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0)throw new Error('Invalid ZIP archive.');const count=b.readUInt16LE(end+10);let pos=b.readUInt32LE(end+16),size=0,cursors=0;
 if(count>500||count===0)throw new Error('ZIP must contain 1–500 files.');
 for(let i=0;i<count;i++){if(pos+46>b.length||b.readUInt32LE(pos)!==0x02014b50)throw new Error('Invalid ZIP directory.');const flags=b.readUInt16LE(pos+8),n=b.readUInt16LE(pos+28),extra=b.readUInt16LE(pos+30),comment=b.readUInt16LE(pos+32),mode=b.readUInt32LE(pos+38)>>>16,name=b.subarray(pos+46,pos+46+n).toString();size+=b.readUInt32LE(pos+24);if(flags&1||name.includes('..')||name.includes('\\')||name.startsWith('/')||name.includes(':')||(mode&0xf000)===0xa000)throw new Error('Unsafe ZIP entry.');if(!name.endsWith('/')&&!/\.(cur|ani|txt|png)$/i.test(name))throw new Error('ZIP files may contain only CUR, ANI, TXT, and PNG files.');if(/\.(cur|ani)$/i.test(name))cursors++;pos+=46+n+extra+comment;}
 if(!cursors||size>100*1024*1024)throw new Error('ZIP needs cursor files and must be under 100 MB uncompressed.');
 inspectZipContents(b);
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
export function inspectZipContents(b:Buffer){
 const MAX_MEMBER=12*1024*1024;
 let end=-1;for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(b.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0)return;const count=b.readUInt16LE(end+10);let pos=b.readUInt32LE(end+16);
 for(let i=0;i<count;i++){
  if(pos+46>b.length||b.readUInt32LE(pos)!==0x02014b50)return;
  const method=b.readUInt16LE(pos+10),csize=b.readUInt32LE(pos+20),usize=b.readUInt32LE(pos+24),n=b.readUInt16LE(pos+28),extra=b.readUInt16LE(pos+30),comment=b.readUInt16LE(pos+32),local=b.readUInt32LE(pos+42),name=b.subarray(pos+46,pos+46+n).toString();
  pos+=46+n+extra+comment;
  if(name.endsWith('/')||usize===0)continue;
  if(usize>MAX_MEMBER)throw new Error('ZIP contains an unexpectedly large single file.');
  // Local header: its own name/extra lengths sit 26/28 bytes in, and the
  // payload starts after 30 + those. Using the central directory's lengths
  // here lands mid-stream and the inflate fails on every valid entry.
  const ln=b.readUInt16LE(local+26),lx=b.readUInt16LE(local+28),start=local+30+ln+lx;
  if(start+csize>b.length)throw new Error('Invalid ZIP archive.');
  const raw=b.subarray(start,start+csize);
  let data:Buffer;
  try{ data=method===8?inflateRawSync(raw):method===0?raw:raw; }catch{ throw new Error('Invalid ZIP archive.'); }
  if(data.length>MAX_MEMBER)throw new Error('ZIP contains an unexpectedly large single file.');
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
   // Readmes are text. Markup, scripts, or a binary payload are not.
   const head=data.subarray(0,4096).toString('latin1');
   if(/<\s*(script|html|iframe|object|embed|svg|form|meta|link)\b/i.test(head))throw new Error('A text file in the ZIP contains markup or script.');
   if(data.includes(0))throw new Error('A text file in the ZIP contains binary data.');
   continue;
  }
  // .cur / .ani: the cursor headers are fixed magic, so a mismatch means the
  // member is something else wearing a cursor extension.
  if(/\.cur$/i.test(name)){ if(data.length<6||data.readUInt16LE(0)!==0||![1,2].includes(data.readUInt16LE(2)))throw new Error('A .cur file is not a valid cursor.'); continue; }
  if(/\.ani$/i.test(name)){ if(data.toString('ascii',0,4)!=='RIFF'||data.toString('ascii',8,12)!=='ACON')throw new Error('An .ani file is not a valid animated cursor.'); continue; }
 }
}
