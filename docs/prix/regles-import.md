# Base initiale des prix — règles d'import

**État : le tableau validé annoncé avec la demande n'était pas joint** (aucun fichier reçu dans la session). Aucun prix n'a donc été importé : la base initiale est vide, les prix s'affichent « Prix à compléter » tant qu'ils ne sont pas saisis par une famille. L'outillage est prêt et testé ; il suffit de fournir le tableau.

## Contrôler le tableau (aucune écriture)
```
admin-cli prices-report <tableau.csv>      # tableau des lignes RETENUES et EXCLUES, avec la raison de chaque exclusion
admin-cli prices-import <tableau.csv> --execute   # écrit les lignes retenues (celles déjà présentes sont conservées ; --replace pour les remplacer)
```
Format CSV (séparateur « ; », UTF-8, voir `modele-import.csv`) : `cle_stable ; origine ; produit_observe ; montant ; quantite_reference ; unite_reference ; conditionnement ; poids_piece_g ; nature ; source ; date_capture ; statut ; remise_conditionnelle ; valide_pour_generique ; remarque`.

## Ce qui est retenu, ce qui est exclu (automatiquement, ligne par ligne)
| Règle | Effet |
|---|---|
| `cle_stable` absente du catalogue (243 produits : 80 initiaux + 163 complémentaires) | exclue |
| statut ≠ « confirmé » (« à confirmer », vide) | exclue : jamais importée comme définitive |
| montant, quantité ou unité de référence absents ou illisibles ; en g/ml une quantité non entière | exclue (format incomplet) |
| prix par conditionnement (paquet, boîte, pot, bouteille, brique) sans contenu de référence (« paquet de 250 g ») | exclue : un prix par paquet ne vaut pas pour n'importe quel paquet |
| nature inconnue (observation d'une capture / prix moyen / prix arrondi), date de capture ou source absentes | exclue |
| remise ou cashback conditionnel (colonne ou mot dans la remarque) | exclue : jamais déduit |
| `nettoyant-sol` | **toujours exclue** : 32,20 DH pour 500 ml concernait un nettoyant four ; le nettoyant sol reste sans prix |
| `dinde` dont le produit observé est des brochettes ; `riz` dont le produit observé est du basmati | exclue, sauf `valide_pour_generique = oui` (validation spécifique) |

Chaque prix importé garde : montant en MAD, unité et quantité de référence, conditionnement, **nature** (observation d'une capture, prix moyen ou prix arrondi proposé), source et date de la capture, associés à la **clé stable exacte** du produit.

## Garanties
- La base ne copie rien dans les familles et n'écrase **jamais** un prix personnalisé (le prix de la famille prime à la lecture).
- Aucune unité d'un produit déjà utilisé n'est modifiée. Une conversion kg/g ou litre/ml est possible ; pièce ↔ kg exige un poids connu ; sinon le montant n'est pas calculé et « Prix à compléter » s'affiche (prix activés).
- Un prix absent n'est jamais zéro : le total affiche un sous-total connu et « Estimation incomplète — N articles sans prix ».
- Calcul décimal exact (entiers), arrondi à la demi-unité supérieure : 0,25 kg × 9,90 DH/kg = 2,48 DH.
