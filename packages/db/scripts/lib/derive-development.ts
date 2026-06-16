// Best-guess development label from a project_name. SEED-ONLY: after the seed
// runs, projects.development_id is the source of truth. Wilson corrects the rest.

// Known abbreviations / forced groupings. Keys are matched case-insensitively
// against the full stripped label.
const ALIAS: Record<string, string> = {
  bdg: "Bukit Darmo Golf",
};

function looksLikeUnit(token: string): boolean {
  return /[0-9/]/.test(token);
}

export function deriveDevelopment(projectName: string): string {
  const cleaned = projectName.trim().replace(/\s+/g, " ");
  if (!cleaned) return "";

  const tokens = cleaned.split(" ");
  // Drop trailing unit tokens (those containing a digit or slash).
  while (tokens.length > 1 && looksLikeUnit(tokens[tokens.length - 1]!)) {
    tokens.pop();
  }
  const label = tokens.join(" ");

  const aliasKey = label.toLowerCase();
  if (ALIAS[aliasKey]) return ALIAS[aliasKey];
  return label;
}
