"use client";
export default function ErrorPage({reset}:{reset:()=>void}){return <section className="content-page empty-state"><h1>We could not load this page.</h1><p>The store may be temporarily unavailable. Please try again.</p><button className="button primary" onClick={reset}>Try again</button></section>}
