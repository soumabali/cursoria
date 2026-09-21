import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transpileModule,ModuleKind,ScriptTarget} from 'typescript';
import {createHash} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';

// Execute the actual server modules with only service boundaries replaced.
Error.stackTraceLimit=2;
const bridge={sql:async()=>[],cookie:undefined,fetch:async()=>{throw new Error('Unexpected network access');}};
globalThis.__cursorTest=bridge;
const originalFetch=globalThis.fetch;
globalThis.fetch=(...a)=>bridge.fetch(...a);
process.env.APP_URL='https://store.example';
process.env.SETTINGS_ENCRYPTION_KEY='a'.repeat(64);
process.env.DATABASE_URL='postgresql://test@example.neon.tech/test';
function compiled(file,replacements={}){
 let src=readFileSync(file,'utf8').replace(/import ['"]server-only['"];?/g,'');
 for(const [from,to] of Object.entries(replacements))src=src.replaceAll(from,to);
 return 'data:text/javascript;base64,'+Buffer.from(transpileModule(src,{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022}}).outputText).toString('base64');
}
const dbReplacement="const sql=(...args)=>globalThis.__cursorTest.sql(...args); const configured=()=>Boolean(process.env.DATABASE_URL);";
const securityURL=compiled('lib/security.ts',{
 "import { sql } from './db';":dbReplacement,
 "import { cookies } from 'next/headers';":"const cookies=async()=>({get:()=>globalThis.__cursorTest.cookie?{value:globalThis.__cursorTest.cookie}:undefined,set:()=>{},delete:()=>{}});"
});
const security=await import(securityURL);
const storageURL=compiled('lib/storage.ts');
const storage=await import(storageURL);
const paymentURL=compiled('lib/payments.ts',{
 "import {sql} from './db';":dbReplacement,
 "from './security'":`from '${securityURL}'`
});
const payments=await import(paymentURL);
const routeURL=compiled('app/api/[...path]/route.ts',{
 "import {sql,configured} from '@/lib/db';":dbReplacement,
 "from '@/lib/security'":`from '${securityURL}'`,
 "from '@/lib/storage'":`from '${storageURL}'`,
 "from '@/lib/payments'":`from '${paymentURL}'`,
 "from 'next/server'":`from '${pathToFileURL(process.cwd()+'/node_modules/next/server.js')}'`,
 "from 'zod'":`from '${import.meta.resolve('zod')}'`,
 "import {cookies} from 'next/headers';":"const cookies=async()=>({get:()=>undefined,set:()=>{},delete:()=>{}});"
});
const routes=await import(routeURL);
const userId='11111111-1111-4111-8111-111111111111',productId='22222222-2222-4222-8222-222222222222',orderId='33333333-3333-4333-8333-333333333333';
function post(path,data,origin='https://store.example'){return routes.POST(new Request('https://store.example/api/'+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(data)}),{params:Promise.resolve({path:path.split('/')})});}
function authenticate(role='user',verified=true){bridge.cookie='session';bridge.sql=async q=>q.includes('JOIN users u ON u.id=s.user_id')?[{id:userId,email:'user@example.com',role,verified_at:verified?'2026-09-08':null}]:q.includes('INSERT INTO rate_limits')?[{hits:1}]:[];}
function paymentFixture(state='settlement',amount='25000.00'){
 const order={id:orderId,amount:25000,production:false,payment_key:security.encrypt('test-server-key')};const queries=[];
 bridge.sql=async(q,p)=>{queries.push({q,p});return q.startsWith('SELECT * FROM orders')?[order]:[];};
 bridge.fetch=async()=>new Response(JSON.stringify({order_id:orderId,gross_amount:amount,currency:'IDR',transaction_status:state,fraud_status:'accept'}),{status:200});return queries;
}
test('encrypted payment keys round-trip and reject tampering',()=>{const value=security.encrypt('secret-key');assert.equal(security.decrypt(value),'secret-key');const b=Buffer.from(value,'base64');b[13]^=1;assert.throws(()=>security.decrypt(b.toString('base64')));});
test('cross-origin changes are rejected before account access',async()=>{bridge.sql=async()=>{throw new Error('Should not query DB');};const r=await post('settings/save',{},'https://attacker.example');assert.equal(r.status,400);assert.match((await r.json()).error,/origin/);});
test('unverified users cannot claim a free pack',async()=>{authenticate('user',false);const r=await post('checkout',{product_id:productId,request_key:orderId});assert.equal(r.status,400);assert.match((await r.json()).error,/verified email/);});
test('creator cannot edit another creator product',async()=>{authenticate('creator');const r=await post('products/save',{id:productId,title:'Test pack',slug:'test-pack',description:'A sufficiently long test cursor pack description.',category:'Minimal',mode:'free',price:0,compatibility:'Windows',formats:'.cur',states:1,version:'1',license:'Personal use only.',preview_key:null,package_key:null,published:false,rights:true});assert.equal(r.status,400);assert.match((await r.json()).error,/Product not found/);});
test('creator cannot alter Midtrans settings',async()=>{authenticate('creator');const r=await post('settings/save',{server_key:'attacker',enabled:true,production:true});assert.equal(r.status,400);assert.match((await r.json()).error,/Access denied/);});
test('authenticated user without entitlement cannot download',async()=>{authenticate();bridge.fetch=async()=>{throw new Error('Storage must not be reached');};const r=await routes.GET(new Request('https://store.example/api/download/'+productId),{params:Promise.resolve({path:['download',productId]})});assert.equal(r.status,403);});
test('forged Midtrans signature is rejected before remote lookup',async()=>{paymentFixture();let called=false;bridge.fetch=async()=>{called=true;throw new Error('Should not fetch');};await assert.rejects(()=>payments.reconcile(orderId,{order_id:orderId,status_code:'200',gross_amount:'25000.00',signature_key:'forged'}),/signature/);assert.equal(called,false);});
test('authoritative status with wrong amount cannot grant access',async()=>{const q=paymentFixture('settlement','1.00');await assert.rejects(()=>payments.reconcile(orderId),/do not match/);assert.equal(q.length,1);});
test('settlement invokes one atomic locked entitlement statement',async()=>{const q=paymentFixture();const d={order_id:orderId,status_code:'200',gross_amount:'25000.00'};d.signature_key=createHash('sha512').update(orderId+'20025000.00test-server-key').digest('hex');await payments.reconcile(orderId,d);assert.equal(q.length,2);assert.equal(q[1].p[1],'paid');assert.match(q[1].q,/FOR UPDATE/);assert.match(q[1].q,/INSERT INTO entitlements/);});
test('refund is passed to atomic reconciliation as revoked state',async()=>{const q=paymentFixture('refund');await payments.reconcile(orderId);assert.equal(q[1].p[1],'refunded');assert.match(q[1].q,/SET active=false/);});
test('invalid ZIP and executable-only ZIP are rejected',()=>{assert.throws(()=>storage.validateZip(Buffer.from('bad')));const name=Buffer.from('malware.exe'),b=Buffer.alloc(30+name.length+46+name.length+22);b.writeUInt32LE(0x04034b50);let pos=30+name.length;b.writeUInt32LE(0x02014b50,pos);b.writeUInt16LE(name.length,pos+28);name.copy(b,pos+46);const end=b.length-22;b.writeUInt32LE(0x06054b50,end);b.writeUInt16LE(1,end+10);b.writeUInt32LE(pos,end+16);assert.throws(()=>storage.validateZip(b),/only CUR/);});
test('disconnected preview cannot accept real settings or orders',async()=>{delete process.env.DATABASE_URL;const r=await post('checkout',{});assert.equal(r.status,503);process.env.DATABASE_URL='postgresql://test@example.neon.tech/test';});

