/**
 * stripQuotedReply — show only what was written THIS turn, not the whole thread
 * quoted back. Email replies carry the entire prior conversation as ">"-prefixed
 * quote chains ("On <date> <name> wrote: > … >> …"); the customer page repeated
 * all of it on every message (2026-06-22 Jeff: 「不需要一直重複原本的話」).
 *
 * Strategy:
 *   1. Cut everything from the first reply boundary ("On … wrote:" /
 *      "-----Original Message-----").
 *   2. Drop any remaining quoted (">") lines, collapse blank runs.
 *   3. Fallback for a fully-quoted body (the new text itself arrived quoted):
 *      de-quote first, then cut at the boundary — recovers the top new content.
 *
 * Pure + tested. Applied at display time so it cleans every existing + future
 * message without touching stored data.
 */

function cutAtReplyBoundary(s: string): string {
  let t = s;
  const onWrote = t.search(/^[ \t>]*On\b.{0,200}?\bwrote:\s*$/m);
  if (onWrote >= 0) t = t.slice(0, onWrote);
  const original = t.search(/^[ \t>]*-{2,}\s*Original Message\s*-{2,}/im);
  if (original >= 0) t = t.slice(0, original);
  return t;
}

export function stripQuotedReply(body: string | null | undefined): string {
  if (!body) return "";
  const norm = body.replace(/\r\n/g, "\n");

  // Primary: cut the chain, then drop any leftover quoted lines.
  const primary = cutAtReplyBoundary(norm)
    .split("\n")
    .filter((l) => !/^\s*>/.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (primary) return primary;

  // Fallback: the whole body arrived quoted → de-quote, then cut at the boundary
  // so we still recover the top (the actual new message).
  const dequoted = norm
    .split("\n")
    .map((l) => l.replace(/^\s*>+\s?/, ""))
    .join("\n");
  return cutAtReplyBoundary(dequoted).replace(/\n{3,}/g, "\n\n").trim();
}
