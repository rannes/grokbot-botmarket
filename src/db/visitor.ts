import { createHash } from "node:crypto";

export function visitorHash(ip: string, salt: string, date: Date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  return createHash("sha256").update(`${ip}|${salt}|${day}`).digest("hex");
}
