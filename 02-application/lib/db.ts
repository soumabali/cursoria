import 'server-only';
// PostgreSQL over Neon's HTTPS SQL endpoint works in Node.js and Workers.
export const configured = () => Boolean(process.env.DATABASE_URL);
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export async function sql<T=Record<string, any>>(query:string, params:unknown[]=[]):Promise<T[]> {
 const connection=process.env.DATABASE_URL;
 if(!connection) throw new Error('The store is not connected yet. Please try again later.');
 const host=new URL(connection).hostname;
 if(!host.endsWith('.neon.tech')) throw new Error('Configure a Neon PostgreSQL connection URL.');
 const response=await fetch(`https://${host}/sql`,{method:'POST',headers:{'Content-Type':'application/json','Neon-Connection-String':connection,'Neon-Raw-Text-Output':'false','Neon-Array-Mode':'false'},body:JSON.stringify({query,params}),cache:'no-store'});
 if(!response.ok){console.error('Database request failed',response.status);throw new Error('The store is temporarily unavailable. Please try again.');}
 const result=await response.json(); return result.rows as T[];
}
