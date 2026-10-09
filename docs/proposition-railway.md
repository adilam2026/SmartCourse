# Proposition de déploiement permanent sur Railway

**Statut : proposition. Rien n'est déployé, aucune limite Railway n'est modifiée.** Je ne crée ni projet ni service, et je ne touche ni au plafond COMPUTE (10 $), ni à l'alerte (5 $), ni à AGENT (0 $), avant votre accord écrit sur ce document.

## 1. Architecture proposée

Un seul **projet Railway** dédié, trois ressources :

| Ressource | Rôle | Remarques |
|---|---|---|
| **Service « app »** (Dockerfile du dépôt) | API Node 22 + PWA + flux temps réel + sauvegardes planifiées | 1 instance, `/health` comme contrôle de santé, domaine HTTPS généré par Railway (`*.up.railway.app`) ; domaine personnalisé facultatif (achat du nom hors Railway) |
| **PostgreSQL** (modèle Railway) + **volume** | Profils, listes, achats, catalogue, références des images | Base < 10 Mo ; version majeure 16/17/18 prise en charge (clients `pg_dump` embarqués) |
| **Bucket** (stockage S3 de Railway) | (1) images : 80 visuels du catalogue + images ajoutées par la famille ; (2) sauvegardes chiffrées de la base (`backups/`) | Photos 512 px WebP, ≈ 30 Ko pièce : moins de 0,05 Go au total |

Pas de service cron : les sauvegardes sont planifiées par l'application (toutes les 24 h, restauration de contrôle après chacune, rétention 7 jours / 4 semaines / 3 mois). Pas de service supplémentaire, donc pas de coût en plus.

## 2. Stockage des images
- Les 80 visuels sont **dans l'image Docker** et importés dans le bucket au premier démarrage (vérifié : 80 fichiers, puis plus aucun changement au redémarrage).
- Les images ajoutées par la famille vont **directement dans le bucket**, jamais écrasées par une mise à jour.
- Une purge supprime toute image qu'aucun produit, catalogue ou archive ne référence (jamais celles de moins de 10 minutes).
- **Sans variables `S3_*` l'application refuse de planifier des sauvegardes** et les images iraient dans le disque du conteneur (effacé à chaque redéploiement) : le bucket est donc obligatoire.

## 3. Sauvegardes
Détail dans `deploiement.md` §5. À retenir : chiffrées (AES-256-GCM) avec `BACKUP_KEY` — **à conserver hors Railway**, sinon les sauvegardes sont illisibles ; une sauvegarde n'est comptée valide qu'après restauration vérifiée ; l'état est visible dans Réglages → Profils.

**Trou à connaître** : les sauvegardes couvrent la base, **pas les fichiers du bucket**. Les images ajoutées par la famille ne sont donc protégées que par la durabilité du bucket Railway. Les 80 visuels se réimportent seuls. *Option à décider* : exporter aussi les images familiales dans la sauvegarde (petit développement, quelques Mo).

## 4. Coût estimé (voir `couts.md`)

| Poste | Estimation mensuelle |
|---|---|
| Service app (≈ 0,11 Go de mémoire, CPU quasi nul) | ≈ 1,2 $ |
| PostgreSQL (≈ 0,09–0,15 Go) + volume | ≈ 1,0–1,6 $ |
| Bucket (< 0,05 Go) | < 0,01 $ |
| Réseau | négligeable (photos mises en cache sur les téléphones) |
| **Total application** | **≈ 2,5 à 3,5 $, fourchette prudente jusqu'à ≈ 6 $** |

Ce sont des **estimations d'après des mesures locales**, pas des mesures Railway. S'y ajoute éventuellement l'abonnement de votre plan Railway, que je ne connais pas (le plan Hobby était relevé à 5 $/mois incluant 5 $ de consommation : à confirmer sur votre compte).

## 5. Vos limites et le risque principal (sans les modifier)
- Plafond COMPUTE **10 $** et alerte **5 $** sont **par workspace** : à 10 $ **tous** les services du workspace s'arrêtent, pas seulement SmartCourse, et la famille n'aurait plus accès à la liste (ni sauvegardes pendant l'arrêt).
- Cette application (≈ 3 $) tient dans le plafond **si vos autres projets consomment peu**. Avant tout déploiement : relevez la consommation actuelle du workspace (page Usage) ; si elle dépasse ≈ 5 $, il faudra décider (hors de ma compétence, je ne le fais pas) : réduire d'autres services, créer un workspace séparé, ou relever le plafond.
- L'alerte à 5 $ n'arrête rien : elle prévient seulement.

## 6. Plan de mise en service (après votre accord)
1. Vous : confirmer la **branche à déployer** (`main` après fusion, ou la branche actuelle) et la **région** (Europe recommandée, proche du Maroc ; non modifiable ensuite sans recréer).
2. Création du projet : PostgreSQL + Bucket + service depuis le dépôt (Dockerfile). Variables : `DATABASE_URL`, `S3_*`, `BACKUP_KEY` (que vous notez hors Railway), `INSTALL_TOKEN` (usage unique).
3. Premier démarrage : vérifier dans les journaux « Images du catalogue : 80 remplacée(s) ou ajoutée(s) » puis `/health`.
4. **Vérification de bout en bout sur l'adresse Railway** avec `scripts/check-tunnel.mjs` (mêmes contrôles que le tunnel de recette : installabilité, cookie Secure, temps réel, grosse image, hors connexion).
5. Première installation (jeton), suppression de `INSTALL_TOKEN`, création des profils, **recette sur téléphone** (`recette-android.md`).
6. Contrôle des sauvegardes : première sauvegarde ≈ 30 s après le démarrage, restauration vérifiée visible dans Réglages.
7. Suivi des coûts réels pendant une semaine (page Usage), puis mise à jour de `couts.md`.

## 7. Ce que j'ai besoin de vous
- « OK pour déployer » ou modifications à cette proposition ;
- branche et région ;
- la consommation actuelle du workspace (ou autorisation de la lire si vous me donnez un accès, ce que je ne demande pas) ;
- votre décision sur l'option « images familiales dans les sauvegardes ».
