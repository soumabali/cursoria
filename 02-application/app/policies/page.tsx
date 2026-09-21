export const metadata={title:'Store policies',description:'Pricing, licensing, refunds, and how Cursor Studio handles your account data.'};
export default function Policies(){
const retention:[string,string,string][]=[
['Account: email, name, sign-in sessions','Kept while your account is active','Erased on deletion'],
['Order records: pack, amount, status, date','Kept as accounting records','Kept, no longer linked to your identity'],
['Download entitlements','Kept while your account is active','Access ends on deletion'],
['Sign-in links (one-time tokens)','Up to 20 minutes, single use','Deleted on use'],
['Product visit counts','Random first-party identifier, once per product per day','Not linked to your account'],
['Payment details (card, bank)','Never stored by this store','Handled entirely by Midtrans'],
['A one-way hash of your email','Not stored for active accounts','Kept, to block sign-in with a deleted address'],
];
return <article className="content-page prose">
<div className="eyebrow">CLEAR BEFORE YOU CLICK</div>
<h1>Store policies</h1>
<p>Cursor Studio sells digital cursor packs from individual creators. Review each pack’s compatibility, contents, and license before acquiring it.</p>

<h2>Pricing and delivery</h2>
<p>All prices are in Indonesian rupiah (IDR). Free packs cost Rp0. Donation packs require at least the displayed minimum. Paid packs have a fixed price. Email verification is required for every acquisition. Payment confirmation is handled on the server before download access is granted.</p>

<h2>License</h2>
<p>The license on each product page governs use of that pack. Unless it states otherwise, packs are for personal use and cannot be redistributed, resold, or presented as your own work.</p>
<p>Packs are supplied as downloadable files. Because they are digital goods delivered instantly, you are asked to preview the pack description and contents before buying. Nothing here removes a right you have under Indonesian consumer protection law.</p>

<h2>Refunds and download access</h2>
<p>To request a refund, email us using the contact address below with the order number and the reason for the request. We aim to answer within 3 working days, and refunds are returned to the original payment method through Midtrans.</p>
<p>A confirmed full refund removes future download access for that order. Partial refunds pause access while the request is reviewed. This is an interim procedure written by the developer; it is replaced by the operator’s published procedure before real orders are accepted.</p>

<h2>Account and privacy</h2>
<p>We store your email, verification status, sessions, orders, and download entitlements so we can operate your account and prove your purchases. Creators can see statistics and transactions for their own work. Superadmins can manage the store.</p>

<h3>What is kept, and for how long</h3>
<div className="table-wrap"><table className="data-table">
<thead><tr><th>Data</th><th>While active</th><th>After you delete your account</th></tr></thead>
<tbody>{retention.map(([d,a,b])=><tr key={d}><td>{d}</td><td>{a}</td><td>{b}</td></tr>)}</tbody>
</table></div>

<h3>Deleting your account</h3>
<p>You can delete your own account from <strong>My Library</strong> at any time. Deletion is immediate and irreversible: your email address and name are erased, every session and pending sign-in link is revoked, and your download access ends. You are signed out straight away.</p>
<p>The address you deleted with is remembered so that it cannot be used to sign in again, which is what makes the deletion stick. We store only a one-way hash of it for that purpose, not the address itself, so the check cannot be used to recover your email.</p>
<p>Order records are retained, because a seller must keep records of sales for accounting and tax purposes. They are kept in a form that no longer identifies you: the order keeps its amount, date, and status, but the account it belonged to is replaced with a non-identifying value. If you delete your account you lose access to download links for packs you previously acquired, so download anything you want to keep first.</p>

<h3>Cookies and visit counts</h3>
<p>Signing in sets one first-party session cookie. Product pages use a random first-party identifier so we can count how often a pack is viewed; it is counted once per product per day and is not linked to your account. We do not use advertising or third-party tracking cookies.</p>
<p>Midtrans processes payments. Card details are never stored by this application.</p>

<h2>Security</h2>
<p>Passwords are not used: sign-in uses a single-use emailed link. Traffic is served over HTTPS with a strict content security policy. If you believe you have found a security problem, please report it to the contact address rather than testing it against other people’s accounts.</p>

<h2>Contact</h2>
<p>Questions about an order, a refund, or your data: <strong>CONTACT_EMAIL</strong>.</p>

<h2>Operator details before launch</h2>
<p>The operator must replace the contact address above with a monitored mailbox, and publish the legal business name and address and the governing law that applies, before the store accepts real orders. The refund procedure and the retention periods in the table are the developer’s defaults and must be confirmed or corrected by the operator. Sample products are demonstrations and cannot be purchased.</p>
</article>}
