import anchors from './authority-roots.json';
import type { TrustAnchors } from './cert';

/**
 * Trust anchors compiled into the app.
 *
 *  - `roots`: public keys of the offline root key(s) allowed to certify authority accounts.
 *    `node scripts/authority-ca.js init` creates a root key and adds its public half here.
 *    Only public keys belong in this file – the root secret never enters the repository.
 *  - `revokedSerials` / `revokedKeys`: deny-list for certificates that must stop working before
 *    they expire. It only reaches devices with an app update, so during an outage revocation is
 *    in practice "wait for the certificate to expire" – keep validity periods short.
 */
export const TRUST_ANCHORS: TrustAnchors = anchors;
