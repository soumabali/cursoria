import 'server-only';
import { createHash,randomBytes,createCipheriv,createDecipheriv,timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { sql } from './db';
export const origin=()=>process.env.APP_URL || 'https://cursor-studio.well-fern-6064.chatgpt.site';
export const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
export const token=()=>randomBytes(32).toString('hex');
export function equal(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export function csrf(req:Request){if(req.headers.get('origin')!==origin())throw new Error('Invalid request origin.');}
export async function readLimited(req:Request,max:number){if(Number(req.headers.get('content-length')||0)>max)throw new Error('Request too large.');const reader=req.body?.getReader();if(!reader)return new Uint8Array();const chunks:Uint8Array[]=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new Error('Request too large.');}chunks.push(value);}}finally{reader.releaseLock();}const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.byteLength;}return result;}
export async function body(req:Request){return JSON.parse(new TextDecoder().decode(await readLimited(req,20000)));}
export async function limit(key:string,max=5){const [r]=await sql(`INSERT INTO rate_limits(key,hits,expires_at) VALUES($1,1,now()+interval '1 hour') ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.hits+1 END,expires_at=CASE WHEN rate_limits.expires_at<now() THEN now()+interval '1 hour' ELSE rate_limits.expires_at END RETURNING hits`,[hash(key)]);if(r.hits>max)throw new Error('Too many attempts. Please try again in an hour.');}
export async function user(){const s=(await cookies()).get('cursor_session')?.value;if(!s||!process.env.DATABASE_URL)return null;const [u]=await sql(`SELECT u.id,u.email,u.name,u.role,u.verified_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=$1 AND s.expires_at>now() AND NOT u.disabled`,[hash(s)]);return u||null;}
export async function requireUser(role?:'creator'|'superadmin'){const u=await user();if(!u?.verified_at)throw new Error('Sign in with a verified email to continue.');if(role==='superadmin'&&u.role!=='superadmin')throw new Error('Access denied.');if(role==='creator'&&!['creator','superadmin'].includes(u.role))throw new Error('Access denied.');return u;}
function key(){const k=process.env.SETTINGS_ENCRYPTION_KEY;if(!k||! /^[0-9a-f]{64}$/i.test(k))throw new Error('Payment configuration is unavailable.');return Buffer.from(k,'hex');}
export function encrypt(value:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);return Buffer.concat([iv,cipher.update(value),cipher.final(),cipher.getAuthTag()]).toString('base64');}
export function decrypt(value:string){const b=Buffer.from(value,'base64'),d=createDecipheriv('aes-256-gcm',key(),b.subarray(0,12));d.setAuthTag(b.subarray(-16));return Buffer.concat([d.update(b.subarray(12,-16)),d.final()]).toString();}
export function safeError(error:unknown){return error instanceof Error?error.message:'Something went wrong. Please try again.';}
