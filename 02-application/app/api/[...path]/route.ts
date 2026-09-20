import {NextResponse} from 'next/server';
import {cookies} from 'next/headers';
import {z} from 'zod';
import {sql,configured} from '@/lib/db';
import {body,readLimited,csrf,hash,token,requireUser,limit,origin,encrypt,decrypt,safeError} from '@/lib/security';
import {objectRequest,validateZip} from '@/lib/storage';
import {reconcile} from '@/lib/payments';
export const dynamic='force-dynamic';
const uuid=z.string().uuid();
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const productSchema=z.object({id:uuid.optional(),title:z.string().trim().min(3).max(100),slug:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),description:z.string().trim().min(30).max(5000),category:z.enum(['Soft & cozy','Cute characters','Pixel art','Nature','Minimal']),mode:z.enum(['free','donation','paid']),price:z.number().int().min(0).max(100000000),compatibility:z.string().min(3).max(120),formats:z.string().min(3).max(60),states:z.number().int().min(1).max(100),version:z.string().min(1).max(30),license:z.string().min(10).max(1500),preview_key:z.string().max(250).nullable(),package_key:z.string().max(250).nullable(),published:z.boolean(),rights:z.literal(true)}).refine(v=>v.mode==='free'?v.price===0:v.price>=1000,'Paid packs and donations require at least Rp1,000.');
export async function POST(req:Request,{params}:{params:Promise<{path:string[]}>}){
 try{
 const path=(await params).path.join('/');
 if(!configured())return reply({error:'This is a store preview. Accounts and checkout will open when the store is connected.'},503);
 if(path==='payments/webhook'){const d=await body(req);await reconcile(uuid.parse(d.order_id),d);return reply({received:true});}
 csrf(req);
 if(path==='auth/request'){
 const d=await body(req),email=z.string().trim().email().max(254).parse(d.email).toLowerCase();
 if(!process.env.EMAIL_API_KEY||!process.env.EMAIL_FROM)throw new Error('Email sign-in is not available yet.');
 await limit('email:'+email,3);await limit('email-global',100);
 const raw=token(),returnPath=typeof d.next==='string'&&/^\/products\/[a-z0-9-]+$/.test(d.next)?d.next:'/dashboard';await sql(`INSERT INTO login_tokens(hash,email,expires_at,return_path) VALUES($1,$2,now()+interval '15 minutes',$3)`,[hash(raw),email,returnPath]);
 const link=origin()+'/verify?token='+raw;
 const sent=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.EMAIL_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.EMAIL_FROM,to:email,subject:'Your Cursor Studio sign-in link',text:'Verify your email and sign in to Cursor Studio. This link expires in 15 minutes. Open it and confirm: '+link+'\nIf you did not request this, ignore this email.'})});
 if(!sent.ok){await sql('DELETE FROM login_tokens WHERE hash=$1',[hash(raw)]);throw new Error('We could not send your sign-in email. Please try again later.');}
 return reply({message:'Check your inbox. Your verification link expires in 15 minutes.'});
 }
 if(path==='auth/verify'){
 const d=await body(req),raw=z.string().regex(/^[0-9a-f]{64}$/).parse(d.token),session=token();
 const [r]=await sql(`WITH consumed AS (DELETE FROM login_tokens WHERE hash=$1 AND expires_at>now() RETURNING email,return_path), account AS (INSERT INTO users(email,verified_at,role) SELECT email,now(),CASE WHEN email=$3 THEN 'superadmin' ELSE 'user' END FROM consumed ON CONFLICT(email) DO UPDATE SET verified_at=COALESCE(users.verified_at,now()) WHERE NOT users.disabled RETURNING id), logged AS (INSERT INTO sessions(hash,user_id,expires_at) SELECT $2,id,now()+interval '7 days' FROM account RETURNING user_id) SELECT user_id,consumed.return_path FROM logged CROSS JOIN consumed`,[hash(raw),hash(session),(process.env.SUPERADMIN_EMAIL||'').toLowerCase()]);
 if(!r)throw new Error('This link is invalid or expired. Please request a new one.');
 (await cookies()).set('cursor_session',session,{httpOnly:true,secure:origin().startsWith('https:'),sameSite:'lax',path:'/',maxAge:604800});return reply({redirect:r.return_path});
 }
 if(path==='auth/logout'){const s=(await cookies()).get('cursor_session')?.value;if(s)await sql('DELETE FROM sessions WHERE hash=$1',[hash(s)]);(await cookies()).delete('cursor_session');return reply({redirect:'/'});}
 if(path==='views'){
 const d=await body(req),id=uuid.parse(d.id);let visitor=(await cookies()).get('cursor_visitor')?.value;if(!visitor||!/^[0-9a-f]{64}$/.test(visitor)){visitor=token();(await cookies()).set('cursor_visitor',visitor,{httpOnly:true,secure:origin().startsWith('https:'),sameSite:'lax',maxAge:2592000,path:'/'});}
 await sql(`INSERT INTO product_views(product_id,visitor_hash) SELECT id,$2 FROM products WHERE id=$1 AND published ON CONFLICT DO NOTHING`,[id,hash(visitor)]);return reply({ok:true});
 }
 const u=await requireUser();await limit('actions:'+u.id,300);
 if(path==='checkout'){
 const d=await body(req),id=uuid.parse(d.product_id),requestKey=uuid.parse(d.request_key);
 const [owned]=await sql('SELECT 1 FROM entitlements WHERE user_id=$1 AND product_id=$2 AND active',[u.id,id]);if(owned)return reply({redirect:'/dashboard'});
 const [p]=await sql('SELECT * FROM products WHERE id=$1 AND published',[id]);if(!p?.package_key)throw new Error('This product is not available.');
 let amount=p.price;if(p.mode==='donation')amount=z.number().int().min(p.price).max(100000000).parse(d.amount);
 if(p.mode==='free'){
 await sql(`WITH o AS (INSERT INTO orders(user_id,product_id,creator_id,amount,status,request_key) VALUES($1,$2,$3,0,'paid',$4) ON CONFLICT(user_id,request_key) DO UPDATE SET request_key=EXCLUDED.request_key WHERE orders.product_id=EXCLUDED.product_id RETURNING *) INSERT INTO entitlements(user_id,product_id,order_id) SELECT user_id,product_id,id FROM o ON CONFLICT(user_id,product_id) DO UPDATE SET active=true,order_id=EXCLUDED.order_id`,[u.id,id,p.owner_id,requestKey]);return reply({redirect:'/dashboard'});
 }
 const [settings]=await sql('SELECT * FROM payment_settings WHERE id=1 AND enabled');if(!settings)throw new Error('Payments are not available yet. Please try again later.');
 const [o]=await sql(`INSERT INTO orders(user_id,product_id,creator_id,amount,request_key,payment_key,production) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,request_key) DO UPDATE SET request_key=EXCLUDED.request_key RETURNING *`,[u.id,id,p.owner_id,amount,requestKey,settings.server_key,settings.production]);
 if(o.product_id!==id||o.amount!==amount)throw new Error('Checkout changed. Reload this page and try again.');
 if(o.checkout_url)return reply({redirect:o.checkout_url});
 const host=o.production?'https://app.midtrans.com':'https://app.sandbox.midtrans.com';
 const snap=await fetch(host+'/snap/v1/transactions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Basic '+Buffer.from(decrypt(o.payment_key)+':').toString('base64')},body:JSON.stringify({transaction_details:{order_id:o.id,gross_amount:o.amount},item_details:[{id:p.id,price:o.amount,quantity:1,name:p.title.slice(0,50)}],customer_details:{email:u.email},callbacks:{finish:origin()+'/dashboard?payment=return'},expiry:{unit:'hours',duration:24}})});
 if(!snap.ok)throw new Error('Checkout could not be opened. Check your order in My Library before trying again.');const result=await snap.json();
 if(typeof result.redirect_url!=='string'||!result.redirect_url.startsWith(host+'/'))throw new Error('Unexpected payment response.');
 await sql('UPDATE orders SET checkout_url=$2 WHERE id=$1',[o.id,result.redirect_url]);return reply({redirect:result.redirect_url});
 }
 if(path==='orders/refresh'){const d=await body(req),id=uuid.parse(d.id);const [o]=await sql('SELECT id FROM orders WHERE id=$1 AND user_id=$2',[id,u.id]);if(!o)throw new Error('Order not found.');return reply(await reconcile(id));}
 if(path==='uploads'){
 await requireUser('creator');if(Number(req.headers.get('content-length')||0)>22*1024*1024)throw new Error('File too large.');const uploadBytes=await readLimited(req,22*1024*1024);const form=await new Response(uploadBytes as unknown as BodyInit,{headers:{'Content-Type':req.headers.get('Content-Type')||''}}).formData(),file=form.get('file'),kind=z.enum(['preview','package']).parse(form.get('kind'));
 if(!(file instanceof File)||file.size>(kind==='preview'?5:20)*1024*1024)throw new Error('Preview limit: 5 MB. ZIP limit: 20 MB.');const bytes=Buffer.from(await file.arrayBuffer());let ext='zip',type='application/zip';
 if(kind==='package')validateZip(bytes);else if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){ext='png';type='image/png';}else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255){ext='jpg';type='image/jpeg';}else if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'){ext='webp';type='image/webp';}else throw new Error('Use a PNG, JPEG, or WebP preview.');
 const key=u.id+'/'+token()+'.'+ext;await objectRequest('PUT',key,bytes,type);await sql('INSERT INTO uploads(owner_id,object_key,kind,size) VALUES($1,$2,$3,$4)',[u.id,key,kind,file.size]);return reply({key});
 }
 if(path==='products/save'){
 await requireUser('creator');const d=productSchema.parse(await body(req));
 let owner=u.id,existing:Record<string,string|null>|undefined;if(d.id){const [p]=await sql('SELECT owner_id,preview_key,package_key FROM products WHERE id=$1 AND (owner_id=$2 OR $3)',[d.id,u.id,u.role==='superadmin']);if(!p)throw new Error('Product not found.');owner=p.owner_id;existing=p;}
 for(const [key,kind] of [[d.preview_key,'preview'],[d.package_key,'package']])if(key&&key!==existing?.[kind+'_key']){const [a]=await sql('SELECT id FROM uploads WHERE object_key=$1 AND kind=$2 AND (owner_id=$3 OR owner_id=$4)',[key,kind,owner,u.id]);if(!a)throw new Error('Upload a valid product file.');}
 if(d.published&&(!d.preview_key||!d.package_key))throw new Error('Add a preview and cursor ZIP before publishing.');
 const values=[d.title,d.slug,d.description,d.category,d.mode,d.price,d.compatibility,d.formats,d.states,d.version,d.license,d.preview_key,d.package_key,d.published];
 if(d.id)await sql(`UPDATE products SET title=$1,slug=$2,description=$3,category=$4,mode=$5,price=$6,compatibility=$7,formats=$8,states=$9,version=$10,license=$11,preview_key=$12,package_key=$13,published=$14,updated_at=now() WHERE id=$15 AND (owner_id=$16 OR $17)`,[...values,d.id,u.id,u.role==='superadmin']);
 else await sql(`INSERT INTO products(title,slug,description,category,mode,price,compatibility,formats,states,version,license,preview_key,package_key,published,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,[...values,u.id]);
 await sql('INSERT INTO audit_log(actor_id,action,target) VALUES($1,$2,$3)',[u.id,'product.save',d.slug]);return reply({message:'Product saved.'});
 }
 if(path==='creators/save'){
 await requireUser('superadmin');const d=z.object({email:z.string().trim().email().max(254),name:z.string().trim().min(1).max(100),disabled:z.boolean().default(false)}).parse(await body(req));
 const [r]=await sql(`INSERT INTO users(email,name,role,disabled) VALUES($1,$2,'creator',$3) ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name,role='creator',disabled=EXCLUDED.disabled WHERE users.role<>'superadmin' RETURNING id`,[d.email.toLowerCase(),d.name,d.disabled]);if(!r)throw new Error('Superadmin accounts cannot be changed here.');
 await sql('INSERT INTO audit_log(actor_id,action,target) VALUES($1,$2,$3)',[u.id,'creator.save',r.id]);return reply({message:'Creator saved. They can verify their email from the sign-in page.'});
 }
 if(path==='settings/save'){
 await requireUser('superadmin');const d=z.object({server_key:z.string().max(250).optional(),production:z.boolean(),enabled:z.boolean()}).parse(await body(req));const [old]=await sql('SELECT * FROM payment_settings WHERE id=1');
 if(!d.server_key&&!old)throw new Error('Enter a Midtrans Server Key.');if(!d.server_key&&old.production!==d.production)throw new Error('Enter the matching Server Key when switching environments.');
 await sql(`INSERT INTO payment_settings(id,server_key,production,enabled) VALUES(1,$1,$2,$3) ON CONFLICT(id) DO UPDATE SET server_key=EXCLUDED.server_key,production=EXCLUDED.production,enabled=EXCLUDED.enabled,updated_at=now()`,[d.server_key?encrypt(d.server_key):old.server_key,d.production,d.enabled]);
 await sql('INSERT INTO audit_log(actor_id,action,target) VALUES($1,$2,$3)',[u.id,'midtrans.settings','1']);return reply({message:'Payment settings saved. The Server Key is encrypted.'});
 }
 return reply({error:'Not found.'},404);
 }catch(e){return reply({error:e instanceof z.ZodError?'Please check the form fields and try again.':safeError(e)},400);}
}
export async function GET(req:Request,{params}:{params:Promise<{path:string[]}>}){
 try{const path=(await params).path;
 if(path[0]==='preview'&&path[1]){const [p]=await sql('SELECT preview_key FROM products WHERE id=$1 AND published',[uuid.parse(path[1])]);if(!p?.preview_key)return new Response('Not found',{status:404});const r=await objectRequest('GET',p.preview_key);return new Response(r.body,{headers:{'Content-Type':r.headers.get('Content-Type')||'image/png','Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff'}});}
 if(path[0]==='download'&&path[1]){const u=await requireUser();await limit('download:'+u.id,100);const [p]=await sql(`SELECT p.package_key,p.slug FROM entitlements e JOIN products p ON p.id=e.product_id WHERE e.user_id=$1 AND p.id=$2 AND e.active`,[u.id,uuid.parse(path[1])]);if(!p?.package_key)return reply({error:'This pack is not in your library.'},403);const r=await objectRequest('GET',p.package_key);return new Response(r.body,{headers:{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="${p.slug}.zip"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
 return reply({error:'Not found.'},404);
 }catch(e){return reply({error:safeError(e)},403);}
}