// Real archives, built here so the validator is exercised on genuine deflate
// streams rather than hand-rolled bytes. The name checks alone cannot see
// inside a compressed member, which is why these cases exist.
function zip(entries){
 const chunks=[],central=[];let offset=0;
 for(const [name,content] of Object.entries(entries)){
  const data=Buffer.from(content),nameBuf=Buffer.from(name);
  const deflated=deflateRawSync(data);
  const local=Buffer.alloc(30+nameBuf.length);
  local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0,6);
  local.writeUInt16LE(8,8);local.writeUInt32LE(deflated.length,18);local.writeUInt32LE(data.length,22);
  local.writeUInt16LE(nameBuf.length,26);nameBuf.copy(local,30);
  chunks.push(local,deflated);
  const cd=Buffer.alloc(46+nameBuf.length);
  cd.writeUInt32LE(0x02014b50,0);cd.writeUInt16LE(20,4);cd.writeUInt16LE(20,6);cd.writeUInt16LE(0,8);
  cd.writeUInt16LE(8,10);cd.writeUInt32LE(deflated.length,20);cd.writeUInt32LE(data.length,24);
  cd.writeUInt16LE(nameBuf.length,28);cd.writeUInt32LE(offset,42);nameBuf.copy(cd,46);
  central.push(cd);
  offset+=local.length+deflated.length;
 }
 const cdBuf=Buffer.concat(central),body=Buffer.concat(chunks);
 const eocd=Buffer.alloc(22);
 eocd.writeUInt32LE(0x06054b50,0);eocd.writeUInt16LE(Object.keys(entries).length,8);
 eocd.writeUInt16LE(Object.keys(entries).length,10);eocd.writeUInt32LE(cdBuf.length,12);
 eocd.writeUInt32LE(body.length,16);
 return Buffer.concat([body,cdBuf,eocd]);
}
const VALID_CUR=Buffer.concat([Buffer.from([0,0,2,0,32,32,0,0,1,0,32,0,40,0,0,0,22,0,0,0]),Buffer.alloc(40)]);
const VALID_PNG=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(40)]);
const VALID_ANI=Buffer.concat([Buffer.from('RIFF'),Buffer.from([4,0,0,0]),Buffer.from('ACON')]);

