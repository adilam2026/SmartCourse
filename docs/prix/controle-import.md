# Contrôle de l'import — base initiale des prix (captures du 12/10/2026)

**98 prix intégrés**, **12 prix en attente** (conservés sans activation), nettoyant sol : aucun prix. Prix indicatifs, masqués par défaut ; aucune remise ni cashback déduit ; aucune unité de famille modifiée ; aucun prix personnalisé écrasé ; aucun article créé.

Colonne « Calcul avec l'unité du catalogue » : `oui` si une quantité en unité du catalogue de départ donne un montant ; sinon `non` — le montant n'est PAS calculé et « Prix à compléter » s'affiche quand les prix sont activés (aucune conversion pièce ↔ kg sans poids, aucun changement d'unité).

## Intégrés

| Produit | Clé stable | Prix | Référence | Nature | Statut | Calcul avec l'unité du catalogue | Précision |
|---|---|---|---|---|---|---|---|
| Tomates | `tomates` | 9,90 DH | kg | observé | intégré | oui | tomates rondes |
| Pommes de terre | `pommes-de-terre` | 9,00 DH | kg | estimation arrondie | intégré | oui | estimation arrondie validée |
| Oignons | `oignons` | 8,40 DH | kg | moyenne | intégré | oui | moyenne rouge et blanc |
| Carottes | `carottes` | 7,90 DH | kg | observé | intégré | oui |  |
| Concombres | `concombres` | 10,90 DH | kg | observé | intégré | oui |  |
| Courgettes | `courgettes` | 15,80 DH | kg | observé | intégré | oui |  |
| Poivrons verts | `poivrons-verts` | 17,00 DH | kg | observé | intégré | oui |  |
| Poivrons rouges | `poivrons-rouges` | 23,80 DH | kg | observé | intégré | oui |  |
| Betteraves | `betteraves` | 9,80 DH | kg | observé | intégré | oui |  |
| Navets | `navets` | 17,80 DH | kg | observé | intégré | oui |  |
| Aubergines | `aubergines` | 9,80 DH | kg | observé | intégré | oui |  |
| Haricots verts | `haricots-verts` | 27,00 DH | kg | observé | intégré | oui |  |
| Champignons | `champignons` | 64,50 DH | kg | observé | intégré | oui | frais |
| Gingembre | `gingembre` | 64,50 DH | kg | observé | intégré | oui |  |
| Ail | `ail` | 71,60 DH | kg | observé | intégré | non (catalogue : piece) | ne pas convertir en prix par tête sans poids |
| Laitue | `laitue` | 7,50 DH | pièce | observé | intégré | oui |  |
| Persil | `persil` | 3,90 DH | paquet — sachet (poids non précisé) | observé | intégré | oui | poids non précisé, prix par sachet uniquement |
| Sauge | `sauge` | 7,95 DH | paquet — barquette de 25 g | observé | intégré | non (catalogue : piece) |  |
| Thym | `thym` | 7,95 DH | paquet — barquette de 25 g | observé | intégré | non (catalogue : piece) |  |
| Bananes | `bananes` | 19,90 DH | kg | observé | intégré | oui |  |
| Clémentines | `clementines` | 10,90 DH | kg | observé | intégré | oui |  |
| Citrons | `citrons` | 7,80 DH | kg | observé | intégré | oui |  |
| Pamplemousse | `pamplemousse` | 7,00 DH | kg | observé | intégré | oui |  |
| Avocats | `avocats` | 25,80 DH | kg | observé | intégré | oui | référence ordinaire, hors Hass |
| Poires | `poires` | 32,00 DH | kg | estimation arrondie | intégré | oui | estimation arrondie validée |
| Pommes | `pommes` | 25,00 DH | kg | estimation arrondie | intégré | oui | référence indicative validée |
| Grenades | `grenades` | 11,90 DH | kg | observé | intégré | oui |  |
| Kiwis | `kiwis` | 61,80 DH | kg | observé | intégré | oui |  |
| Ananas | `ananas` | 26,90 DH | pièce | observé | intégré | oui |  |
| Noix de coco | `noix-de-coco` | 14,50 DH | pièce | observé | intégré | oui |  |
| Mangues | `mangues` | 13,90 DH | pièce | observé | intégré | non (catalogue : kg) | aucune conversion au kg sans poids |
| Lait | `lait` | 11,00 DH | litre | observé | intégré | non (catalogue : piece) |  |
| Boisson végétale | `boisson-vegetale` | 30,00 DH | litre | estimation arrondie | intégré | non (catalogue : brique) | estimation arrondie validée |
| Œufs | `oeufs` | 1,86 DH | pièce | observé | intégré | oui |  |
| Crème fraîche | `creme-fraiche` | 12,95 DH | pot — 200 ml | observé | intégré | oui |  |
| Crème de cuisson | `creme-de-cuisson` | 19,95 DH | brique — 500 ml | observé | intégré | oui |  |
| Crème chantilly | `creme-chantilly` | 36,50 DH | pièce — bombe de 250 g | observé | intégré | oui | prête à utiliser |
| Fromage frais | `fromage-frais` | 14,95 DH | pot — 190 g | observé | intégré | oui |  |
| Fromage à tartiner | `fromage-a-tartiner` | 19,95 DH | pot — 200 g | observé | intégré | oui |  |
| Fromage en portions | `fromage-en-portions` | 26,00 DH | boîte — 16 portions | observé | intégré | oui |  |
| Fromage en tranches | `fromage-en-tranches` | 13,75 DH | paquet — 200 g | observé | intégré | oui |  |
| Fromage râpé | `fromage-rape` | 19,50 DH | paquet — 100 g | observé | intégré | oui |  |
| Farine | `farine` | 6,75 DH | kg | observé | intégré | non (catalogue : paquet) | farine blanche courante |
| Farine complète | `farine-complete` | 10,20 DH | kg | estimation arrondie | intégré | non (catalogue : paquet) | montant arrondi après conversion |
| Sucre | `sucre` | 5,20 DH | kg | observé | intégré | non (catalogue : paquet) | sucre granulé |
| Pâtes | `pates` | 10,00 DH | paquet — 500 g | estimation arrondie | intégré | oui | estimation arrondie validée |
| Vermicelles | `vermicelles` | 9,90 DH | paquet — 500 g | observé | intégré | oui |  |
| Couscous | `couscous` | 15,00 DH | kg | estimation arrondie | intégré | non (catalogue : paquet) | estimation arrondie validée |
| Huile de table | `huile-de-table` | 17,64 DH | litre | observé | intégré | non (catalogue : bouteille) |  |
| Huile d’olive | `huile-d-olive` | 47,45 DH | litre | observé | intégré | non (catalogue : bouteille) | référence courante |
| Concentré de tomates | `concentre-de-tomates` | 7,40 DH | boîte — 140 g | observé | intégré | oui |  |
| Sauce tomate | `sauce-tomate` | 32,00 DH | pot — 400 g | observé | intégré | non (catalogue : boite) | sauce préparée |
| Ketchup | `ketchup` | 14,50 DH | bouteille — flacon de 310 g | observé | intégré | oui |  |
| Mayonnaise | `mayonnaise` | 14,95 DH | pot — 280 g | observé | intégré | oui |  |
| Moutarde | `moutarde` | 16,50 DH | pot — 300 g | observé | intégré | oui |  |
| Cornichons | `cornichons` | 9,80 DH | pot — 210 g | observé | intégré | oui |  |
| Maïs en conserve | `mais-en-conserve` | 6,65 DH | boîte — 150 g | observé | intégré | oui |  |
| Bouillon | `bouillon` | 7,50 DH | boîte — 8 cubes | estimation arrondie | intégré | oui | référence poisson utilisée comme estimation |
| Piment en poudre | `piment-en-poudre` | 10,00 DH | pot — quantité de 125 g | estimation arrondie | intégré | oui | estimation arrondie validée; conteneur non précisé : rattaché à l'unité du catalogue (pot) |
| Mélange d’épices | `melange-d-epices` | 29,30 DH | pot — 130 g | observé | intégré | oui |  |
| Bicarbonate alimentaire | `bicarbonate-alimentaire` | 24,50 DH | pot — 250 g | observé | intégré | non (catalogue : paquet) |  |
| Citrons confits | `citrons-confits` | 23,00 DH | pot — 950 g | observé | intégré | oui |  |
| Feuilles de brick | `feuilles-de-brick` | 19,50 DH | paquet — 10 feuilles, 200 g | observé | intégré | oui |  |
| Flocons d’avoine | `flocons-d-avoine` | 20,95 DH | paquet — 500 g | observé | intégré | oui |  |
| Baguette | `baguette` | 3,50 DH | pièce | observé | intégré | oui | référence de 200 à 250 g |
| Pain | `pain` | 2,00 DH | pièce | observé | intégré | oui | pain rond |
| Pain complet | `pain-complet` | 1,32 DH | pièce — petit pain | estimation arrondie | intégré | oui | référence du lot de 6 |
| Brioche | `brioche` | 2,74 DH | pièce | estimation arrondie | intégré | oui | référence du lot de 8 |
| Confiture | `confiture` | 18,95 DH | pot — 430 g | observé | intégré | oui |  |
| Miel | `miel` | 56,95 DH | pot — 450 g | observé | intégré | oui | référence eucalyptus |
| Amlou | `amlou` | 83,95 DH | pot — 200 g | observé | intégré | oui | traditionnel |
| Caramel à tartiner | `caramel-a-tartiner` | 64,00 DH | pot — 380 g | observé | intégré | oui |  |
| Compote de fruits | `compote-de-fruits` | 19,50 DH | pot — 390 g | observé | intégré | oui |  |
| Pâte à tartiner | `pate-a-tartiner` | 73,50 DH | pot — 600 g | observé | intégré | oui |  |
| Viande de bœuf | `viande-de-boeuf` | 149,90 DH | kg | observé | intégré | oui | référence tajine sans os |
| Agneau | `agneau` | 193,80 DH | kg | observé | intégré | oui | référence côte/filet |
| Saucisses | `saucisses` | 75,60 DH | kg | observé | intégré | non (catalogue : paquet) | référence poulet |
| Thon en conserve | `thon-en-conserve` | 11,17 DH | boîte — 80 g | estimation arrondie | intégré | oui | montant arrondi après division du lot |
| Eau minérale | `eau-minerale` | 4,45 DH | bouteille — 1,5 litre | observé | intégré | oui |  |
| Boisson gazeuse | `boisson-gazeuse` | 8,00 DH | bouteille — 1 litre | observé | intégré | oui |  |
| Jus de fruits | `jus-de-fruits` | 17,20 DH | brique — 1 litre | observé | intégré | non (catalogue : bouteille) | référence pur jus d’orange |
| Liquide vaisselle | `liquide-vaisselle` | 10,95 DH | bouteille — flacon de 750 ml | observé | intégré | oui |  |
| Assouplissant | `assouplissant` | 22,95 DH | bouteille — flacon de 1 litre | observé | intégré | oui |  |
| Eau de Javel | `eau-de-javel` | 9,98 DH | bouteille — bidon de 2,5 litres | estimation arrondie | intégré | oui | montant arrondi après division du lot |
| Déboucheur | `deboucheur` | 36,10 DH | bouteille — flacon de 1 litre | observé | intégré | oui | liquide |
| Blocs WC | `blocs-wc` | 31,50 DH | paquet — 3 blocs de 38 g | observé | intégré | oui |  |
| Aide au repassage | `aide-au-repassage` | 36,50 DH | bouteille — flacon de 500 ml | observé | intégré | oui |  |
| Papier cuisson | `papier-cuisson` | 42,95 DH | pièce — rouleau de 20 mètres | observé | intégré | oui |  |
| Essuie-tout | `essuie-tout` | 28,50 DH | paquet — 3 rouleaux | observé | intégré | oui |  |
| Papier toilette | `papier-toilette` | 54,50 DH | paquet — 12 rouleaux | observé | intégré | oui |  |
| Mouchoirs en papier | `mouchoirs-en-papier` | 15,95 DH | boîte — 100 mouchoirs | observé | intégré | non (catalogue : paquet) |  |
| Sacs-poubelle | `sacs-poubelle` | 18,95 DH | pièce — rouleau de 10 sacs de 60 litres | observé | intégré | non (catalogue : paquet) |  |
| Éponges | `eponges` | 14,00 DH | paquet — 5 | observé | intégré | oui |  |
| Gel douche | `gel-douche` | 43,50 DH | bouteille — flacon de 250 ml | observé | intégré | oui |  |
| Brosse à dents | `brosse-a-dents` | 6,95 DH | pièce | observé | intégré | oui |  |
| Bain de bouche | `bain-de-bouche` | 50,50 DH | bouteille — flacon de 500 ml | observé | intégré | oui |  |
| Crème hydratante | `creme-hydratante` | 34,50 DH | pot — 75 ml | observé | intégré | oui | référence visage |
| Rasoirs | `rasoirs` | 14,99 DH | pièce | estimation arrondie | intégré | non (catalogue : paquet) | montant arrondi après division du lot |

