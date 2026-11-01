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

## Unités finales (décisions du 1er novembre 2026)

**Principe :** une unité représente un contenant ou un article complet. Poids, volume et nombre de sachets restent des informations de format. Le détail des règles et le retour arrière sont dans `UNITES-030.md`.

### Références existantes corrigées (migration 030)

42 changements : 9 références de départ, 33 du catalogue complémentaire (dont Pâte à tartiner, complément validé).

| Rayon | Référence | Avant | Après |
|---|---|---|---|
| Épicerie | Pâte à tartiner (`pate-a-tartiner`) | kg | **pièce** |
| Légumes et herbes | Choux-fleurs (`choux-fleurs`) | kg | **pièce** |
| Légumes et herbes | Épinards (`epinards`) | kg | **botte** |
| Fruits | Melon (`melon`) | kg | **pièce** |
| Fruits | Pastèque (`pasteque`) | kg | **pièce** |
| Laitages et œufs | Fromage en portions (`fromage-en-portions`) | boîte | **kg** |
| Laitages et œufs | Lait concentré (`lait-concentre`) | kg | **pièce** |
| Laitages et œufs | Lait en poudre (`lait-en-poudre`) | kg | **pièce** |
| Épicerie | Bicarbonate alimentaire (`bicarbonate-alimentaire`) | kg | **pièce** |
| Épicerie | Biscuits (`biscuits`) | kg | **pièce** |
| Épicerie | Cacao en poudre (`cacao-en-poudre`) | kg | **pièce** |
| Épicerie | Chapelure (`chapelure`) | kg | **pièce** |
| Épicerie | Concentré de tomates (`concentre-de-tomates`) | kg | **pièce** |
| Épicerie | Fécule de maïs (`fecule-de-mais`) | kg | **pièce** |
| Épicerie | Ketchup (`ketchup`) | kg | **pièce** |
| Épicerie | Levure chimique (`levure-chimique`) | kg | **pièce** |
| Épicerie | Levure de boulanger (`levure-de-boulanger`) | kg | **pièce** |
| Épicerie | Maïs en conserve (`mais-en-conserve`) | kg | **pièce** |
| Épicerie | Mayonnaise (`mayonnaise`) | kg | **pièce** |
| Épicerie | Moutarde (`moutarde`) | kg | **pièce** |
| Épicerie | Pesto (`pesto`) | kg | **pièce** |
| Épicerie | Sauce tomate (`sauce-tomate`) | kg | **pièce** |
| Épicerie | Sel alimentaire (`sel`) | kg | **pièce** |
| Épicerie | Sucre (`sucre`) | kg | **pièce** |
| Épicerie | Sucre glace (`sucre-glace`) | kg | **pièce** |
| Épicerie | Sucre vanillé (`sucre-vanille`) | kg | **pièce** |
| Pain et petit-déjeuner | Beurre de cacahuètes (`beurre-de-cacahuetes`) | kg | **pièce** |
| Pain et petit-déjeuner | Biscottes (`biscottes`) | kg | **pièce** |
| Pain et petit-déjeuner | Café (`cafe`) | kg | **pièce** |
| Pain et petit-déjeuner | Caramel à tartiner (`caramel-a-tartiner`) | kg | **pièce** |
| Pain et petit-déjeuner | Céréales au chocolat (`cereales`) | kg | **pièce** |
| Pain et petit-déjeuner | Compote de fruits (`compote-de-fruits`) | kg | **pièce** |
| Pain et petit-déjeuner | Confiture (`confiture`) | kg | **pièce** |
| Pain et petit-déjeuner | Flocons d'avoine (`flocons-d-avoine`) | kg | **pièce** |
| Pain et petit-déjeuner | Gâteaux secs marocains (`gateaux-secs-marocains`) | kg | **pièce** |
| Pain et petit-déjeuner | Miel (`miel`) | kg | **pièce** |
| Pain et petit-déjeuner | Pain de mie (`pain-de-mie`) | kg | **pièce** |
| Pain et petit-déjeuner | Thé en vrac (`the-en-vrac`) | kg | **pièce** |
| Boissons | Tisane en vrac (`tisane-en-vrac`) | kg | **pièce** |
| Maison | Lessive en poudre (`lessive-en-poudre`) | kg | **pièce** |
| Maison | Savon noir en pâte (`savon-noir-en-pate`) | kg | **pièce** |
| Maison | Sel régénérant pour lave-vaisselle (`sel-regenerant-pour-lave-vaisselle`) | kg | **pièce** |

