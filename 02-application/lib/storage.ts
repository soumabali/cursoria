import 'server-only';
import {createHmac,createHash} from 'node:crypto';
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
}
