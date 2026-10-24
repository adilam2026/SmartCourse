# Consignes consolidées du 24/10/2026 : analyse avant application

Ces consignes remplacent les précédentes sur les unités. **Aucune unité ni aucun prix n'est modifié** tant que le tableau
[`tableau-unites-prix.md`](tableau-unites-prix.md) (et sa version tableur [`tableau-unites-prix.csv`](tableau-unites-prix.csv))
n'est pas validé.

## 1. Versions relevées (24/10/2026, 12 h 41 UTC)

| Élément | Valeur |
|---|---|
| Production (`/health`) | `bb8f627` (branche `codex/fix-profile-family-city`), schéma **025**, déployé par Railway le 23/10/2026 à 14 h 33 UTC (déploiement par commit) |
| Branche de production `claude/family-shopping-list-specs-eqevg8` | `4dd1ac5` (identifiant famille, 026), jamais déployée |
| Branche de travail | `claude/unites-statistiques` (correctif Codex intégré, statistiques, mise à jour, 027, 028) |
| Références de retour arrière | `reference/serveur-026-codex` (`5823ca4`), `reference/serveur-025-compat-026` (`aa64651`), `reference/android-1.0.2-1166` |
| Correctif Codex | conservé : ses tests (`profile-family-city`, `city-listdelete`, `location`) passent sur la branche de travail |

La configuration Railway elle-même (service fixé sur un commit ou suivant une branche) n'est pas lisible depuis ici : à vérifier
dans le tableau de bord avant tout déploiement.

## 2. Diagnostic : huiles « bouteille », sucre et farine « paquet »

Cause : **le catalogue et ses migrations**, ni les réglages ni la synchronisation.

- **Migration 009** : unité de départ par rayon. Épicerie et surgelés en `paquet`, boissons en `bouteille`, légumes, fruits et
  viandes en `kg`, le reste en `pièce`. Sucre et farine sont ainsi devenus « paquet ».
- **Migration 014** : huile de table et huile d'olive passées en `bouteille`, « catalogue de départ : nouvelles familles seulement ».
  Elle a volontairement laissé inchangées les unités des familles existantes.
- **Produits de la famille** : chacun garde l'unité du catalogue au moment de son ajout. L'administrateur peut ensuite la changer
  dans Réglages → Catalogue ; la synchronisation ne fait que montrer l'unité enregistrée sur le serveur.
- **Conséquence sur les prix** : la base indicative est au litre (huiles) et au kg (sucre 5,20 DH/kg, farine 6,75 DH/kg). Elle est
  donc **incompatible** avec « bouteille » ou « paquet », et l'application affiche « Prix à compléter » au lieu d'un montant faux.

## 3. Écarts avec la migration 027 préparée hier (non déployée)

La 027 actuelle suivait la demande précédente. Elle **ne sera pas déployée en l'état** et sera régénérée à partir du tableau
validé :

