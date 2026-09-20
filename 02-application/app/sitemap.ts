export const dynamic='force-dynamic';
import {products} from '@/lib/catalog';
import {origin} from '@/lib/security';
export default async function sitemap(){if(process.env.STORE_PUBLIC!=='true')return [];return [{url:origin(),changeFrequency:'weekly' as const,priority:1},{url:origin()+'/guide'},...(await products()).filter(p=>!p.demo).map(p=>({url:origin()+'/products/'+p.slug,changeFrequency:'weekly' as const,priority:.8}))];}
