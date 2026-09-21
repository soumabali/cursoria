import type {NextConfig} from 'next';
// Security headers are set in worker/index.ts, NOT here.
//
// The deployed Worker runs the vinext build, which does not apply Next.js
// `headers()`. Declaring them here produced two problems: on document
// routes they were silently absent, and on API routes this static CSP was
// applied instead of the Worker's nonce policy, so the header advertised
// 'unsafe-inline' while the markup carried a nonce. One source of truth
// avoids that divergence.
const nextConfig:NextConfig={
 poweredByHeader:false,
};
export default nextConfig;
