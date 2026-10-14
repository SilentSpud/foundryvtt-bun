/** Hash an admin access key the way Foundry stores it in admin.txt. */

import { pbkdf2Sync } from "node:crypto";

const DIGEST = "sha512";
const ITERATIONS = 1000;
const KEY_LENGTH = 64;
// Foundry's built-in default salt.
const DEFAULT_SALT = "17c4f39053ac5a50d5797c665ad1f4e6";

export function hashAdminKey(plaintext: string, salt?: string | null): string {
    return pbkdf2Sync(
        plaintext.trim(),
        salt || DEFAULT_SALT,
        ITERATIONS,
        KEY_LENGTH,
        DIGEST,
    ).toString("hex");
}