test('a genuine cursor pack passes validation',()=>{
 assert.doesNotThrow(()=>storage.validateZip(zip({'cursor.cur':VALID_CUR,'readme.txt':Buffer.from('Thanks for the pack!\n')})));
 assert.doesNotThrow(()=>storage.validateZip(zip({'cursor.cur':VALID_CUR,'preview.png':VALID_PNG})));
 assert.doesNotThrow(()=>storage.validateZip(zip({'anim.ani':VALID_ANI,'cursor.cur':VALID_CUR})));
 assert.doesNotThrow(()=>storage.validateZip(zip({'cursors/a/b/cursor.cur':VALID_CUR})),'nested folders are legitimate');
});
test('markup smuggled into an allowed extension is rejected',()=>{
 assert.throws(()=>storage.validateZip(zip({'cursor.cur':VALID_CUR,'preview.png':Buffer.from('<html><script>alert(1)</script></html>')})),/not actually an image/);
 assert.throws(()=>storage.validateZip(zip({'cursor.cur':VALID_CUR,'preview.png':Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>")})),/not actually an image/);
 assert.throws(()=>storage.validateZip(zip({'cursor.cur':VALID_CUR,'readme.txt':Buffer.from('<script>alert(1)</script>')})),/markup or script/);
 assert.throws(()=>storage.validateZip(zip({'cursor.cur':VALID_CUR,'readme.txt':Buffer.from('<html><body>hi</body></html>')})),/markup or script/);
});
test('content must match the extension it claims',()=>{
 assert.throws(()=>storage.validateZip(zip({'cursor.cur':Buffer.from('NOTACURSOR'+'x'.repeat(40))})),/not a valid cursor/);
 assert.throws(()=>storage.validateZip(zip({'anim.ani':Buffer.from('RIFFxxxxNOPE'+'x'.repeat(20))})),/not a valid animated cursor/);
 assert.throws(()=>storage.validateZip(zip({'cursor.cur':VALID_CUR,'readme.txt':Buffer.from('ok\x00\x01binary')})),/binary data/);
});
test('path traversal is rejected however it is spelled',()=>{
 assert.throws(()=>storage.validateZip(zip({'../../etc/passwd':Buffer.from('x'),'cursor.cur':VALID_CUR})),/Unsafe ZIP entry/);
 assert.throws(()=>storage.validateZip(zip({'/etc/shadow':Buffer.from('x'),'cursor.cur':VALID_CUR})),/Unsafe ZIP entry/);
 assert.throws(()=>storage.validateZip(zip({'..\\..\\win.ini':Buffer.from('x'),'cursor.cur':VALID_CUR})),/Unsafe ZIP entry/);
});
test('a pack with no cursor files is rejected',()=>{
 assert.throws(()=>storage.validateZip(zip({'readme.txt':Buffer.from('nothing here')})),/needs cursor files/);
});

// A ZIP bomb: every member *declares* a tiny uncompressed size while its
// deflate stream really expands to megabytes. The declared total stayed well
// under the 100 MB cap and each declared member under the 12 MB cap, so the
// size limits were satisfied by the lie and the archive inflated to hundreds
// of megabytes before this guard existed. Declared sizes come from the file,
// so they cannot bound anything on their own.
function bombMembers(count,realSize,declared,extra={}){
 const filler=Buffer.alloc(realSize,0x20); // spaces: passes the text checks
 const deflated=deflateRawSync(filler);
 const chunks=[],central=[];let offset=0;
 // A real cursor member first, so the "needs cursor files" check cannot be
 // what rejects the archive - the size guard must be doing the work.
 for(const [name,content] of Object.entries({'cursor.cur':VALID_CUR,...extra})){
  const nb=Buffer.from(name),defl=deflateRawSync(Buffer.from(content));
  const lh=Buffer.alloc(30+nb.length);
  lh.writeUInt32LE(0x04034b50,0);lh.writeUInt16LE(20,4);lh.writeUInt16LE(8,8);
  lh.writeUInt32LE(defl.length,18);lh.writeUInt32LE(Buffer.from(content).length,22);
  lh.writeUInt16LE(nb.length,26);nb.copy(lh,30);
  chunks.push(lh,defl);
  const cd=Buffer.alloc(46+nb.length);
  cd.writeUInt32LE(0x02014b50,0);cd.writeUInt16LE(20,4);cd.writeUInt16LE(20,6);cd.writeUInt16LE(8,10);
  cd.writeUInt32LE(defl.length,20);cd.writeUInt32LE(Buffer.from(content).length,24);
  cd.writeUInt16LE(nb.length,28);cd.writeUInt32LE(offset,42);nb.copy(cd,46);
  central.push(cd); offset+=lh.length+defl.length;
 }
 const total=count+Object.keys(extra).length+1;
 for(let i=0;i<count;i++){
  const nameBuf=Buffer.from('readme'+i+'.txt');
  const local=Buffer.alloc(30+nameBuf.length);
  local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);
  local.writeUInt32LE(deflated.length,18);local.writeUInt32LE(declared,22); // the lie
  local.writeUInt16LE(nameBuf.length,26);nameBuf.copy(local,30);
  chunks.push(local,deflated);
  const cd=Buffer.alloc(46+nameBuf.length);
  cd.writeUInt32LE(0x02014b50,0);cd.writeUInt16LE(20,4);cd.writeUInt16LE(20,6);cd.writeUInt16LE(8,10);
  cd.writeUInt32LE(deflated.length,20);cd.writeUInt32LE(declared,24); // and again here
  cd.writeUInt16LE(nameBuf.length,28);cd.writeUInt32LE(offset,42);nameBuf.copy(cd,46);
  central.push(cd); offset+=local.length+deflated.length;
 }
 const cdBuf=Buffer.concat(central),body=Buffer.concat(chunks),eocd=Buffer.alloc(22);
 eocd.writeUInt32LE(0x06054b50,0);eocd.writeUInt16LE(total,8);eocd.writeUInt16LE(total,10);
 eocd.writeUInt32LE(cdBuf.length,12);eocd.writeUInt32LE(body.length,16);
 return Buffer.concat([body,cdBuf,eocd]);
}
test('an archive that lies about uncompressed size is rejected without inflating it',()=>{
 const archive=bombMembers(60,2*1024*1024,1024); // ~120 MB real, 60 KB declared
 assert.ok(archive.length<1024*1024,`test archive should be small on the wire, got ${archive.length}`);
 const started=Date.now();
 assert.throws(()=>storage.validateZip(archive),/Invalid ZIP archive|unexpectedly large|under 100 MB/);
 assert.ok(Date.now()-started<2000,`rejection should not inflate the whole archive (took ${Date.now()-started}ms)`);
});
test('unknown compression methods are rejected rather than passed through',()=>{
 const entries={'cursor.cur':VALID_CUR};
 const b=zip(entries);
 // Rewrite both method fields from 8 (deflate) to 99 (unknown).
 for(let i=0;i<b.length-4;i++){
  if(b.readUInt32LE(i)===0x04034b50)b.writeUInt16LE(99,i+8);
  if(b.readUInt32LE(i)===0x02014b50)b.writeUInt16LE(99,i+10);
 }
 assert.throws(()=>storage.validateZip(b),/Invalid ZIP archive/);
});
test('a readme may not contain markup, whatever the tag',()=>{
 // Any '<' is refused, so this does not depend on knowing every dangerous
 // tag. The previous version listed tags and was already behind.
 for(const hostile of ['<math>x</math>','<details>','<video src=x>','<body>','<a href=x>','<img src=x>','</script>']){
  assert.throws(()=>storage.validateZip(zip({'cursor.cur':VALID_CUR,'readme.txt':Buffer.from(hostile)})),/markup or script/,`should reject ${hostile}`);
 }
 // A URL scheme in plain text is inert: nothing renders this file, and it
 // contains no markup. Asserted so the boundary is deliberate, not accidental.
 assert.doesNotThrow(()=>storage.validateZip(zip({'cursor.cur':VALID_CUR,'readme.txt':Buffer.from('see javascript:alert(1) docs')})));
});
test.after(()=>{globalThis.fetch=originalFetch;delete globalThis.__cursorTest;});
