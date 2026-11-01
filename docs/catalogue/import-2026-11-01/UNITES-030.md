# Décisions finales sur les unités (migration 030)

**Principe :** une unité représente un contenant ou un article complet.
- 1 pot de miel de 250 g = 1 pièce.
- 1 paquet de 10 sachets de sucre vanillé = 1 pièce.
- Le poids, le volume et le nombre de sachets restent des informations de format.

**Où sont les unités :**
- les références **existantes** sont corrigées par `server/migrations/030_unit_decisions.sql` ;
- les références **nouvelles** du lot ont déjà leur unité finale dans `029_catalogue_captures.sql`.

Le tableau des changements préparés, avec le résultat sur une base de recette, est dans `INTEGRATION.md`.

## Familles, historiques et prix

### Produits des familles

- Une unité de produit ne change que si elle venait du catalogue : unité actuelle du catalogue, unité de départ du rayon, ou cas particuliers de 009.
- Une unité choisie par la famille est conservée et inscrite au journal `unit_corrections` comme cas à examiner (`unit_kept_custom`).
- Les identifiants ne changent jamais.
- Les noms ne changent jamais, sauf « Céréales » → « Céréales au chocolat ». Le nom suit seulement s'il était resté celui du catalogue ; un nom choisi par la famille est gardé.

### Historiques

Ne changent jamais : lignes de listes, achats, événements, favoris. Un achat passé de « 0,5 kg » de miel reste « 0,5 kg ». Les statistiques gardent chaque unité à part, sans jamais additionner kg et pièces.

### Prix

Le montant n'est jamais modifié. Un prix est converti seulement quand c'est exact :
- **prix d'un contenant** (pot, boîte, paquet, bouteille, brique) → même prix pour 1 pièce, et le contenu écrit reste le format. Exemple : 56,95 DH le pot de 450 g devient 56,95 DH la pièce, format 450 g ;
- **prix « par sachet » d'un potage** → 1 pièce. Pour le sucre vanillé et la levure chimique, un sachet n'est qu'une partie du paquet : le prix est à compléter ;
- **prix ramené au poids par 027 depuis un contenant** → le contenant d'origine, soit 1 pièce, d'après le journal 027 ;
- **prix au kg d'un produit dont le format donne un poids unique** (« pot de 250 g ») → même prix au kg, avec un poids de pièce de 250 g. Le montant d'une ligne est alors exact ;
- **dans tous les autres cas**, le prix est conservé tel quel et signalé à compléter (`price_to_confirm`). L'application l'affiche comme ancien prix, jamais comme prix actuel. Un prix au kg n'est jamais réutilisé directement comme prix à la pièce.

## Retour arrière (si nécessaire, après accord et sauvegarde vérifiée)

À exécuter **avant** le retour arrière de 029 (voir `INTEGRATION.md`), dans une transaction :

```sql
BEGIN;
UPDATE family_prices f SET ref_qty = (u.old_value->>'refQty')::numeric, ref_unit = u.old_value->>'refUnit',
       packaging = u.old_value->>'packaging', piece_weight_g = (u.old_value->>'pieceWeightG')::numeric
  FROM unit_corrections u
 WHERE u.migration = '030' AND u.subject = 'family_price' AND u.outcome = 'price_converted'
   AND f.family_id = u.family_id AND f.product_id::text = u.ref;
UPDATE base_prices b SET ref_qty = (u.old_value->>'refQty')::numeric, ref_unit = u.old_value->>'refUnit',
       packaging = u.old_value->>'packaging', piece_weight_g = (u.old_value->>'pieceWeightG')::numeric
  FROM unit_corrections u
 WHERE u.migration = '030' AND u.subject = 'base_price' AND u.outcome = 'price_converted' AND b.origin || ':' || b.key = u.ref;
UPDATE products p SET unit = u.old_unit FROM unit_corrections u
 WHERE u.migration = '030' AND u.subject = 'product' AND u.outcome = 'unit_changed' AND p.id::text = u.ref;
UPDATE products p SET name = u.old_value->>'name' FROM unit_corrections u
 WHERE u.migration = '030' AND u.subject = 'product' AND u.outcome = 'renamed' AND p.id::text = u.ref;
UPDATE initial_catalog i SET unit = u.old_unit FROM unit_corrections u
 WHERE u.migration = '030' AND u.subject = 'initial_catalog' AND u.outcome = 'unit_changed' AND i.key = u.ref;
UPDATE extended_catalog e SET unit = u.old_unit FROM unit_corrections u
 WHERE u.migration = '030' AND u.subject = 'extended_catalog' AND u.outcome = 'unit_changed' AND e.key = u.ref;
UPDATE extended_catalog e SET name = u.old_value->>'name', former_names = array_remove(e.former_names, 'céréales')
  FROM unit_corrections u
 WHERE u.migration = '030' AND u.subject = 'extended_catalog' AND u.outcome = 'renamed' AND e.key = u.ref;
DELETE FROM unit_corrections WHERE migration = '030';
DELETE FROM schema_migrations WHERE name = '030_unit_decisions.sql';
UPDATE families SET catalog_rev = catalog_rev + 1;
COMMIT;
```

Le serveur précédent doit être redéployé en même temps : son manifeste d'images porte l'ancien nom « Céréales ».
