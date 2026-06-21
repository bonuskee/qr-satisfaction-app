import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";

const password = String(process.env.NEW_ADMIN_PASSWORD || "");

if (!password) {
  throw new Error("Set NEW_ADMIN_PASSWORD before running this command.");
}

const salt = randomBytes(16);
const derivedKey = (await promisify(scrypt)(password, salt, 64)) as Buffer;

console.log(`ADMIN_PASSWORD_HASH=scrypt$${salt.toString("hex")}$${derivedKey.toString("hex")}`);
