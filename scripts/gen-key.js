'use strict';
// Prints a new random 32-byte key for DATA_ENCRYPTION_KEY. Store it in a secret manager, not in git.
console.log(require('node:crypto').randomBytes(32).toString('base64'));