## En attente (conservés, sans activation)

| Produit | Clé stable | Prix transmis | Statut | Raison |
|---|---|---|---|---|
| Riz | `riz` | 64,90 DH/kg | en attente | référence basmati uniquement, pas validée pour le riz générique |
| Huile d’argan alimentaire | `huile-d-argan-alimentaire` | 1 100 DH/litre | en attente | référence chère à confirmer |
| Dinde | `dinde` | 75,60 DH/kg | en attente | brochettes préparées, ne pas attribuer à la dinde nature |
| Nettoyant multiusage | `nettoyant-multiusage` | 12,50 DH/flacon | en attente | volume manquant |
| Désodorisant | `desodorisant` | 19,50 DH/aérosol | en attente | volume manquant |
| Désinfectant du linge | `desinfectant-du-linge` | 48,20 DH/flacon | en attente | volume manquant |
| Liquide de rinçage pour lave-vaisselle | `liquide-de-rincage-pour-lave-vaisselle` | 19,99 DH/flacon | en attente | volume manquant |
| Déodorant | `deodorant` | 43,50 DH/pièce | en attente | format à préciser |
| Shampooing | `shampooing` | 36,95 DH/flacon | en attente | volume manquant |
| Après-shampooing | `apres-shampooing` | 41,90 DH/flacon | en attente | volume manquant |
| Dentifrice | `dentifrice` | 21,13 DH/tube | en attente | contenu du tube manquant |
| Coton | `coton` | 25,95 DH/paquet | en attente | nombre de disques manquant |

