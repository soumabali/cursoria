import 'server-only';
import {sql} from './db';
import {origin} from './security';

/**
 * One place that knows how to send mail, so the sign-in link and the receipt
 * cannot drift apart. Before this, the Resend call was inline in the auth
 * route and a second copy would have been the obvious way to add receipts.
 *
 * Every function here returns a boolean and never throws. That is deliberate:
 * the callers are a webhook and a checkout handler whose real job is to record
 * a payment. Email failing must not roll that back or turn it into an error
 * the payment provider will retry forever.
 */

/** True when mail can actually be sent. Both vars are required by Resend. */
export function emailConfigured(){return !!(process.env.EMAIL_API_KEY&&process.env.EMAIL_FROM);}

async function send(to:string,subject:string,text:string){
 if(!emailConfigured())return false;
 try{
  const r=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+process.env.EMAIL_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.EMAIL_FROM,to,subject,text})});
  return r.ok;
 }catch{return false;}
}

/** The sign-in link. Throws only in the sense of a false return; caller decides. */
export async function sendSignInLink(to:string,link:string){
 return send(to,'Your Cursor Studio sign-in link','Verify your email and sign in to Cursor Studio. This link expires in 15 minutes. Open it and confirm: '+link+'\nIf you did not request this, ignore this email.');
}

/**
 * Receipt for an entitlement the buyer now owns.
 *
 * Written for a buyer who is anxious about a digital purchase, so it states
 * the three things they actually need: what they bought, how much it cost,
 * and where it is. It deliberately does not promise a refund, because the
 * refund path is a manual decision by the operator -- see the policies page,
 * which is where the procedure lives.
 *
 * Sent only once per order. The caller passes the order id and the guard here
 * checks status AND that no receipt has gone out, so a duplicate webhook (or a
 * status poll) cannot produce a second receipt.
 */
export async function sendReceipt(orderId:string){
 if(!emailConfigured())return false;
 // Claim the send atomically before sending. Two concurrent reconciliations
 // would otherwise both read receipt_sent_at as NULL and both send. The
 // UPDATE is the lock: only one caller gets a row back.
 const [claimed]=await sql(`UPDATE orders o SET receipt_sent_at=now()
  FROM users u, products p
  WHERE o.id=$1 AND u.id=o.user_id AND p.id=o.product_id
    AND o.status='paid' AND o.receipt_sent_at IS NULL
  RETURNING u.email, p.title, p.slug, o.amount, o.status, o.created_at`,[orderId]);
 if(!claimed)return false;

 const amount=Number(claimed.amount);
 const lines=[
  'Thanks for your purchase from Cursor Studio.',
  '',
  claimed.title+' — '+(amount===0?'Free':('Rp'+amount.toLocaleString('en-US'))),
  'Order '+String(orderId).slice(0,8),
  'Date '+new Date(claimed.created_at as string).toISOString().slice(0,10),
  '',
  'Your download is in My Library: '+origin()+'/dashboard',
  'Sign in with this address if you are not already signed in.',
  '',
  'Keep this email as your record of the purchase. A full refund cancels future download access.',
 ];
 const ok=await send(String(claimed.email),'Your Cursor Studio receipt — '+claimed.title,lines.join('\n'));
 if(!ok){
  // Release the claim so a later attempt can retry. Without this a transient
  // provider outage would permanently mark the order as receipted.
  await sql('UPDATE orders SET receipt_sent_at=NULL WHERE id=$1',[orderId]).catch(()=>{});
  return false;
 }
 return true;
}
