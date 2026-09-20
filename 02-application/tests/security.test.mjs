import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transpileModule,ModuleKind,ScriptTarget} from 'typescript';
import {createHash} from 'node:crypto';
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
test.after(()=>{globalThis.fetch=originalFetch;delete globalThis.__cursorTest;});
