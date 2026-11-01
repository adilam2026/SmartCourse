/**
 * Ordre des articles dans une catégorie : un article ajouté ou réaffiché se range à côté des articles semblables, jamais en
 * fin de catégorie s'il a des voisins. Les « voisinages » ci-dessous servent UNIQUEMENT au classement : ils ne créent aucun
 * niveau de navigation (les catégories restent les seules rubriques).
 *
 * Règle, identique pour toutes les familles et pour le catalogue complet (rien n'est réécrit en base) :
 *  1. les articles du catalogue de départ gardent leur ordre (position de la référence) ;
 *  2. un autre article d'un groupe de voisins se place juste après le dernier article de départ de son groupe ; si son groupe
 *     n'a aucun article de départ, après le groupe le plus proche qui en a (olives après les condiments, soupes après la
 *     levure…) ; plusieurs articles d'un même groupe : par nom ;
 *  3. un article sans voisin reste à la fin, dans l'ordre où la famille l'a ajouté (par nom dans le catalogue complet).
 * Un article masqué puis réaffiché retrouve donc toujours la même place, et masquer un article ne déplace pas les autres.
 *
 * Mots comparés au DÉBUT du nom, sans accents ni majuscules ; ils sont écrits au singulier ou tronqués pour couvrir le pluriel
 * (« raisin » couvre « Raisins secs blonds »).
 */
const NEIGHBOURS: Record<string, readonly string[]> = {
  epicerie: [
    "farine|semoule|couscous",
    "riz|pates|vermicelle|cheveux d",
    "lentille|pois chiche|haricot|pois casse|feve",
    "huile",
    "vinaigre|assaisonnement|moutarde|mayonnaise|ketchup|harissa|sauce|concentre de tomate|pesto",
    "olive|cornichon|citron",
    "sel|poivre|cumin|cannelle|curcuma|paprika|safran|piment|melange d'epice|epice",
    "sucre",
    "levure|bicarbonate|fecule|chapelure|cacao",
    "soupe|potage|creme de poulet|bouillon",
    "amande|noix|pistache|cacahuete|raisin|pruneau|abricot",
    "chips|biscuit",
  ],
  pain: [
    "pain|baguette|brioche|biscotte|crepe|gateau",
    "cereale|granola|flocon",
    "confiture|miel|amlou|caramel|compote|beurre de cacahuete|pate a tartiner",
    "cafe|the|tisane",
  ],
  boissons: ["eau", "jus|nectar", "soda|cola|tonic|boisson gazeuse", "boisson energisante", "sirop", "boisson vegetale", "the|tisane|cafe"],
  laitages: ["lait|lben|leben", "yaourt", "creme", "beurre|smen|margarine", "fromage|mozzarella", "oeuf"],
  viandes: [
    "poulet|dinde",
    "boeuf|veau|agneau|viande",
    "poisson|saint-pierre|espadon|sole|merlan|colin|bar|dorade|pageot|saumon|sardine|thon",
    "crevette|calamar|anneaux de calamar|lamelles de calamar|seiche|poulpe|moule",
  ],
};
const NONE = 1000;
const END = 1_000_000;

/** Minuscules, accents retirés, œ → oe, apostrophe droite. */
export const flatName = (s: string): string =>
  s.toLowerCase().replace(/œ/g, "oe").replace(/’/g, "'").normalize("NFD").replace(/\p{M}/gu, "");

/** Rang du groupe de voisins (0, 1, …) ou 1000 si l'article n'appartient à aucun groupe. */
export const neighbourRank = (category: string, name: string): number => {
  const n = flatName(name);
  const i = (NEIGHBOURS[category] ?? []).findIndex((words) => words.split("|").some((w) => n.startsWith(w)));
  return i < 0 ? NONE : i;
};

/** Référence du catalogue de départ (initial_catalog) : catégorie, nom, position. */
export interface StartingRef { category: string; name: string; position: number }
/**
 * Article à classer : `startPos` = position de sa référence de départ s'il en vient ET qu'il est toujours dans la catégorie de
 * cette référence (sinon null) ; `seq` = ordre d'ajout pour les articles sans voisin (position chez la famille).
 */
export interface Placeable { category: string; name: string; startPos?: number | null; seq?: number; id?: string; key?: string }

type Key = [number, number, number, string, string];

/** Fonction de classement construite à partir du catalogue de départ (80 références). */
export function catalogOrderer(starting: readonly StartingRef[]): <T extends Placeable>(rows: readonly T[]) => T[] {
  // Pour chaque catégorie et groupe : positions de départ minimale et maximale.
  const span = new Map<string, Map<number, { min: number; max: number }>>();
  for (const s of starting) {
    const r = neighbourRank(s.category, s.name);
    if (r === NONE) continue;
    const m = span.get(s.category) ?? new Map<number, { min: number; max: number }>();
    const cur = m.get(r);
    m.set(r, { min: Math.min(cur?.min ?? Infinity, s.position), max: Math.max(cur?.max ?? -Infinity, s.position) });
    span.set(s.category, m);
  }
  const anchor = (category: string, rank: number): [number, number] => {
    const m = span.get(category);
    const own = m?.get(rank);
    if (own) return [own.max, 1 + rank / 100]; // après le dernier article de départ du groupe
    const ranks = [...(m?.keys() ?? [])].sort((a, b) => a - b);
    const lower = ranks.filter((r) => r < rank).at(-1);
    if (lower !== undefined) return [m!.get(lower)!.max, 1 + rank / 100]; // après le groupe voisin le plus proche
    const higher = ranks.find((r) => r > rank);
    if (higher !== undefined) return [m!.get(higher)!.min, -1 + rank / 100]; // juste avant lui
    return [END, -1 + rank / 100];
  };
  const keyOf = (p: Placeable): Key => {
    const name = flatName(p.name);
    const tie = p.id ?? p.key ?? "";
    if (p.startPos !== null && p.startPos !== undefined) return [p.startPos, 0, 0, name, tie];
    const rank = neighbourRank(p.category, p.name);
    if (rank === NONE) return [END, 0, p.seq ?? 0, name, tie];
    const [a, sub] = anchor(p.category, rank);
    return [a, sub, 0, name, tie];
  };
  const cmp = (x: Key, y: Key) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || (x[3] < y[3] ? -1 : x[3] > y[3] ? 1 : 0) || x[4].localeCompare(y[4]);
  return <T extends Placeable>(rows: readonly T[]): T[] => {
    const keyed = rows.map((r) => ({ r, k: keyOf(r) }));
    keyed.sort((a, b) => (a.r.category < b.r.category ? -1 : a.r.category > b.r.category ? 1 : cmp(a.k, b.k)));
    return keyed.map((x) => x.r);
  };
}
