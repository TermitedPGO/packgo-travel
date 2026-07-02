/**
 * slashCommands — pure data + logic for the composer "/" command menu
 * (2026-07-01, Jeff:「slash 指令其實也ok 然後有操作說明 就跟 claude 那也不需要
 * 新增客人按鈕」). The 新增客人 button is gone; typing "/" in the chat composer
 * pops a command menu instead (打字驅動,不要按鈕 — requirements §六.1).
 *
 * Pure module: no React, no hooks, no direct i18n import. Callers pass a
 * `resolve(key)` (usually the `t` from useLocale) so this stays unit-testable
 * in vitest env=node. All visible strings live in zh-TW.ts / en.ts under
 * admin.customers.slash.* — nothing hardcoded here.
 */

export type SlashCommandId =
  | "addCustomer"
  | "collect"
  | "followup"
  | "note"
  | "createOrder"
  | "merge"
  | "help"

export type SlashCommandDef = {
  id: SlashCommandId
  /** i18n key — command name shown in the menu row */
  nameKey: string
  /** i18n key — one-line 操作說明 shown next to the name */
  descKey: string
  /** i18n key of the template inserted into the composer; null = no insert
   * (the 說明 command opens the help panel instead) */
  templateKey: string | null
  /** true = acts on the pinned customer, hidden when nobody is pinned */
  requiresCustomer: boolean
}

const key = (id: SlashCommandId, leaf: "name" | "desc" | "template") =>
  `admin.customers.slash.${id}.${leaf}`

export const SLASH_COMMANDS: SlashCommandDef[] = [
  {
    id: "addCustomer",
    nameKey: key("addCustomer", "name"),
    descKey: key("addCustomer", "desc"),
    templateKey: key("addCustomer", "template"),
    requiresCustomer: false,
  },
  {
    id: "collect",
    nameKey: key("collect", "name"),
    descKey: key("collect", "desc"),
    templateKey: key("collect", "template"),
    requiresCustomer: true,
  },
  {
    id: "followup",
    nameKey: key("followup", "name"),
    descKey: key("followup", "desc"),
    templateKey: key("followup", "template"),
    requiresCustomer: true,
  },
  {
    id: "note",
    nameKey: key("note", "name"),
    descKey: key("note", "desc"),
    templateKey: key("note", "template"),
    requiresCustomer: true,
  },
  {
    id: "createOrder",
    nameKey: key("createOrder", "name"),
    descKey: key("createOrder", "desc"),
    templateKey: key("createOrder", "template"),
    requiresCustomer: true,
  },
  {
    id: "merge",
    nameKey: key("merge", "name"),
    descKey: key("merge", "desc"),
    templateKey: key("merge", "template"),
    requiresCustomer: true,
  },
  {
    id: "help",
    nameKey: key("help", "name"),
    descKey: key("help", "desc"),
    templateKey: null,
    requiresCustomer: false,
  },
]

/** The menu only tracks a single "/" token being typed: the input must start
 * with "/" and still be one line (a pasted multi-line message starting with
 * "/" is a message, not a command). */
export function isSlashQuery(input: string): boolean {
  return input.startsWith("/") && !input.includes("\n")
}

/**
 * Commands matching the current composer input.
 * - not a slash token → [] (menu closed)
 * - no pinned customer → only the commands that work without one (新增客人/說明)
 * - text after "/" filters live against BOTH the command name and its 說明,
 *   case-insensitive (so /follow and /跟進 both hit 跟進日 in either locale)
 */
export function filterSlashCommands(
  input: string,
  hasCustomer: boolean,
  resolve: (key: string) => string,
): SlashCommandDef[] {
  if (!isSlashQuery(input)) return []
  const q = input.slice(1).trim().toLowerCase()
  return SLASH_COMMANDS.filter((c) => hasCustomer || !c.requiresCustomer).filter(
    (c) =>
      !q ||
      resolve(c.nameKey).toLowerCase().includes(q) ||
      resolve(c.descKey).toLowerCase().includes(q),
  )
}

export type SlashSelection =
  | { kind: "insert"; text: string }
  | { kind: "help" }

/** What picking a command does: insert its template into the composer
 * (replacing the "/" token, caret parked at the end — caller's job), or open
 * the 操作說明 panel for the template-less 說明 command. */
export function resolveSlashSelection(
  cmd: SlashCommandDef,
  resolve: (key: string) => string,
): SlashSelection {
  if (cmd.templateKey === null) return { kind: "help" }
  return { kind: "insert", text: resolve(cmd.templateKey) }
}

/** Wrap-around keyboard navigation for the menu (ArrowUp / ArrowDown). */
export function moveSlashIndex(current: number, delta: 1 | -1, count: number): number {
  if (count <= 0) return 0
  return (current + delta + count) % count
}
