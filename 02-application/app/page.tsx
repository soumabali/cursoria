import {Storefront} from '@/components/storefront';
import {products} from '@/lib/catalog';
import {configured} from '@/lib/db';
export default async function Home(){return <Storefront products={await products()} demo={!configured()}/>}