Les autres références existantes gardent leur unité, par exemple :
- harissa, amlou, beurre, margarine, fromages : au poids ;
- farines, semoule, couscous, riz, pâtes, cheveux d'ange, légumineuses : au poids ;
- fruits secs, olives, cornichons, citrons confits, épices : au poids ;
- viandes, poissons et surgelés : au poids, sauf le poulet entier, à la pièce ;
- boissons, huiles et autres liquides validés : au litre, **dont Lben**.

### Références nouvelles du lot (migration 029, unités finales)

| Rayon | Unité | Références |
|---|---|---|
| Épicerie | kg | Abricots secs, Cacahuètes salées, Olives meslala, Olives noires façon grecque, Olives rouges, Olives vertes au citron, Olives vertes en tranches, Pistaches, Pruneaux, Raisins secs blonds |
| Épicerie | pièce | Assaisonnement au citron, Chips, Crème de poulet, Sauce algérienne, Sauce barbecue, Soupe aux lentilles, Soupe de légumes, Soupe poulet et vermicelles, Sucre en lingots, Sucre en morceaux, Vermicelles de Chine |
| Viandes et poisson | kg | Anneaux de calamar, Bar, Crevettes grises, Crevettes roses, Dorade royale, Espadon, Lamelles de calamar, Merlan colin, Merlan ration, Pageot chama, Pageot royal, Saint-Pierre métallisé, Sole |
| Pain et petit-déjeuner | pièce | Café soluble, Confiture de figue, Granola aux trois chocolats |
| Boissons | litre | Boisson énergisante, Cola, Soda à l'ananas, Soda à la pomme, Soda à l'orange, Soda à l'orange sans sucre, Soda au citron, Tonic |

### Format de référence

**Sucre (« sucre granulé ») : à la pièce, format de référence « paquet de 2 kg ».**
- Le format est copié chez les familles qui n'en avaient pas, et lors de chaque nouvel ajout. Une famille garde toujours le format qu'elle a saisi. C'est journalisé et réversible.
- Le prix relevé sur la capture, 9,95 DH le paquet, reste un relevé : il n'est pas importé, car ce n'est pas un tarif actuel garanti.
- Le prix commun de 5,20 DH/kg n'est jamais transformé en prix du paquet. Le prix au kg d'une famille ne l'est pas non plus : seul un format saisi par la famille elle-même peut servir à une conversion.

### Familles et historiques

- **Produits des familles :** l'unité change seulement si elle venait du catalogue. Une unité choisie par la famille est conservée et journalisée. Identifiants inchangés.
- **Nom :** « Céréales » devient « Céréales au chocolat » chez les familles qui n'avaient pas changé ce nom. « Mes céréales » resterait « Mes céréales ».
- **Historique :** achats, lignes de listes, événements et favoris sont figés. Un achat passé de 0,5 kg de miel reste 0,5 kg. Les statistiques gardent kg et pièces séparés.
- **Quantités :** à la pièce, elles sont entières (1,5 pot refusé).

### Prix communs (base 019), sur une base de recette

