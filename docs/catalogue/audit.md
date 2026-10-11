# Audit du catalogue (étapes 1 et 2)

## 1. Constat
| Ensemble | Nombre | Photos | Verdict |
|---|---|---|---|
| Catalogue de départ | 80 | 80 présentes, WebP 512×512 | **Les 80 ont été vérifiées visuellement** (planches `planches/initial-01…04.png`, nom sous chaque photo) : chaque image représente bien son produit. Deux détails optionnels : « Levure chimique » et « Eau de Javel » portent le mot générique « LEVURE » / « JAVEL » sur l'emballage. |
| Catalogue étendu (code, migration 004) | 100 | **aucune** | Tous sans photo : ils s'affichaient avec un emoji. Remplacé par un état explicite « Photo à venir ». |
| Articles propres à chaque famille (saisis à la main, désactivés) | variable | variable | **Non lisibles depuis ici** (pas d'accès à la base de production). Un point d'audit administrateur est livré : `GET /api/catalog/audit` (source de la photo : catalogue / famille / aucune ; photo partagée par des noms différents). Le cas « papier cuisson avec une photo d'éponge » se verra ainsi ; il sera corrigé par la photo du catalogue (si la photo erronée est une photo commune) ou par « Modifier » (si c'est une photo personnelle). |

Défaut technique corrigé : les identifiants du catalogue étendu sont des UUID tirés au hasard par base, donc inutilisables pour rattacher une image de façon identique entre environnements. La migration 013 ajoute une **clé stable** (slug du nom) ; le manifeste d'images et l'import l'utilisent.

## 2. Recoupements examinés (aucune suppression automatique)
| Cas | Décision proposée |
|---|---|
| Laitue (départ) / Salade verte (étendu) | Garder les deux : Laitue = pommée, Salade verte = feuilles (photo distincte). |
| Pain / Baguette / Pain de mie / Pain complet | Garder : produits distincts. |
| Biscuits / Gâteaux secs | Garder : industriels vs gâteaux secs marocains. |
| Huile de table (départ) | À trancher : garder le nom courant « Huile de table » (recommandé) ou renommer « Huile végétale » (même article, historique conservé). |
| Sel (départ) | Renommer « Sel alimentaire » (même identifiant), pour le distinguer du « Sel régénérant pour lave-vaisselle ». |
| Lait d'amande (étendu) | Faire évoluer en « Boisson végétale » (amande/avoine/soja) : même clé, mêmes données ; les articles déjà ajoutés gardent leur nom. |
| Raisins / Raisins secs ; Fèves fraîches / Fèves sèches ; Beurre / Smen ; Maïs / Maïs en conserve ; Piments / Piment en poudre | Distincts, notés dans la liste. |
| Papier cuisson / Papier aluminium / Film alimentaire | Trois articles distincts. |
| Doublons exacts entre départ, étendu et ajouts | **Aucun** (contrôle automatique par nom et par clé dans `scripts/catalogue-docs.py`). |

## 3. Liste finale et manifeste
- `liste-finale.md` / `.csv` : 244 produits (80 + 100 + 64 ajouts proposés), avec catégorie, unité, existe/nouveau, état de la photo.
- `manifeste-images.csv` / `.json` : les **164 images à produire** (100 + 64), id stable `extended:<clé>`, nom exact, nom de fichier attendu `<clé>.webp`, description précise.
- Les produits occasionnels (entretien, accessoires, épices rares…) sont dans « Tous les produits » mais **ne sont activés dans aucune famille** : ajout d'un clic.
