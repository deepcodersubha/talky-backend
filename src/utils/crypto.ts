import crypto from "crypto";

// Unambiguous alphanumeric characters (excluding 0, O, 1, I, L)
const CHARSET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export class CryptoUtils {
  /**
   * Generates a cryptographically secure random alphanumeric code of specified length.
   */
  static generatePairingCode(length = 6): string {
    const bytes = crypto.randomBytes(length);
    let code = "";
    for (let i = 0; i < length; i++) {
      const index = bytes[i] % CHARSET.length;
      code += CHARSET[index];
    }
    return code;
  }

  /**
   * Hashes a pairing code using SHA-256 for secure database storage.
   */
  static hashCode(code: string): string {
    return crypto
      .createHash("sha256")
      .update(code.trim().toUpperCase())
      .digest("hex");
  }
}