| Référence | Prix observé (019) | Après 027 | Après 030 |
|---|---|---|---|
| Miel | 56,95 DH le pot de 450 g | 56,95 DH / 450 g | **56,95 DH la pièce**, format 450 g |
| Confiture | 18,95 DH le pot de 430 g | 18,95 DH / 430 g | **18,95 DH la pièce**, format 430 g |
| Concentré de tomates | 7,40 DH la boîte de 140 g | 7,40 DH / 140 g | **7,40 DH la pièce**, format 140 g |
| Sauce tomate | 32,00 DH le pot de 400 g | 32,00 DH / 400 g | **32,00 DH la pièce**, format 400 g |
| Ketchup | 14,50 DH le flacon de 310 g | 14,50 DH / 310 g | **14,50 DH la pièce**, format flacon de 310 g |
| Mayonnaise | 14,95 DH le pot de 280 g | 14,95 DH / 280 g | **14,95 DH la pièce**, format 280 g |
| Moutarde | 16,50 DH le pot de 300 g | 16,50 DH / 300 g | **16,50 DH la pièce**, format 300 g |
| Maïs en conserve | 6,65 DH la boîte de 150 g | 6,65 DH / 150 g | **6,65 DH la pièce**, format 150 g |
| Bicarbonate alimentaire | 24,50 DH le pot de 250 g | 24,50 DH / 250 g | **24,50 DH la pièce**, format 250 g |
| Flocons d'avoine | 20,95 DH le paquet de 500 g | 20,95 DH / 500 g | **20,95 DH la pièce**, format 500 g |
| Caramel à tartiner | 64,00 DH le pot de 380 g | 64,00 DH / 380 g | **64,00 DH la pièce**, format 380 g |
| Compote de fruits | 19,50 DH le pot de 390 g | 19,50 DH / 390 g | **19,50 DH la pièce**, format 390 g |
| Sucre | 5,20 DH / kg | 5,20 DH / kg | **conservé, à compléter** : jamais utilisé comme prix du paquet (le format de référence ne sert à aucune conversion) |
| Fromage en portions | 26,00 DH la boîte de 16 portions | idem | **conservé, à compléter** : aucun poids écrit, pas de prix au kg déduit |

**Prix des familles :** mêmes règles.
- Contenant → 1 pièce.
- Prix au kg avec un format au poids unique (« pot de 250 g ») → même prix au kg, avec un poids de pièce de 250 g. Le montant d'une ligne est exact.
- Sinon : conservé et signalé à compléter. C'est le cas d'un prix au kg sans format, d'un prix « par sachet » pour le sucre vanillé ou la levure chimique, et du melon au kg.

## Adaptations par rapport au correctif du lot

1. **Unités :** remplacées par les décisions du 1er novembre 2026 (section précédente). Noms « Chips » et « Céréales au chocolat ».
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

Relevés à vérifier ou à distinguer (24 sur 89 ; unités finales) :

| Capture | Article relevé | Référence (unité finale) | Format | Prix relevé | Point à vérifier |
|---|---|---|---|---|---|
| 03-631400.jpg | Noix de cajou grillées | `noix-de-cajou` (kg) | 200 g | 43.80 DH | prix promotionnel : 43.80 DH, prix barré 47.80 DH (distincts) |
| 04-631398.jpg | Raisins secs noirs | `raisins-secs` (kg) | 200 g | 13.80 DH | prix promotionnel : 13.80 DH, prix barré 15.80 DH (distincts) |
| 05-631396.jpg | Pruneaux | `pruneaux` (kg) | 200 g | 12.38 DH | prix promotionnel : 12.38 DH, prix barré 16.38 DH (distincts) |
| 07-631392.jpg | Amandes | `amandes` (kg) | 200 g | 25.00 DH | prix promotionnel : 25.00 DH, prix barré 29.18 DH (distincts) |
| 10-631386.jpg | Chapelure | `chapelure` (piece) | 250 g | 4.90 DH | Bonus 25 g visible : contenu à confirmer |
| 01-631384.jpg | Soupe aux lentilles | `soupe-aux-lentilles` (piece) | 100 g | 8.10 DH | Titre 100 g / emballage 70 g à confirmer |
| 02-631382.jpg | Soupe poulet et vermicelles | `soupe-poulet-et-vermicelles` (piece) | 60 g | 8.50 DH | Titre 60 g / emballage 80 g à confirmer |
| 03-631380.jpg | Soupe de légumes | `soupe-de-legumes` (piece) | 40 g | 8.25 DH | Titre 40 g / emballage 60 g à confirmer |
| 01-631364.jpg | Assaisonnement au citron | `assaisonnement-au-citron` (piece) | 24 cL | 5.95 DH | Assaisonnement citron : ne pas assimiler automatiquement au vinaigre |
| 07-631352.jpg | Concentré de tomates | `concentre-de-tomates` (piece) | 10.6 cL | 6.70 DH | Fiche 10.6 cL / étiquette 105 g |
| 08-631350.jpg | Harissa | `harissa` (kg) | 160 g | 8.40 DH | Sauce liquide / pâte de harissa à distinguer |
| 09-631348.jpg | Sauce algérienne | `sauce-algerienne` (piece) | 305 mL | 18.95 DH | prix promotionnel : 18.95 DH, prix barré 22.50 DH (distincts) |
| 03-631340.jpg | Ketchup | `ketchup` (piece) | 460 g | 22.95 DH | prix promotionnel : 22.95 DH, prix barré 29.95 DH (distincts) |
| 01-631304.jpg | Semoule fine | `semoule-fine` (kg) | 5 kg | 55.25 DH | 5 kg + 1 kg gratuit : contenu réel à confirmer |
| 10-631286.jpg | Soda à l'orange sans sucre | `soda-a-l-orange-sans-sucre` (litre) | 50 cL | 6.50 DH | prix promotionnel : 6.50 DH, prix barré 6.60 DH (distincts) |
| 10-630704.jpg | Miel multifleurs | `miel` (piece) | 250 g | 31.50 DH | prix promotionnel : 31.50 DH, prix barré 32.50 DH (distincts) |
| 01-630702.jpg | Confiture d'abricot | `confiture` (piece) | 21 cL | 10.50 DH | Poids net à vérifier, fiche en cL |
| 02-630700.jpg | Confiture de figue | `confiture-de-figue` (piece) | 37 cL | 19.20 DH | Poids net à vérifier, fiche en cL |
| 08-630688.jpg | Merlan colin | `merlan-colin` (kg) | 500 g | 41.98 DH | Identification commerciale à confirmer |
| 09-630686.jpg | Bar | `bar` (kg) | 400–600 g | 163.95 DH | fourchette de poids ; Base du prix non explicite : ne pas convertir |
| 10-630684.jpg | Merlan ration | `merlan-ration` (kg) | 500 g | 51.98 DH | Identification commerciale à confirmer |
| 07-630670.jpg | Lben | `lben` (litre) | 440 g | 4.90 DH | format en poids, unité au litre (aucune conversion g → mL, aucun prix au litre déduit) |
| 08-630668.jpg | Lben | `lben` (litre) | 450 g | 4.65 DH | format en poids, unité au litre (aucune conversion g → mL, aucun prix au litre déduit) |
| 09-630666.jpg | Lait entier UHT | `lait` (litre) | 6 × 1 L | 65.95 DH | prix d'un lot (6 × 1 L) : non importé |

