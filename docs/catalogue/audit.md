# Audit et décisions du catalogue

## Constat
| Ensemble | Nombre | Photos |
|---|---|---|
| Catalogue de départ | 80 | 80 présentes et **vérifiées une à une** (planches `planches/initial-01…04.png`) ; conservées telles quelles, y compris « Levure chimique » et « Eau de Javel ». |
| Catalogue complémentaire existant | 99 visibles (+ « Salade verte » absorbée) | aucune |
| Nouveaux articles | 64 | aucune |
| **Total proposé** | **243** | **163 images à produire** (liste : `etat-photos.md`, manifeste : `manifeste-images.json` / `.csv`) |

## Décisions validées et leur mise en œuvre (migration 014, générée par `scripts/catalogue-docs.py`)
| Sujet | Mise en œuvre |
|---|---|
| Laitue / Salade verte | Une seule entrée : **Laitue**, trouvable par « salade » et « salade verte ». L'entrée « Salade verte » reste en base (marquée *absorbée par laitue*) : jamais supprimée, plus proposée. Un article familial « Salade verte » garde son identifiant et son historique et est reconnu comme la Laitue (pas de nouvelle entrée équivalente). |
| Huile de table | Nom conservé ; « huile végétale » ajouté comme terme de recherche ; aucun doublon. |
| Sel | « Sel » → **« Sel alimentaire »** (même identifiant) ; les articles familiaux encore nommés « Sel » suivent (sauf conflit de nom). « Sel régénérant pour lave-vaisselle » reste séparé. |
| Boisson végétale | « Lait d'amande » → **« Boisson végétale »** (recherches amande, avoine, soja, riz, et toujours « lait d'amande »). Les articles familiaux déjà ajoutés gardent leur nom et leurs données. |
| Gâteaux secs | « Gâteaux secs » → **« Gâteaux secs marocains »** (photo adaptée), distinct de « Biscuits ». |
| Maïs / Piments | « **Maïs frais** » / « **Piments frais** » (anciens noms toujours reconnus) ; « Maïs en conserve » et « Piment en poudre » séparés. |
| Paires conservées | Pain, Baguette, Pain de mie, Pain complet ; Raisins / Raisins secs ; Fèves fraîches / Fèves sèches ; Beurre / Smen. |
| Activation | Aucun nouvel article n'est activé dans une famille : tous sont dans « Tous les produits », la famille choisit. |
| Unités | Colonnes distinctes dans `liste-finale.md` : **unité proposée** (nouvel article / nouvelle famille), **unité actuelle du catalogue de départ**, **unité configurée dans la famille** (non lisible depuis ici : visible dans Réglages → Catalogue → Mes produits). Bouteille pour les huiles, boîte pour les conserves (thon, sardines, concentré de tomates, maïs…). **Aucune unité d'une famille existante n'est modifiée** (les unités du catalogue de départ ne s'appliquent qu'aux nouvelles familles). |
| Doublons | Aucun entre départ, complémentaire et nouveaux (contrôle automatique par nom et par clé). |

## Photo erronée (ex. papier cuisson avec une éponge)
Réglages → Catalogue → **Mes produits** : chaque article affiche l'origine de sa photo (du catalogue / de la famille / aucune) et si elle est **partagée avec un autre article**. Filtres : *À vérifier*, *Photos de la famille*, *Sans photo*. Quand le catalogue possède la photo du **même nom** (jamais déduite de la catégorie), le bouton **Photo du catalogue** ouvre une comparaison Actuelle / Catalogue et remplace seulement cet article, y compris si la photo actuelle est personnelle. Les autres photos personnelles ne sont pas touchées. Sinon : **Modifier** pour envoyer la bonne photo.
