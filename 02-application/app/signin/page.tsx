import {SignIn} from '@/components/actions';
import {configured} from '@/lib/db';
export const metadata={title:'Sign in',robots:{index:false,follow:false}};
export default async function SignInPage({searchParams}:{searchParams:Promise<{next?:string}>}){const nextPath=(await searchParams).next||'/dashboard';return <section className="auth-wrap"><div className="form-card"><div className="eyebrow">YOUR LITTLE COLLECTION</div><h1>Welcome to your<br/>happy place.</h1><p>One account for all your favorite cursor packs.</p><SignIn nextPath={nextPath} available={configured()&&!!process.env.EMAIL_API_KEY&&!!process.env.EMAIL_FROM}/></div></section>}