## Décisions appliquées et points restants

**Appliqués :**
- visuels de l'éditeur conservés pour les farines et semoules ;
- variantes gardées comme articles distincts, dans les catégories existantes ;
- noms « Chips » et « Céréales au chocolat » ;
- unités finales ;
- Lben au litre, sans conversion des grammes ni prix au litre déduit.

**Complément validé, appliqué :**
- Pâte à tartiner à la pièce, comme Nutella (deux références distinctes, aucun doublon) ;
- Sucre au format « paquet de 2 kg » ;
- prix du Fromage en portions à compléter, faute de poids confirmé.

**Rapport par foyer :** `rapport-foyer.sql` liste les articles d'un foyer qui garderaient une unité personnalisée, avec l'état de leur prix.
- Il joue les migrations 026 à 030 dans une transaction annulée.
- Il est à exécuter sur une copie de la base (restauration d'une sauvegarde).
- Je ne l'ai pas exécuté sur les données réelles : je n'ai pas accès à la production, et les journaux de l'intégration continue sont publics.

**Restant à trancher :**
1. **Merlan colin et Merlan ration :** non fusionnés, en attendant une identification confirmée.
2. **Articles absents ou ambigus dans les décisions sur les unités :**
   - « Confiture de figue » : placée à la pièce, comme « Confiture » ;
   - « Biscuits secs » : n'existe pas au catalogue (« Biscuits » et « Gâteaux secs marocains » sont passés à la pièce) ;
   - « Café moulu ou en grains » : rattaché à la référence « Café ».
3. **Prix à compléter :** Sucre (5,20 DH / kg ; relevé de 9,95 DH le paquet de 2 kg non importé) et Fromage en portions (boîte de 16 portions, sans poids confirmé). Les autres prix relevés du lot restent non importés (date de prise de vue inconnue).
4. **Marques sur les emballages :** les illustrations reprennent des emballages reconnaissables (Heinz, Coca-Cola, Red Bull…). À garder en tête pour les captures de la fiche Google Play.

## Retour arrière (si nécessaire, après accord et sauvegarde vérifiée)

Commencer par le retour arrière de 030 (`UNITES-030.md`), puis celui de 029 ci-dessous.

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
