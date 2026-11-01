# Lot catalogue du 1er novembre 2026 — intégration

**Branche :** `claude/unites-statistiques`, celle qui sert de référence au lot.

**Statut :** non déployé en production.

**Contenu du lot :** 89 captures, 81 articles (45 références ajoutées, 36 existantes réutilisées), 81 images.

**Notes d'origine du lot :** `LISEZMOI.md` et `CONTROLES.md`, dans ce dossier.

## Ce qui a été intégré

| Élément | Fichier | Détail |
|---|---|---|
| Références | `server/migrations/029_catalogue_captures.sql` | Ajouts uniquement, relançable (`ON CONFLICT (key) DO NOTHING`, mises à jour gardées par conditions). Voir « Références » ci-dessous. |
| Images | `server/catalog-photos/files/*.webp` et `manifest.json` | **77 images appliquées** : 32 remplacées et 45 ajoutées. Synchronisées au démarrage du serveur, par clé stable. Les photos choisies par une famille ne sont jamais remplacées. |
| Classement | `server/src/catalog-order.ts`, routes `/api/catalog` et `/api/catalog/all` | Les articles semblables restent voisins, sans sous-catégorie. Voir « Classement » ci-dessous. |
| Relevés | `references.csv` / `references.json` / `products.json` | Prix, prix barrés, formats et avertissements, conservés tels quels et **non importés**. |
| Tests serveur | `server/test/catalog-captures.test.ts` | 12 tests ciblés. Compteurs mis à jour dans les tests d'images. |
| Parcours Android | section **O** de `scripts/native-e2e-final.sh` | Images, recherche, unités, classement, masquer et réafficher, sur l'APK de test. |

### Références (migration 029)

- **Ajouts :** 45 références, clés stables.
- **Vérification des doublons :** sur les noms, alias, anciens noms et références fusionnées du catalogue. Aucun doublon de clé ni de nom.
- **Références existantes :** 36 réutilisées telles quelles (mêmes identifiants, noms, unités). Seuls leurs mots de recherche sont complétés avec les noms relevés sur les emballages, par exemple :
  - « cheveux d'ange » → Vermicelles ;
  - « huile de tournesol » → Huile de table ;
  - « sucre granulé » → Sucre.
- **Mots de recherche des nouvelles références :** le nom du rayon courant, pour retrouver les articles sans sous-catégorie : « poisson », « fruits de mer », « soda boisson gazeuse », « fruits secs », « potage ».
- **Deux références rejoignent leurs voisines, dans les catégories existantes :**
  - Raisins secs : Fruits → Épicerie ;
  - Céréales : Épicerie → Pain et petit-déjeuner.
  - Les articles des familles ne suivent que s'ils sont encore dans la catégorie d'origine. Une catégorie choisie par la famille n'est jamais modifiée.
- **Aucune catégorie ajoutée.**

### Classement

- Les articles du catalogue de départ gardent leur ordre. C'est contrôlé sur les 80 références.
- Un article ajouté ou réaffiché se place juste après ses voisins.
- Si la famille n'a encore aucun article semblable, il se place après le groupe le plus proche, par exemple :
  - olives après les condiments ;
  - soupes, puis fruits secs, après la levure.
- Ordre identique chez toutes les familles et dans le catalogue complet.
- Rien n'est réécrit en base.
- Masquer un article ne déplace pas les autres ; réafficher le remet à la même place.
- Les 45 nouvelles références ont toutes des voisins.

## Adaptations par rapport au correctif du lot

1. **Unités alignées sur les conventions de 027.**
   - Les quatre potages déshydratés se comptent **au sachet** (40 à 100 g), et non au kg.
   - Sauce algérienne, sauce barbecue et assaisonnement au citron sont relevés en mL ou cL : ils restent au litre, sans conversion g ↔ mL.
   - Les autres unités sont celles du lot : poissons au kg, boissons au litre, fruits secs et olives au kg comme leurs voisins existants.
2. **Classement.**
   - Le correctif du lot triait chaque catégorie par groupes puis par nom. Cela aurait déplacé l'ordre de départ de toutes les familles, par exemple les huiles, aujourd'hui en tête d'Épicerie.
   - Le classement retenu conserve l'ordre de départ et ne place que les ajouts.
   - Motifs corrigés pour les pluriels déjà au catalogue : « Fèves sèches », « Citrons confits », « Raisins secs », « Boisson énergisante », « Boisson végétale », « Anneaux de calamar ».
   - Le catalogue complet utilise exactement le même classement que les familles. Il est calculé sur le serveur, puis paginé.
3. **Visuels fournis par l'éditeur conservés (licence `OWN`, migration 022).**
   - Les 4 images du lot pour Semoule fine, Semoule couscous, Farine complète et Farine fino **ne sont pas appliquées**.
   - Point à trancher ; voir plus bas.
