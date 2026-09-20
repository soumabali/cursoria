import Link from 'next/link';
import type {Metadata} from 'next';
import {Nav} from '@/components/nav';
import {user} from '@/lib/security';
import './globals.css';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:{default:'Cursor Studio — Make every click more you',template:'%s | Cursor Studio'},description:'Discover expressive custom cursor packs. Explore free collections, support independent creators, and find your next desktop favorite.',robots:process.env.STORE_PUBLIC==='true'?{index:true,follow:true}:{index:false,follow:false},icons:{icon:'/favicon.svg'}};
export default async function RootLayout({children}:{children:React.ReactNode}){const u=await user();return <html lang="en"><body><a className="skip-link" href="#main">Skip to content</a><Nav signedIn={!!u} role={u?.role}/><main id="main">{children}</main><footer className="footer"><Link className="brand" href="/">↖ cursor<span className="brand-light">studio</span></Link><p>Small details. A more personal desktop.</p><div><Link href="/guide">Installation guide</Link><Link href="/policies">Store policies</Link><span>Prices in IDR</span></div><small>© {new Date().getFullYear()} Cursor Studio. Made for the little things.</small></footer></body></html>}
