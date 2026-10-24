# Unités corrigées, historique des achats, mise à jour de l'application

Branche de développement : `claude/unites-statistiques`.
**Non déployée.** Aucun déploiement en production ni publication Google Play sans l'accord explicite du propriétaire.

## Versions de départ (relevées le 24/10/2026, avant toute modification)

| Élément | Version |
|---|---|
| Serveur en production (`/health`) | commit **`bb8f627`** (branche `codex/fix-profile-family-city`), schéma **025** |
| Branche suivie par Railway | `claude/family-shopping-list-specs-eqevg8`, mais Railway a été fixé sur `bb8f627` par Codex. **À vérifier dans Railway avant tout déploiement** |
| Branche de production | `4dd1ac5` (fusion de l'identifiant famille, migration 026), **jamais déployée** : Railway n'a pas lancé le déploiement |
| Application de recette | APK 1188 (identifiant famille) |

La branche de travail part de `4dd1ac5` et **intègre le correctif Codex** par une fusion (`5823ca4`) : un nouveau membre reprend la
localisation confirmée de sa famille, sans ressaisir sa ville. Les tests Codex passent avec l'identifiant famille.

## 1. Unités, formats et prix (migration 027, régénérée selon les arbitrages du 24/10/2026)

Le détail article par article est dans [`tableau-unites-prix.md`](tableau-unites-prix.md) (et `.csv`).

- **244 références** prennent leur unité retenue. Thé et Tisane, anciennes références en boîte, sont conservés tels quels.
- **Nouvelles unités comptées** : botte, rouleau, sachet, cube. Poids saisi en g ou kg, volume en mL ou L.
- **Nouvelles références** :
  - Lessive en poudre, Capsules de lessive ;
  - Savon noir en pâte ;
  - Glace en bac ;
  - Thé et Tisane en vrac et en sachets.
- **Renommées, en gardant leur identifiant et leurs achats** : Lessive → Lessive liquide, Savon noir ménager → Savon noir liquide,
  Glaces → Glace individuelle.
- **Format du produit** : champ facultatif, propre à chaque famille (« pot de 350 g », « boîte de 16 portions »). Il se modifie dans
  Gestion des prix et s'affiche au moment de choisir l'article. Il n'entraîne aucune conversion, et l'enregistrer seul ne crée
  pas de prix personnel.
- **Familles** :
  - une unité venue du catalogue est corrigée ;
  - une unité personnalisée est conservée et inscrite au journal (`unit_kept_custom`) ;
  - les produits créés par la famille ne sont jamais modifiés.
- **Prix** : conversion seulement quand la quantité de référence est écrite. Le montant est inchangé (« 9,90 DH / 500 g », soit
  19,80 DH/kg, jamais arrondi). Sinon le prix est conservé tel quel et signalé « à confirmer » (« Unité changée : prix à
  ressaisir »). Aucun prix proposé non vérifié n'est importé.
- **Jamais modifiés** : lignes de listes, achats, événements, favoris. Une ligne de liste, un brouillon, un favori ou un achat
  gardent l'unité de leur enregistrement : rien n'est additionné ni converti d'une unité à l'autre.
- **Enchaînement** : la production est en 025 ; au démarrage, 026, 027 puis 028 s'appliquent dans cet ordre, chacune dans sa
  propre transaction, après la sauvegarde vérifiée. Ce chemin est testé sur une base au schéma 025.

## 2. Statistiques : tous les produits achetés et historique d'un produit

- L'aperçu « Produits les plus achetés » (8 produits) est conservé, avec le bouton **« Voir tous les produits (N) »**.
- « Tous les produits achetés » : tous les produits de la période (rechargés depuis le serveur, pas les 8 de l'aperçu), avec la
  période affichée. Chaque ligne montre la photo, le nom, « 3 achats » et la quantité cumulée par unité. Classement par nombre
  d'achats, égalités par ordre alphabétique.
- « Rechercher un produit… » : sur toute la liste, partie du nom, sans majuscules ni accents (« oeu » trouve « Œufs »), bouton
  d'effacement, message « Aucun produit acheté ne correspond à votre recherche ».
- « Historique des achats » (depuis l'aperçu, la liste ou la recherche) : photo, nom, période, nombre d'achats, quantité cumulée,
  puis chaque achat du plus récent au plus ancien (date, quantité et unité enregistrées, nom de la liste, personne qui a coché).
  **« Tout l'historique »** montre les achats plus anciens. Le retour garde la recherche, la période et la position.
- Unités différentes : totaux séparés (« 2 kg et 2 paquets »), jamais additionnés.
- Fiabilité : seuls les articles cochés « Acheté » comptent. Les achats corrigés sont exclus. Un renvoi réseau n'est pas compté deux
  fois. Le regroupement se fait par identifiant de produit. Un produit retiré du catalogue reste consultable.
- Aucun prix indicatif présenté comme dépense ; aucun paiement par magasin réparti entre les produits.
- États distincts : chargement, historique vide, erreur avec « Réessayer ». Une erreur n'est jamais présentée comme une absence
  d'achats.
- Droits inchangés (parents et administrateurs) ; une famille ne voit jamais les achats d'une autre (404).
- **Date d'achat** : désormais le moment où « Acheté » a été coché sur le téléphone, même envoyé plus tard hors connexion, dans la
  même fenêtre plausible que les validations. Les achats existants gardent la date enregistrée. La date de clôture d'une liste
  n'est jamais présentée comme une date d'achat.

## 3. Mise à jour de l'application (migration 028)

| Mode | Condition (versionCode Android) | Écran |
|---|---|---|
| Aucune | version installée ≥ version conseillée | rien |
| Conseillée | installée < **version conseillée** | « Une nouvelle version de Mes Courses est disponible. » — **Mettre à jour** / **Plus tard** (une fois par ouverture ; « Plus tard » vaut 24 h) |
| Obligatoire | installée < **version minimale** | « Pour continuer à utiliser Mes Courses, veuillez mettre à jour l'application. Vos données seront conservées. » — **Mettre à jour** seulement |

- « Mettre à jour » ouvre la fiche
  [Mes Courses sur Google Play](https://play.google.com/store/apps/details?id=app.smartcourse.courses.natif), ou le navigateur si
  Google Play ne peut pas s'ouvrir.
- La vérification a lieu à l'ouverture et à chaque retour dans l'application (dont le retour de Google Play), avant comme après la
  connexion. Serveur injoignable : aucun blocage.
- Rien n'est effacé : la liste, la saisie et les envois en attente restent sous l'écran. L'application ne demande jamais de
  désinstaller ni d'effacer des données.
- **Désactivée par défaut.** Publier une version ne la rend jamais obligatoire.

### Où et comment l'activer

1. Ouvrir `https://<serveur>/gestion` et se connecter avec un profil **gestionnaire** de Mes Courses, comme pour les propositions
   au catalogue. Un administrateur de famille n'y a pas accès.
2. Ouvrir `https://<serveur>/gestion/mise-a-jour`.
3. **Mise à jour conseillée** : saisir le versionCode publié (exemple : 1195) dans « Version conseillée », puis Enregistrer.
4. **Mise à jour obligatoire**, seulement quand la version est réellement disponible sur Google Play pour toutes les personnes
   concernées, testeurs compris :
   - saisir la version minimale (≤ version conseillée) ;
   - cocher la confirmation de disponibilité ;
   - Enregistrer.

   Sans la case, le serveur refuse.
5. **Annuler l'obligation** : bouton « Annuler l'obligation maintenant ». L'effet est immédiat, sans redéploiement.
6. Chaque changement est journalisé (date, versions, auteur, note).

## Vérifications

- Serveur : suite complète, 377 tests ; nouveaux :
  - `unit-corrections` (migration 027 sur une base remplie) ;
  - `stats-history` (produit hors du top 8, recherche, dates et quantités, plusieurs achats, tout l'historique, unités séparées, changement d'unité sans effet sur les anciens achats, produit retiré, achat corrigé, renvoi réseau, date réelle d'achat, isolation entre familles, droits) ;
  - `app-update`.
- Émulateur (GitHub Actions, parcours ciblés) :
  - **U** : unités, ligne ancienne, prix à ressaisir ;
  - **L** : liste complète, recherche, historique, tout l'historique, retour ;
  - **Z** : aucune, conseillée, obligatoire, Google Play, retour, Retour, panne réseau, annulation, après mise à jour, données.

## Retour arrière

| Situation | Conduite | Données |
|---|---|---|
| Problème sur le nouveau serveur | Redéployer `reference/serveur-026-codex` (`5823ca4` = identifiant famille + correctif Codex). Il ignore 027 et 028 ; les unités corrigées sont des valeurs qu'il connaît déjà | Aucune donnée supprimée |
| Retour à un serveur 025 | `reference/serveur-025-compat-026` (voir identifiant-famille.md), jamais `bb8f627` seul après la migration 026 | — |
| Annuler la correction des unités | Seulement avec l'accord du propriétaire : requêtes ci-dessous, depuis le journal `unit_corrections` (n'annule que ce que 027 a fait et qui n'a pas été modifié depuis) | Lignes, achats, favoris jamais touchés |
| Mise à jour obligatoire mal réglée | « Annuler l'obligation maintenant » (/gestion/mise-a-jour) | — |
| Application | L'APK 1188 fonctionne avec ce serveur (statistiques déjà connues, sans l'historique détaillé) | — |

```sql
-- Annulation de 027 (sur accord du propriétaire, après une sauvegarde vérifiée). N'annule que ce que 027 a fait et qui n'a pas été
-- modifié depuis. Les nouvelles unités, la colonne « format » et les 8 nouvelles références restent (inutilisées, sans effet).
UPDATE initial_catalog i SET unit = c.old_unit FROM unit_corrections c WHERE c.migration='027' AND c.subject='initial_catalog' AND c.outcome='unit_changed' AND c.ref=i.key AND i.unit=c.new_unit;
UPDATE extended_catalog e SET unit = c.old_unit FROM unit_corrections c WHERE c.migration='027' AND c.subject='extended_catalog' AND c.outcome='unit_changed' AND c.ref=e.key AND e.unit=c.new_unit;
UPDATE products p SET unit = c.old_unit FROM unit_corrections c WHERE c.migration='027' AND c.subject='product' AND c.outcome='unit_changed' AND c.ref=p.id::text AND p.unit=c.new_unit;
UPDATE initial_catalog i SET name = c.old_value->>'name' FROM unit_corrections c WHERE c.migration='027' AND c.subject='initial_catalog' AND c.outcome='renamed' AND c.ref=i.key AND i.name=c.new_value->>'name';
UPDATE extended_catalog e SET name = c.old_value->>'name' FROM unit_corrections c WHERE c.migration='027' AND c.subject='extended_catalog' AND c.outcome='renamed' AND c.ref=e.key AND e.name=c.new_value->>'name';
UPDATE products p SET name = c.old_value->>'name' FROM unit_corrections c WHERE c.migration='027' AND c.subject='product' AND c.outcome='renamed' AND c.ref=p.id::text AND p.name=c.new_value->>'name';
UPDATE family_prices f SET ref_qty=(c.old_value->>'refQty')::numeric, ref_unit=c.old_value->>'refUnit', packaging=c.old_value->>'packaging', piece_weight_g=(c.old_value->>'pieceWeightG')::numeric
  FROM unit_corrections c WHERE c.migration='027' AND c.subject='family_price' AND c.outcome='price_converted' AND c.family_id=f.family_id AND c.ref=f.product_id::text
   AND f.amount=(c.new_value->>'amount')::numeric AND f.ref_qty=(c.new_value->>'refQty')::numeric AND f.ref_unit=c.new_value->>'refUnit';
UPDATE base_prices b SET ref_qty=(c.old_value->>'refQty')::numeric, ref_unit=c.old_value->>'refUnit', packaging=c.old_value->>'packaging', piece_weight_g=(c.old_value->>'pieceWeightG')::numeric
  FROM unit_corrections c WHERE c.migration='027' AND c.subject='base_price' AND c.outcome='price_converted' AND c.ref=b.origin||':'||b.key
   AND b.ref_qty=(c.new_value->>'refQty')::numeric AND b.ref_unit=c.new_value->>'refUnit';
UPDATE families SET catalog_rev = catalog_rev + 1;
```

## Déploiement (soumis à l'accord du propriétaire)

1. Vérifier dans Railway la source actuelle du service (branche, ou commit `bb8f627` fixé par Codex). La nouvelle version contient
   `bb8f627` : rien n'est écrasé.
2. Aperçu des cas des familles : workflow `verif-sauvegarde.yml` avec `apercu_027`. La dernière sauvegarde est restaurée dans une
   base jetable, la 027 y est jouée dans une transaction annulée, et seuls des totaux anonymes sont publiés. Le 24/10, l'aperçu
   n'a pas pu lire le stockage (403 `SignatureDoesNotMatch`) : les secrets GitHub `S3_*` doivent être recopiés depuis les
   variables Railway.
3. Contrôle préalable : restauration isolée de la sauvegarde la plus récente, copie protégée (`conserver_verifiee`).
4. Pull request `claude/unites-statistiques` → `claude/family-shopping-list-specs-eqevg8`, ou redéploiement Railway sur son
   commit. Au démarrage : sauvegarde vérifiée avant migration (arrêt sans migrer sinon), puis 026, 027, 028.
5. Contrôles ciblés sur une famille jetable ; `/health` doit afficher `028_app_update.sql`.
6. Publication Google Play par le propriétaire. Puis, seulement après disponibilité confirmée pour tous les utilisateurs concernés,
   réglage de la mise à jour conseillée ou obligatoire.

## Livraison de recette (non publiée)

- APK/AAB signés (clé habituelle) : versionCode **1192**, pré-version
  [`courses-natif-play-1.0.2-92`](https://github.com/adilam2026/SmartCourse/releases/tag/courses-natif-play-1.0.2-92),
  construits depuis `f548b98` après les parcours U, L et Z réussis sur le même code (32/32, runs 91 et 92, aucun plantage).
- Avec le serveur actuel de production (`bb8f627`, 025), cet APK :
  - garde les unités actuelles (la migration 027 n'est pas appliquée) ;
  - n'affiche aucun message de mise à jour (route absente) ;
  - montre « Tout l'historique » en erreur explicite, avec « Réessayer », et jamais comme une absence d'achats.

  Le reste fonctionne normalement.