4. **Script de préparation du lot non repris** (`prepare-catalogue-20261101.ts`). Il lit des fichiers qui ne sont pas dans le dépôt ; la migration et le manifeste en tiennent lieu.

## Prix et formats

- Aucun prix n'est importé, car la date de prise de vue est inconnue.
- Prix promotionnels et prix barrés sont distincts.
- Les marques et formats concurrents restent des relevés séparés d'un même article : pas de moyenne, pas de prix le plus bas automatique.

Relevés à vérifier ou à distinguer (29 sur 89) :

| Capture | Article relevé | Référence (unité) | Format | Prix relevé | Point à vérifier |
|---|---|---|---|---|---|
| 03-631400.jpg | Noix de cajou grillées | `noix-de-cajou` (kg) | 200 g | 43.80 DH | prix promotionnel : 43.80 DH, prix barré 47.80 DH (distincts) |
| 04-631398.jpg | Raisins secs noirs | `raisins-secs` (kg) | 200 g | 13.80 DH | prix promotionnel : 13.80 DH, prix barré 15.80 DH (distincts) |
| 05-631396.jpg | Pruneaux | `pruneaux` (kg) | 200 g | 12.38 DH | prix promotionnel : 12.38 DH, prix barré 16.38 DH (distincts) |
| 07-631392.jpg | Amandes | `amandes` (kg) | 200 g | 25.00 DH | prix promotionnel : 25.00 DH, prix barré 29.18 DH (distincts) |
| 10-631386.jpg | Chapelure | `chapelure` (kg) | 250 g | 4.90 DH | Bonus 25 g visible : contenu à confirmer |
| 01-631384.jpg | Soupe aux lentilles | `soupe-aux-lentilles` (sachet) | 100 g | 8.10 DH | sachet : poids du sachet seulement indicatif ; Titre 100 g / emballage 70 g à confirmer |
| 02-631382.jpg | Soupe poulet et vermicelles | `soupe-poulet-et-vermicelles` (sachet) | 60 g | 8.50 DH | sachet : poids du sachet seulement indicatif ; Titre 60 g / emballage 80 g à confirmer |
| 03-631380.jpg | Soupe de légumes | `soupe-de-legumes` (sachet) | 40 g | 8.25 DH | sachet : poids du sachet seulement indicatif ; Titre 40 g / emballage 60 g à confirmer |
| 04-631378.jpg | Crème de poulet | `creme-de-poulet` (sachet) | 60 g | 8.50 DH | sachet : poids du sachet seulement indicatif |
| 01-631364.jpg | Assaisonnement au citron | `assaisonnement-au-citron` (litre) | 24 cL | 5.95 DH | Assaisonnement citron : ne pas assimiler automatiquement au vinaigre |
| 06-631354.jpg | Sauce tomate pour pizza | `sauce-tomate` (kg) | 37 cL | 13.40 DH | format en volume, unité au kg (aucune conversion mL → g) |
| 07-631352.jpg | Concentré de tomates | `concentre-de-tomates` (kg) | 10.6 cL | 6.70 DH | format en volume, unité au kg (aucune conversion mL → g) ; Fiche 10.6 cL / étiquette 105 g |
| 08-631350.jpg | Harissa | `harissa` (kg) | 160 g | 8.40 DH | Sauce liquide / pâte de harissa à distinguer |
| 09-631348.jpg | Sauce algérienne | `sauce-algerienne` (litre) | 305 mL | 18.95 DH | prix promotionnel : 18.95 DH, prix barré 22.50 DH (distincts) |
| 03-631340.jpg | Ketchup | `ketchup` (kg) | 460 g | 22.95 DH | prix promotionnel : 22.95 DH, prix barré 29.95 DH (distincts) |
| 07-631332.jpg | Levure chimique | `levure-chimique` (kg) | 5 unités | 6.00 DH | prix d'un lot de sachets, unité de la référence au poids : prix non importé |
| 08-631330.jpg | Sucre vanillé | `sucre-vanille` (kg) | 10 × 7.5 g | 5.50 DH | prix d'un lot de sachets, unité de la référence au poids : prix non importé |
| 09-631328.jpg | Levure chimique | `levure-chimique` (kg) | 10 × 8 g | 5.50 DH | prix d'un lot de sachets, unité de la référence au poids : prix non importé |
| 01-631304.jpg | Semoule fine | `semoule-fine` (kg) | 5 kg | 55.25 DH | 5 kg + 1 kg gratuit : contenu réel à confirmer |
| 10-631286.jpg | Soda à l'orange sans sucre | `soda-a-l-orange-sans-sucre` (litre) | 50 cL | 6.50 DH | prix promotionnel : 6.50 DH, prix barré 6.60 DH (distincts) |
| 10-630704.jpg | Miel multifleurs | `miel` (kg) | 250 g | 31.50 DH | prix promotionnel : 31.50 DH, prix barré 32.50 DH (distincts) |
| 01-630702.jpg | Confiture d'abricot | `confiture` (kg) | 21 cL | 10.50 DH | format en volume, unité au kg (aucune conversion mL → g) ; Poids net à vérifier, fiche en cL |
| 02-630700.jpg | Confiture de figue | `confiture-de-figue` (kg) | 37 cL | 19.20 DH | format en volume, unité au kg (aucune conversion mL → g) ; Poids net à vérifier, fiche en cL |
| 08-630688.jpg | Merlan colin | `merlan-colin` (kg) | 500 g | 41.98 DH | Identification commerciale à confirmer |
| 09-630686.jpg | Bar | `bar` (kg) | 400–600 g | 163.95 DH | fourchette de poids ; Base du prix non explicite : ne pas convertir |
| 10-630684.jpg | Merlan ration | `merlan-ration` (kg) | 500 g | 51.98 DH | Identification commerciale à confirmer |
| 07-630670.jpg | Lben | `lben` (litre) | 440 g | 4.90 DH | format en poids, unité au litre (aucune conversion g → mL) |
| 08-630668.jpg | Lben | `lben` (litre) | 450 g | 4.65 DH | format en poids, unité au litre (aucune conversion g → mL) |
| 09-630666.jpg | Lait entier UHT | `lait` (litre) | 6 × 1 L | 65.95 DH | prix d'un lot de 6 × 1 L (6 L) : prix non importé |

