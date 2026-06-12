export type Scope = "arin" | "arch" | "intr" | "wha";

export interface ProjectMeta {
  scope: Scope;
  project_code: string;
  project_name: string;
  client_name: string | null;
  site_address: string | null;
  search_aliases: string[];
}

const PREFIX_TO_SCOPE: Array<{ re: RegExp; scope: Scope }> = [
  { re: /^AR\.?IN\b/i, scope: "arin" },
  { re: /^ARCH\b/i, scope: "arch" },
  { re: /^INTR\b/i, scope: "intr" },
  { re: /^WHA\b/i, scope: "wha" },
];

const SCOPE_TO_CODE_PREFIX: Record<Scope, string> = {
  arin: "ARIN",
  arch: "ARCH",
  intr: "INTR",
  wha: "WHA",
};

export function deriveScope(boardName: string): Scope {
  const name = boardName.trim();
  for (const { re, scope } of PREFIX_TO_SCOPE) {
    if (re.test(name)) return scope;
  }
  return "arin";
}

function stripPrefix(boardName: string): string {
  return boardName.trim().replace(/^(AR\.?IN|ARCH|INTR|WHA)\b[\s\-_:]*/i, "").trim();
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .trim();
}

// A unit/lot token contains digits or a slash (e.g. "GA7/45", "I-23", "H-16").
function looksLikeUnit(token: string): boolean {
  return /[0-9/]/.test(token);
}

function slugifyCode(site: string): string {
  return site
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 34)
    .replace(/-+$/g, "");
}

export function deriveProjectMeta(boardName: string): ProjectMeta {
  const scope = deriveScope(boardName);
  const remainder = stripPrefix(boardName);

  let site = remainder;
  let client: string | null = null;

  const seps = [...remainder.matchAll(/\s+-\s+|_/g)];
  if (seps.length > 0) {
    const last = seps[seps.length - 1];
    const idx = last.index ?? 0;
    const head = remainder.slice(0, idx).trim();
    const tail = remainder.slice(idx + last[0].length).trim();
    if (head && tail && !looksLikeUnit(tail)) {
      site = head;
      client = titleCase(tail);
    }
  }

  const project_name = titleCase(site);
  const site_address = project_name || null;
  const project_code = `${SCOPE_TO_CODE_PREFIX[scope]}-${slugifyCode(site)}`.replace(/-+$/g, "");
  const search_aliases = Array.from(
    new Set([project_name, client, boardName.trim()].filter(Boolean) as string[]),
  );

  return { scope, project_code, project_name, client_name: client, site_address, search_aliases };
}

export interface NormalizedBoard {
  _meta: { trello_board_id: string; short_link: string; board_name: string } & ProjectMeta;
  lists: unknown[];
  cards: unknown[];
  actions: unknown[];
  checklists: unknown[];
}

interface RawCheckItem { id: string; name: string; state: string }
interface RawChecklist { id: string; name: string; checkItems?: RawCheckItem[] }
interface RawCard { id: string; checklists?: RawChecklist[]; [k: string]: unknown }
interface RawBoard {
  id: string;
  shortLink: string;
  name: string;
  lists?: unknown[];
  cards?: RawCard[];
  actions?: Array<{ type: string; [k: string]: unknown }>;
}

export function normalizeBoard(raw: RawBoard): NormalizedBoard {
  const meta = deriveProjectMeta(raw.name);
  const rawCards = raw.cards ?? [];

  const cards = rawCards.map((c) => ({
    ...c,
    idChecklists: (c.checklists ?? []).map((cl) => cl.id),
  }));

  const checklists = rawCards.flatMap((c) =>
    (c.checklists ?? []).map((cl) => ({
      id: cl.id,
      idCard: c.id,
      name: cl.name,
      checkItems: (cl.checkItems ?? []).map((it) => ({ id: it.id, name: it.name, state: it.state })),
    })),
  );

  const actions = (raw.actions ?? []).filter((a) => a.type === "commentCard");

  return {
    _meta: { trello_board_id: raw.id, short_link: raw.shortLink, board_name: raw.name, ...meta },
    lists: raw.lists ?? [],
    cards,
    actions,
    checklists,
  };
}