## Exclu : nettoyant sol

`nettoyant-sol` : **aucun prix**. Le montant 32,20 DH / 500 ml concernait un nettoyant four. La clé reste exclue de l'import par une règle de l'outil.

## Produits du catalogue sans prix (133 sur 243)

Jamais à zéro : « Prix à compléter » quand les prix sont activés. Coriandre, Menthe, Aneth, Brocolis, Chou, Choux-fleurs, Céleri, Fenouil, Maïs frais, Petits pois, Piments frais, Poireaux, Potiron, Radis, Épinards, Basilic, Ciboulette, Fèves fraîches, Romarin, Roquette, Fraises, Fruits de saison, Oranges, Raisins, Abricots, Cerises, Dattes, Figues, Melon, Pastèque, Prunes, Pêches, Châtaignes, Coings, Framboises, Fruit de la passion, Mûres, Papaye, Raisins secs, Beurre, Yaourt aromatisé, Yaourt nature, Yaourt à boire, Crème dessert, Fromage blanc, Lait concentré, Lait en poudre, Lben, Mozzarella, Margarine, Smen, Cumin, Lentilles, Levure chimique, Pois chiches, Poivre, Sel alimentaire, Semoule fine, Amandes, Biscuits, Cacao en poudre, Cannelle, Curcuma, Céréales, Haricots blancs, Harissa, Levure de boulanger, Noix, Olives, Paprika, Sucre glace, Sucre vanillé, Vinaigre, Chapelure, Fèves sèches, Fécule de maïs, Graines de sésame, Noix de cajou, Pesto, Pois cassés, Safran, Édulcorant, Poisson, Poulet, Viande hachée, Crevettes, Jambon de dinde, Merguez, Sardines en conserve, Frites surgelées, Petits pois surgelés, Glaces, Légumes surgelés, Poisson pané, Pâte feuilletée, Café, Pain de mie, Thé, Biscottes, Crêpes, Gâteaux secs marocains, Beurre de cacahuètes, Café en capsules, Eau gazeuse, Sirop, Tisane, Thé glacé, Lessive, Nettoyant sol, Ampoules, Dégraissant, Détartrant, Film alimentaire, Papier aluminium, Pastilles lave-vaisselle, Piles, Sacs congélation, Allume-feu, Allumettes, Briquet, Diffuseur antimoustiques, Désinfectant ménager, Détachant du linge, Insecticide, Nettoyant vitres, Savon noir ménager, Sel régénérant pour lave-vaisselle, Lingettes, Savon liquide, Couches, Protections hygiéniques, Sérum physiologique, Savon solide.
