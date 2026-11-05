import "server-only";
import { constants, createDecipheriv, privateDecrypt } from "node:crypto";

/** Opens a saved CRM password (RSA-OAEP wrapped AES-256-GCM key, bound to the credential id). */
export function decryptCrmPassword(hex: string, id: string): string {
  const pem = process.env.CRM_PRIVATE_KEY;
  if (!pem) throw new Error("Password key is not configured.");
  const buf = Buffer.from(hex.replace(/^\\x/, ""), "hex");
  const aesKey = privateDecrypt(
    { key: pem.replace(/\\n/g, "\n"), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    buf.subarray(0, 512),
  );
  const decipher = createDecipheriv("aes-256-gcm", aesKey, buf.subarray(512, 524));
  decipher.setAAD(Buffer.from(id));
  decipher.setAuthTag(buf.subarray(buf.length - 16));
  return Buffer.concat([decipher.update(buf.subarray(524, buf.length - 16)), decipher.final()]).toString("utf8");
}
