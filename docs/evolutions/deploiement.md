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

1. Juste avant : `/health` (commit et migration actifs) et sauvegarde quotidienne de moins de 24 h confirmée par le bilan.
2. Fusion sans réécriture d'historique : `git merge --no-ff origin/claude/evolutions-avancees` dans la branche suivie par Railway, puis envoi.
3. Railway reconstruit et redémarre ; les migrations 023, 024 et 025 s'appliquent au démarrage.
4. Contrôles en lecture seule : `/health` → `"schema":"025_budget.sql"` et le commit fusionné ; workflow « Vérification de la production (lecture seule) ».
5. Contrôle fonctionnel sur une famille jetable uniquement (jamais la famille personnelle ni celle de la revue Google), puis suppression de cette famille.
6. Installation de l'APK livré pour la recette sur téléphone.

## 4. Retour arrière

| Situation | Action | Effet |
|---|---|---|
| Une option pose problème | Paramètres avancés → la désactiver | Masquée pour toute la famille, données conservées |
| Le nouveau serveur pose problème | Redéployer `reference/serveur-022` sur Railway | Contrôlé : l'ancien serveur démarre sur le schéma 025 (il ignore les migrations qu'il ne connaît pas) ; ses tests listes, suppression de liste, suppression de compte et réinitialisation de famille passent sur ce schéma (54/54) |
| Une famille avait activé « Plusieurs listes » | Avant de redéployer l'ancien serveur : désactiver l'option (impossible tant que plusieurs listes sont en cours ; aucune fusion automatique) | L'ancien serveur suppose une liste en cours par famille |
| Une famille a des données de budget | Rien à faire pour l'usage courant (l'ancien serveur ignore ces tables) | Limite : avec l'ancien serveur, la suppression définitive de **cette** famille échoue proprement (transaction annulée, rien de perdu) tant que le nouveau code n'est pas revenu |
| Application Android | Réinstaller une version construite depuis `reference/android-1.0.2-1144` avec un versionCode supérieur | Même identifiant et même clé |
| Base de données | Restauration seulement sur décision explicite | Perd tout ce qui a été saisi depuis la sauvegarde ; jamais automatique |

Les migrations ne sont pas annulées par un retour arrière : elles sont additives et sans effet pour l'ancien code.
