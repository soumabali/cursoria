import 'server-only';
import {createHash} from 'node:crypto';
import {sql} from './db';
import {decrypt,equal} from './security';
export function paymentHost(production:boolean){return production?'https://api.midtrans.com':'https://api.sandbox.midtrans.com';}
export async function reconcile(id:string,notification?:Record<string,unknown>){
 const [o]=await sql('SELECT * FROM orders WHERE id=$1',[id]);if(!o?.payment_key)throw new Error('Order not found.');
 const key=decrypt(o.payment_key);
 if(notification){const expected=createHash('sha512').update(String(notification.order_id)+String(notification.status_code)+String(notification.gross_amount)+key).digest('hex');if(!equal(expected,String(notification.signature_key||'')))throw new Error('Invalid payment signature.');}
 const r=await fetch(`${paymentHost(o.production)}/v2/${id}/status`,{headers:{Authorization:'Basic '+Buffer.from(key+':').toString('base64')},cache:'no-store'});
 if(!r.ok)throw new Error('Payment status is not available yet.');const s=await r.json();
 if(s.order_id!==id||s.currency!=='IDR'||!Number.isFinite(Number(s.gross_amount))||Number(s.gross_amount)!==o.amount)throw new Error('Payment details do not match.');
 const state=s.transaction_status;let next='pending';
 if(state==='refund')next='refunded';else if(state==='partial_refund')next='review';else if(['settlement','capture'].includes(state)&&(!s.fraud_status||s.fraud_status==='accept'))next='paid';else if(['deny','cancel','expire','failure'].includes(state))next='failed';
 const eventHash=createHash('sha256').update(JSON.stringify([id,state,s.fraud_status,s.refund_amount,s.transaction_id])).digest('hex');
 await sql(`WITH locked AS MATERIALIZED (SELECT * FROM orders WHERE id=$1 FOR UPDATE), changed AS (UPDATE orders o SET status=CASE WHEN l.status='refunded' THEN 'refunded' WHEN $2='refunded' THEN 'refunded' WHEN l.status='review' THEN 'review' WHEN $2='review' THEN 'review' WHEN l.status='paid' AND $2 IN ('pending','failed') THEN 'paid' ELSE $2 END,updated_at=now() FROM locked l WHERE o.id=l.id RETURNING o.*), logged AS (INSERT INTO payment_events(order_id,status,event_hash) VALUES($1,$2,$3) ON CONFLICT(event_hash) DO NOTHING), granted AS (INSERT INTO entitlements(user_id,product_id,order_id,active) SELECT user_id,product_id,id,true FROM changed WHERE status='paid' ON CONFLICT(user_id,product_id) DO UPDATE SET active=true,order_id=EXCLUDED.order_id WHERE NOT entitlements.active RETURNING user_id) UPDATE entitlements e SET active=false FROM changed c WHERE e.order_id=c.id AND c.status IN ('refunded','review')`,[id,next,eventHash]);
 return {status:next};
}
