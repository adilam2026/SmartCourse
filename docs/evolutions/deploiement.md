# Déploiement des évolutions avancées — plan réversible

État : **préparé, non exécuté**. Rien n'est déployé en production sans l'accord explicite du propriétaire.
Aucune publication sur Google Play.

## 1. Ce qui sera déployé

| Élément | Contenu |
|---|---|
| Serveur et application web | Branche `claude/evolutions-avancees`, fusionnée dans la branche suivie par Railway (`claude/family-shopping-list-specs-eqevg8`, aujourd'hui `f460829`) |
| Migration 023 | Pays et ville **de la famille** (colonnes ajoutées ; aucune famille existante n'est supposée au Maroc) |
| Migration 024 | Paramètres avancés (désactivés pour toutes les familles), listes nommées, liste consultée par profil, déclencheur « une liste en cours » à la place de l'index unique (même erreur 23505) |
| Migration 025 | Module Budget : tables nouvelles seulement (`finance_*`, `list_payment_status`) |
| Application Android | APK et AAB signés (même identifiant `app.smartcourse.courses.natif`, même clé), versionCode > 1144 |

Toutes les migrations sont **additives** : aucune colonne existante supprimée ni modifiée, aucune donnée réécrite.
Elles s'exécutent au démarrage du serveur (une transaction par migration ; un échec annule la migration et le serveur ne démarre pas).
Effet immédiat pour les familles : aucun. Les deux options avancées sont désactivées ; seuls changent l'acceptation des codes de 6 à 8 chiffres et la demande de confirmation du pays aux administrateurs.

## 2. Préalables (bloquants)

1. **Restauration de contrôle réussie d'une sauvegarde récente**, dans un serveur PostgreSQL isolé et jetable — jamais la production :
   workflow « Sauvegarde de production — restauration de contrôle dans une base isolée » (`.github/workflows/verif-sauvegarde.yml`).
   Il lit les secrets GitHub du dépôt (Actions → Repository secrets) portant les mêmes noms que les variables Railway : `BACKUP_KEY`, `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` et, s'il existe, `S3_FORCE_PATH_STYLE`. Leurs valeurs ne sont jamais affichées.
   Le programme ne reçoit aucune adresse de la base de production et refuse toute cible autre que le serveur jetable local.
   Bilan attendu (sans secret) : date de la sauvegarde la plus récente, résultat, nombre de tables conformes, migrations, invariants, photos.
2. **Accord explicite** du propriétaire, après lecture de ce bilan.

## 3. Étapes de déploiement

1. **Copie protégée de la sauvegarde déjà vérifiée** (17/10/2026, 09:18 UTC) sous `backups-conservees/` : ce préfixe n'est jamais élagué.
2. Fusion sans réécriture d'historique de `claude/evolutions-avancees` dans la branche suivie par Railway, puis envoi.
3. Au démarrage du nouveau serveur, **avant toute migration** : sauvegarde neuve, restaurée dans une base temporaire et comparée à son manifeste (tables, migrations, invariants, photos). Si elle n'est pas exploitable, le serveur s'arrête sans migrer ; grâce au contrôle de santé `/health`, Railway laisse l'ancienne version en service. Aucune sauvegarde n'est supprimée à cette étape.
4. Migrations 023, 024, 025. Options « Plusieurs listes actives » et « Gestion du budget » désactivées pour toutes les familles.
5. Contrôles rapides : `/health` (commit, `025_budget.sql`) ; restauration isolée de la sauvegarde d'avant migration (workflow), puis copie protégée ; famille jetable : activation de « Plusieurs listes actives » et du Budget avec choix de devise, puis suppression de cette famille. Jamais la famille du propriétaire ni celle de la revue Google.

## 4. Retour arrière

**Cible : la branche `reference/serveur-022-compat`** (ancien serveur 022 + correctif minimal), à redéployer sur Railway. Les migrations restent en place : elles sont additives, l'ancien code les ignore (54 tests réussis sur le schéma 025, plus un test du cas « plusieurs listes »).

| Situation | Conduite | Données |
|---|---|---|
| Une famille a **plusieurs listes en cours** | Désactiver l'option ne suffit pas (le serveur la refuse tant que plusieurs listes sont en cours, et la clôture des listes en trop changerait leur sens). On redéploie directement `reference/serveur-022-compat` : avec plusieurs listes en cours, il travaille toujours sur **la plus récente** ; les autres restent en cours, intactes (articles, quantités, achats) et réapparaissent dès le retour du nouveau serveur. L'ancien serveur 022 non corrigé, lui, en choisirait une au hasard à chaque requête : il ne doit pas être utilisé dans ce cas. | Aucune liste fusionnée, clôturée ni supprimée |
| Une famille a des **données de budget** | Rien à faire : l'ancien serveur ignore ces tables ; elles réapparaissent au retour du nouveau serveur | Aucune donnée financière supprimée ni modifiée. Limite : la suppression définitive de cette famille échoue proprement (rien de perdu) tant que l'ancien serveur tourne |
| Une option pose problème sans retour arrière | Paramètres avancés → la désactiver | Données conservées |
| Application Android | Version construite depuis `reference/android-1.0.2-1144` avec un versionCode supérieur ; l'APK 1166 fonctionne aussi avec l'ancien serveur (options inactives avec un message clair) | — |
| Base de données | **Jamais de restauration d'une sauvegarde en production sans l'accord explicite du propriétaire** (elle perdrait tout ce qui a été saisi depuis) | Copies protégées disponibles sous `backups-conservees/` |
