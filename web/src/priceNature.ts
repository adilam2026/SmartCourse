import type { Price } from "./types";

const day = (iso: string): string => iso.split("-").reverse().join("/");

/**
 * Nature d'un prix, en deux niveaux : une pastille discrète (« observé » ou « estimé », rien quand c'est un prix saisi par la famille)
 * et, à la demande, UNE phrase de détail. Les prix de la base initiale gardent leur nature d'origine (observé sur une capture,
 * moyenne de plusieurs références, estimation arrondie validée).
 */
export function priceNature(p: Price | null | undefined): { chip: "observé" | "estimé" | null; detail: string } | null {
  if (!p) return null;
  if (p.source === "family") return { chip: null, detail: "Prix saisi par votre famille." };
  if (p.source === "community") return { chip: null, detail: "Prix communautaire de votre ville, appliqué par votre famille." };
  const b = p.basis;
  if (!b) return { chip: null, detail: "Prix initial de l'application." };
  const when = day(b.observedOn);
  if (b.kind === "observed") return { chip: "observé", detail: `Prix observé le ${when}${b.source ? ` (${b.source})` : ""}.` };
  if (b.kind === "average") return { chip: "estimé", detail: `Moyenne de plusieurs références relevées le ${when}${b.source ? ` (${b.source})` : ""}.` };
  return { chip: "estimé", detail: `Estimation arrondie, validée le ${when}${b.source ? ` (${b.source})` : ""}.` };
}
