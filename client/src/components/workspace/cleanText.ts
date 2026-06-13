/**
 * cleanDisplayText — strip artifacts from stored customer/agent content before
 * showing it in the admin UI. Two kinds of leak (both 2026-06-13):
 *   1. the prompt-injection guard wrapper <untrusted_input> (LLM-only, must
 *      never render) — old inbound records stored the wrapped body.
 *   2. markdown markers (**bold**, # headers, `code`) that leaked into
 *      plain-text drafts on cards generated BEFORE stripMarkdownForEmail
 *      shipped — the customer never sees these (the send path strips them),
 *      but the card preview did.
 *
 * Display-only. The authoritative cleanup of the actually-sent reply is
 * server-side `stripMarkdownForEmail` (server/_core/plainTextReply.ts); this
 * mirrors its visible-marker handling so old stored text reads clean too.
 */
export function cleanDisplayText(raw: string | null | undefined): string {
  return (raw || "")
    // injection-guard wrappers
    .replace(/<\/?untrusted_input>/gi, "")
    .replace(/<\/?CUSTOMER_RAW_EMAIL>/gi, "")
    // markdown emphasis / headers / inline code
    .replace(/\*\*([^\n]+?)\*\*/g, "$1")
    .replace(/__([^\n]+?)__/g, "$1")
    .replace(/`([^`\n]+?)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    // collapse the blank lines left behind
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
