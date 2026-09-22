// Prints the current admin 2FA code for the seeded dev admins.
import { totpNow } from '../lib/security.js';
import { DEV_ADMIN_TOTP_SECRET } from '../db/seed.js';

const secret = process.argv[2] || DEV_ADMIN_TOTP_SECRET;
const left = 30 - (Math.floor(Date.now() / 1000) % 30);
console.log(`${totpNow(secret)}  (valid ~${left}s more; secret ${secret})`);