## Points restant à trancher

1. **Visuels de l'éditeur** (Semoule fine, Semoule couscous, Farine complète, Farine fino) : garder les visuels fournis en 022, ou appliquer les illustrations du lot ?
2. **Références voisines d'une référence générique** :
   - Olives (5 variétés) ;
   - Sucre (lingots, morceaux) ;
   - Crevettes (grises, roses) ;
   - Café soluble ;
   - Confiture de figue ;
   - Raisins secs blonds ;
   - 7 sodas, à côté de « Boisson gazeuse ».
   
   Elles sont intégrées comme articles distincts, conformément au lot. À confirmer, ou à rattacher à la référence générique comme simple mot de recherche.
3. **Noms à confirmer** :
   - « Merlan colin » et « Merlan ration » : identification commerciale à confirmer selon le lot ;
   - « Chips au fromage et aux oignons » : il n'existe pas de référence générique « Chips » ;
   - « Céréales » : sa nouvelle image montre des céréales au chocolat d'une marque.
4. **Marques sur les emballages** : les illustrations reprennent des emballages reconnaissables, comme demandé. Les noms d'articles restent génériques. À garder en tête pour les captures de la fiche Google Play.
5. **Unités à arbitrer** :
   - Sauce tomate, ketchup, mayonnaise, moutarde et harissa sont au kg, alors que les deux nouvelles sauces relevées en mL sont au litre ;
   - Lben est au litre, alors que les pots relevés sont en grammes ;
   - Levure chimique et sucre vanillé sont au kg, alors qu'ils sont vendus en lots de sachets.
6. **Prix** : ils sont importables seulement avec une date d'observation confirmée et une base de prix sans ambiguïté (voir le tableau).

## Retour arrière (si nécessaire, après accord et sauvegarde vérifiée)

1. **Serveur.**
   - Redéployer le commit précédent. Le manifeste d'images précédent est resynchronisé au démarrage ; les photos personnelles des familles ne sont jamais touchées.
   - Le nouveau classement disparaît avec le code. Les positions en base n'ont jamais été modifiées.
2. **Base**, dans une transaction :

```sql
BEGIN;
UPDATE extended_catalog SET category = 'fruits' WHERE key = 'raisins-secs' AND category = 'epicerie';
UPDATE products p SET category = 'fruits' WHERE p.extended_id = (SELECT id FROM extended_catalog WHERE key = 'raisins-secs') AND p.category = 'epicerie';
UPDATE extended_catalog SET category = 'epicerie' WHERE key = 'cereales' AND category = 'pain';
UPDATE products p SET category = 'epicerie' WHERE p.extended_id = (SELECT id FROM extended_catalog WHERE key = 'cereales') AND p.category = 'pain';
-- Nouvelles références : retirées seulement si aucune famille ne les a ajoutées (sinon elles restent, sans effet sur les autres)
DELETE FROM extended_catalog e WHERE e.source = 'captures-20261101' AND NOT EXISTS (SELECT 1 FROM products p WHERE p.extended_id = e.id);
DELETE FROM schema_migrations WHERE name = '029_catalogue_captures.sql';
UPDATE families SET catalog_rev = catalog_rev + 1;
COMMIT;
```

Les mots de recherche ajoutés peuvent rester : ils ne changent ni les noms, ni les unités, ni les identifiants.
