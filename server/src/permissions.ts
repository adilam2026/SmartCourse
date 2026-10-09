export type Role = "admin" | "parent" | "staff";

export type Action =
  | "family.manage"        // profils, catalogue familial, catalogue étendu
  | "list.edit_unpurchased" // ajouter / retirer un produit non acheté
  | "list.create"
  | "list.close"
  | "purchase.record"
  | "purchase.correct"
  | "history.read";

const PARENT: Action[] = ["list.edit_unpurchased", "list.create", "list.close", "purchase.record", "purchase.correct", "history.read"];

const MATRIX: Record<Role, ReadonlySet<Action>> = {
  admin: new Set<Action>(["family.manage", ...PARENT]),
  parent: new Set<Action>(PARENT),
  staff: new Set<Action>(["list.edit_unpurchased"]),
};

export const can = (role: Role, action: Action): boolean => MATRIX[role].has(action);
