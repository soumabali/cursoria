export const dynamic='force-dynamic';
import {origin} from '@/lib/security';
export default function robots(){return process.env.STORE_PUBLIC==='true'?{rules:{userAgent:'*',allow:['/','/api/preview/'],disallow:['/api/','/dashboard','/admin','/signin','/verify']},sitemap:origin()+'/sitemap.xml'}:{rules:{userAgent:'*',disallow:['/','/api/preview/']}};}