| Article | 027 actuelle | Consignes consolidées |
|---|---|---|
| Brocolis | pièce | **poids** |
| Persil, coriandre, menthe, céleri | pièce | botte proposée, **à confirmer** |
| Noix de coco | poids | pièce ou poids, **à confirmer** |
| Huiles, sucre, farine, lait, crèmes, yaourts, thon… | inchangés | voir le tableau (165 changements d'unité en tout) |

Le mécanisme de la 027 est conservé :
- unité corrigée dans le catalogue et dans chaque famille ;
- prix convertis seulement quand c'est exact, sinon conservés « à ressaisir » ;
- listes, achats et favoris jamais réinterprétés ;
- journal pour le retour arrière.

## 4. Modèle d'unités proposé

| Notion | Aujourd'hui | Proposition |
|---|---|---|
| Poids | unité `kg`, saisie en g ou kg | inchangé ; affichage lisible (250 g, 1,5 kg) |
| Volume | unité `litre`, saisie en mL ou L | inchangé ; affichage « mL » et « L » (250 mL) |
| Comptées | pièce, paquet, bouteille, brique, pot, boîte | pièce, boîte, pot conservés ; paquet seulement avec son contenu ; bouteille et brique ne servent plus aux nouveaux choix mais restent lisibles dans l'historique |
| Nouvelles unités comptées | — | **à confirmer** : botte, rouleau, portion, capsule, sachet, feuille, dosette (cube et comprimé si bouillon et édulcorant en ont besoin) |
| Contenu du conditionnement | seulement dans un prix (« pot de 200 g ») | **nouveau** : format du produit, affiché et facultatif (« pot de 350 g », « boîte de 80 g »), sans aucune conversion automatique |
| Décimales | virgule et point acceptés | inchangé |
| Conversions | g ↔ kg, mL ↔ L | inchangé ; jamais pièce ↔ poids ↔ volume |

## 5. Articles des consignes absents du catalogue

| Article | Rayon | À créer ? |
|---|---|---|
| Morceaux de poulet | Viandes, au poids | à confirmer (le « Poulet » actuel devient le poulet entier, à la pièce) |
| Lessive en poudre | Maison, au poids | « Lessive » actuelle à scinder (liquide / poudre) |
| Capsules de lessive | Maison, à la pièce | à confirmer |
| Savon noir en pâte | Maison, au poids | « Savon noir ménager » à scinder (liquide / pâte) |
| Glace en bac / glace individuelle | Surgelés | « Glaces » à scinder |
| Thé et tisane en sachets / en vrac | Pain et boissons | « Thé » et « Tisane » à scinder |
| Café moulu ou en grains | Pain | « Café » couvre les deux (au poids) : suffisant ? |

Tous les articles actuels du catalogue (246) sont couverts par les consignes. Aucun ne reste sans décision ; 12 restent
« à préciser » et 22 « à confirmer ».

## 6. Prix proposés (§5) comparés aux prix communs existants

Non importés. Les prix personnels des familles ne sont jamais écrasés.

| Article | Existant (12/10/2026) | Proposé (non vérifié) | Remarque |
|---|---|---|---|
| Thon en conserve | 11,17 DH / boîte de 80 g | 11 DH / boîte de 80 g | cohérent |
| Sardines en conserve | — | 7 DH / boîte de 125 g | aucun prix existant |
| Yaourt à boire | — | 5 DH / pièce de 250 mL | aucun prix existant |
| Crème de cuisson | 19,95 DH / brique de 500 ml | 12 DH / pièce de 200 mL | formats différents : aucune conversion |
| Crème fraîche | 12,95 DH / pot de 200 ml | 15 DH / pièce de 200 g | ml ou g ? à vérifier sur l'étiquette |
| Crème chantilly | 36,50 DH / bombe de 250 g | 25 DH / pièce de 250 g | écart de 31 % à vérifier |
| Crème dessert | — | 3 DH / pièce de 125 g | aucun prix existant |
| Yaourt nature / aromatisé | — | 2 / 3 DH / pot de 110 g | aucun prix existant |
| Riz | — (non importé, « en attente ») | 20 DH/kg | aucun prix existant |
| Pâtes | 10 DH / 500 g = **20 DH/kg** | 20 DH/kg | cohérent (conversion exacte) |
| Vermicelles | 9,90 DH / 500 g = **19,80 DH/kg** | 20 DH/kg | cohérent |
| Huile de table | 17,64 DH/L | 18 DH/L | cohérent |
| Huile d'olive | 47,45 DH/L | 80 DH/L | **écart de 69 %** : à vérifier (qualité ou format différents ?) |
| Nutella | — | 40 DH / pièce de 350 g | aucun prix existant |

Pour les autres articles, le tableau reprend le prix existant avec sa date. Un prix inconnu est noté « aucun prix connu », sans
rien inventer. Conversions :
- **exactes** (le contenu en poids ou en volume est écrit) : par exemple « 9,98 DH / bidon de 2,5 L » donne 3,99 DH/L ;
- **impossibles** : le prix est conservé et marqué « à ressaisir » (mangues : 13,90 DH la pièce, poids inconnu) ;
- **même contenant**, par exemple « 1 pot = 1 pièce ? » ou « paquet de 5 éponges = 5 pièces ? » : à confirmer, jamais appliquées
  automatiquement.

## 7. Statistiques et mise à jour : état par rapport aux consignes

**Statistiques** : tout est en place et testé (section 2 de unites-statistiques-mise-a-jour.md). Deux précisions :
- Affichage lisible : « 250 g », « 750 g », « 250 mL » au lieu de « 0,25 kg ».
- Date d'achat : chaque achat a une date enregistrée, le moment où l'article a été coché « Acheté ». Aucun achat ne dépend de la
  date de clôture de la liste ; le cas « seule la date de clôture est connue » n'existe donc pas dans les données.

**Mise à jour** : en place et testée. Désactivée par défaut ; réglage et annulation sur `/gestion/mise-a-jour`.
- **Fréquence** : vérification à l'ouverture de l'application, puis au plus toutes les 30 minutes au retour au premier plan.
  Elle est immédiate au retour de Google Play et tant qu'une obligation est en cours (pour lever le blocage dès que la version
  est installée, ou dès que l'obligation est annulée).
- **Hors connexion** : rien n'est bloqué faute de vérification. Une obligation déjà reçue reste affichée tant que l'application
  est ouverte. Elle n'est **pas mémorisée** après fermeture de l'application, pour ne jamais bloquer à tort une personne hors
  connexion. Elle revient à la prochaine vérification réussie.
- **Annulation** : effet à la prochaine vérification. Elle est immédiate pour les téléphones bloqués, qui revérifient à chaque
  retour au premier plan.
- **Limite** : les versions déjà installées sans ce mécanisme (1166, 1188 et antérieures) ne peuvent pas afficher ce message.
  Seules les versions 1192 et suivantes le peuvent.
- **Déploiement progressif sur Google Play** : n'activer la version minimale qu'une fois la version disponible à 100 % pour les
  pays, les testeurs et les téléphones concernés. Une version conseillée peut l'être plus tôt : « Plus tard » ne bloque rien.

## 8. Ce qui reste à décider

1. Valider le tableau ligne à ligne, en particulier :
   - les 22 propositions « à confirmer » : herbes en botte, noix de coco, papaye, melon, pastèque, fromage en portions,
     rouleaux, feuilles de brick, glaces ;
   - les 12 « à préciser » : sauce tomate, bouillon, édulcorant, thé, tisane, lessive, savon noir, insecticide, désodorisant,
     dentifrice, crème hydratante, déodorant.
2. Valider les nouvelles unités et le champ « format du produit ».
3. Dire s'il faut créer les articles du point 5.
4. Pour les prix du §5 : les importer comme prix de référence (avec la mention « proposition non vérifiée ») ou attendre des
   relevés datés (magasin, format).

Après validation : régénération de la 027 et ajout des unités et du format. Puis contrôles ciblés, APK/AAB signés, sauvegarde
vérifiée et déploiement selon le processus convenu.
