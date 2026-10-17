import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";

const DEFAULT_N = Number(process.env.SCRYPT_N ?? 32768);
const R = 8;
const P = 1;
const KEYLEN = 32;

function scryptAsync(secret: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(secret, salt, KEYLEN, { N, r, p, maxmem: 128 * N * r * 2 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Format: scrypt$N$r$p$salt$hash — parameters are stored so they can be raised later. */
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(secret, salt, DEFAULT_N, R, P);
  return `scrypt$${DEFAULT_N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scryptAsync(secret, Buffer.from(salt, "base64"), Number(n), Number(r), Number(p));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Hash used to spend the same time when the profile does not exist. */
let dummy: Promise<string> | undefined;
export function dummyHash(): Promise<string> {
  return (dummy ??= hashSecret("000000-dummy"));
}

export const newToken = (): string => randomBytes(32).toString("base64url");
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/** Code accepté à la CONNEXION : ancien code de 6 caractères visibles (chiffres, lettres, symboles), ou code numérique de 6 à 8 chiffres. */
export const SECRET_PATTERN = /^(?:[^\s\p{C}]{6}|\d{7,8})$/u;
export const isValidSecret = (s: string): boolean => SECRET_PATTERN.test(s);

/** A NEW code (installation, new profile, change of code) is 6 to 8 digits (leading zeros kept), chosen by hand and typed twice. Existing codes
 *  with letters or symbols keep working at login (SECRET_PATTERN) ; they are never converted nor rejected, only replaced when somebody sets a new code. */
export const NEW_SECRET_PATTERN = /^\d{6,8}$/;
/** Message unique (application, serveur, site) pour un nouveau code invalide. */
export const NEW_SECRET_RULE = "Le code d'accès doit contenir entre 6 et 8 chiffres";
export const isValidNewSecret = (s: string): boolean => NEW_SECRET_PATTERN.test(s);

export function isWeakSecret(s: string): boolean {
  if (/^(.)\1{5,7}$/u.test(s)) return true; // même caractère répété sur toute la longueur
  if (!/^\d{6,8}$/.test(s)) return false;
  const d = [...s].map(Number);
  const step = (d[1] ?? 0) - (d[0] ?? 0);
  return Math.abs(step) === 1 && d.every((v, i) => i === 0 || v - (d[i - 1] ?? 0) === step); // 123456, 654321, 1234567, 87654321…
}

export function generateSecret(): string {
  for (;;) {
    const s = String(randomInt(0, 1_000_000)).padStart(6, "0");
    if (!isWeakSecret(s)) return s;
  }
}

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sans I, L, O, 0, 1
export function generateFamilyCode(): string {
  return Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}
