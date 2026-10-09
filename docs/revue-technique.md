# Revue technique — Application familiale de liste de courses

Version 2 — corrigée après validation de la revue initiale. Ce document est la référence technique ; le cahier des charges fonctionnel (v1) reste la référence des parcours.

## 1. Décisions validées

| # | Sujet | Décision |
|---|---|---|
| 1 | Administration | Plusieurs administrateurs. Jeton d'installation à consommation atomique pour créer la première famille. Réinitialisation de code entre administrateurs + procédure de secours. Le dernier administrateur actif ne peut être ni désactivé ni rétrogradé. |
| 2 | Produit désactivé | Reste dans la liste active avec son état. Achetable, retirable s'il n'est pas acheté, non ajoutable. Visible du personnel tant qu'il appartient à la liste. |
| 3 | Aucune liste active | Écran « Aucune liste en cours », actualisation automatique à la création d'une liste. |
| 4 | Hors connexion | Sélections et validations du personnel conservées en attente. Achats et corrections **bloqués** tant que le serveur est inaccessible. Bandeau hors connexion visible. Cette règle ne garantit pas l'absence de double achat physique. |
| 5 | Brouillon d'une liste clôturée | Jamais appliqué automatiquement. Reprise explicite dans la nouvelle liste. |
| 6 | Catalogue / photos | 80 références génériques. Photos recherchées avec licences et attributions. Sélection de marques à valider avant figement des images. Recherche administrateur dans le catalogue étendu **incluse en V1**. |
| 7 | Achats visibles au personnel | Indicateur « Acheté » + verrouillage seulement. |
| 8 | Archives | À la clôture : nom, marque et référence à une version immuable de la photo sont figés. |
| 9 | Concurrence | Vérification et modification dans la même transaction, avec verrous (voir §5). Révocation des flux SSE à la désactivation d'un profil. |
| 10 | Sauvegardes / coûts | Sauvegarde automatisée avec rétention et test de restauration vérifié. Coûts mesurés. Limite de dépense : voir §8. |

## 2. Architecture

```
Téléphones (PWA, IndexedDB, service worker)
        │  HTTPS + SSE
        ▼
Service « app » : Node 22 / TypeScript / Fastify — API REST, flux SSE, fichiers statiques PWA
        │                         │
        ▼                         ▼
Service « Postgres » + volume     Bucket S3 (photos, sauvegardes)
```

- Postgres est la seule référence commune. Le téléphone ne garde que le brouillon et un cache de lecture.
- Une seule instance de l'app tant que la charge est celle d'une famille (SSE alimenté par `LISTEN/NOTIFY`).
- Migrations SQL versionnées, appliquées au démarrage sous verrou consultatif.

## 3. Authentification et droits

- Identifiants : code famille + identifiant de profil + code à six chiffres.
- Code haché (scrypt, sel unique, paramètres explicites). Comparaison à temps constant.
- Six chiffres = 10⁶ combinaisons : la sécurité repose sur la limitation serveur : verrou temporaire par profil après échecs répétés (délai croissant), limitation par IP, et message d'erreur identique que le profil existe ou non (hachage factice pour égaliser le temps de réponse).
- Session : jeton opaque aléatoire, seul son hash est stocké. Vérifié en base à chaque requête (profil actif, session non révoquée). Désactiver un profil révoque ses sessions et ferme ses connexions SSE.
- Identité des auteurs d'actes (achat, correction, clôture) : toujours issue de la session.
- Isolation : `family_id` provient de la session, jamais de la requête ; toutes les requêtes sont filtrées par famille.
- Droits : table unique rôle → actions, appliquée côté serveur, testée par rôle.
- Dernier administrateur actif : désactivation et rétrogradation refusées, vérifiées sous verrou de la famille.

### Création et récupération

- **Première famille** : jeton d'installation (variable d'environnement `INSTALL_TOKEN_HASH` ou jeton à usage unique en base). Consommation atomique (`UPDATE … WHERE consumed_at IS NULL RETURNING`) : deux créations simultanées ne peuvent pas réussir toutes les deux.
- **Réinitialisation** : un administrateur réinitialise le code de n'importe quel profil (y compris un autre administrateur). Les sessions du profil sont révoquées. Le nouveau code est affiché une fois.
- **Secours** : script d'exploitation `npm run admin:reset -- <famille> <identifiant>` exécuté avec accès à la base ; il journalise l'opération.

## 4. Modèle de données

- `install_tokens` (hash, consommé le/par)
- `families` (id, code unique)
- `profiles` (id, family_id, display_name, login unique par famille, role, secret_hash, active, failed_attempts, locked_until)
- `sessions` (id, profile_id, token_hash, revoked_at, last_seen_at)
- `photo_assets` (id, famille ou global, clé bucket, hash du contenu, **immuable**, source, licence, auteur, URL d'origine, date) — une nouvelle photo = un nouvel enregistrement
- `products` (id stable, family_id, nom, catégorie, marque, active, photo_asset_id)
- `extended_catalog` (catalogue étendu global : nom, catégorie, marque, photo_asset_id)
- `lists` (id, family_id, status `active`/`archived`, créée/clôturée par/le) + index unique partiel : une liste active par famille
- `list_items` (id, list_id, family_id, product_id, status `to_buy`/`purchased`, rev, `snapshot_name`, `snapshot_brand`, `snapshot_photo_asset_id` figés à la clôture)
  - `UNIQUE (list_id, product_id)`
- `purchases` (id, list_item_id, family_id, by, at, voided_by, voided_at, void_reason) — la correction n'efface rien
- `op_log` (profile_id, op_id unique, type, résultat) — idempotence et traçabilité
- Côté téléphone : brouillon rattaché à (famille, profil, liste).

## 5. Synchronisation et concurrence

Opérations par article, identifiées par `op_id`, rattachées à une liste. Chaque opération s'exécute dans **une transaction** qui verrouille d'abord la ligne `lists` (`SELECT … FOR UPDATE`) puis, si besoin, la ligne d'article :

| Conflit | Mécanisme |
|---|---|
| achat contre retrait | `rev` de l'article + verrou de ligne : le retrait est refusé si l'article est acheté ou si `rev` a changé |
| achat contre achat | verrou de ligne ; le second constate `purchased` et répond « déjà acheté par X » sans doublon |
| correction contre nouvel achat | la correction cible un `purchase_id` ; le verrou d'article sérialise ; une correction sur un achat déjà annulé est sans effet |
| clôture contre toute modification | la clôture prend le verrou de la liste ; les opérations concurrentes l'attendent puis constatent `archived` et sont refusées |

- Un `purchase_id` ciblé par une correction est vérifié comme appartenant à la famille de la session **et** à la liste active.
- Ajouts : `INSERT … ON CONFLICT DO NOTHING` (un produit = une ligne).
- Le serveur répond opération par opération : appliquée / déjà appliquée / refusée (+ motif). Le brouillon n'est vidé qu'après cette réponse.
- États affichés : brouillon · enregistrement… · en attente de synchronisation · enregistré.
- Flux SSE : un événement par changement validé ; au retour de connexion le client recharge l'état courant (SSE peut perdre des événements). Les connexions d'un profil désactivé sont fermées immédiatement.

### Compléments d'implémentation (étape 4)

- Un article retiré n'est pas supprimé : il passe à l'état `removed` (même ligne, `rev` incrémenté). Un nouvel ajout le remet à `to_buy`. L'unicité `(list_id, product_id)` reste donc vraie.
- `rev` s'incrémente à chaque changement d'état d'un article. Un retrait porte la `rev` vue par le client (`baseRev`) : si l'article a changé depuis (acheté puis corrigé, retiré puis rajouté), le retrait est refusé « périmé » et le client doit relire l'état.
- Protocole de verrous : mutation = liste `FOR SHARE` puis article `FOR UPDATE` ; clôture = liste `FOR UPDATE`. Ordre constant liste → article → achat.
- Index uniques partiels : une liste active par famille ; un seul achat non corrigé par article.
- Défense en profondeur : des déclencheurs SQL interdisent toute écriture sur une liste archivée (y compris par SQL direct).
- Idempotence : table `op_log` (profil, `op_id`) ; rejouer une opération renvoie le résultat d'origine, y compris pour un refus.

## 6. Catalogue et photos

- 80 références génériques chargées par migration.
- Photos : stockées dans le bucket en WebP optimisé, versionnées et immuables. Chaque enregistrement conserve source, licence, auteur et URL d'origine ; les attributions requises sont affichées dans l'application (écran « Crédits photos »).
- Sources étudiées et licences vérifiées avant import : voir `docs/photos-licences.md` (créé à l'étape 3).
- À la clôture d'une liste, le nom, la marque et la photo de chaque article sont figés : les archives ne changent plus d'apparence.
- Recherche administrateur dans le catalogue étendu (V1) : jamais affiché en entier au personnel.
- Marques : sélection proposée dans `docs/marques-a-valider.md` ; les images de produits emballés ne sont figées qu'après validation.

## 7. Format mobile

PWA (React + Vite, IndexedDB). Sur iOS : pas de synchronisation en arrière-plan, donc synchronisation à l'ouverture, au retour au premier plan et au retour en ligne ; installation sur l'écran d'accueil recommandée et `navigator.storage.persist()`.

## 8. Hébergement, coûts, sauvegardes

Tarifs relevés (à confirmer sur la page tarifs avant engagement) : plan Hobby 5 $/mois incluant 5 $ de consommation ; RAM 10 $/Go/mois ; CPU 20 $/vCPU/mois ; volume 0,15 $/Go/mois ; bucket 0,015 $/Go/mois, sortie du bucket gratuite. Mesures locales et prévision (environ 2,5 à 3,5 $/mois, à confirmer en réel) : voir `couts.md`.

**Limite de dépense** : d'après les retours de la communauté Railway (documentation officielle non consultée), une limite stricte arrête les services du workspace lorsqu'elle est atteinte, et des anomalies de comptage ont été rapportées. Elle peut donc **interrompre l'application**. Elle ne sera pas activée sans votre accord ; on privilégie d'abord une alerte. Si vous l'activez, fixer une marge nettement supérieure à l'estimation.

**Sauvegardes** : les sauvegardes de volume Railway dépendent du plan (sources contradictoires). La stratégie retenue n'en dépend pas :
- `pg_dump` quotidien chiffré vers le bucket, rétention 7 quotidiennes + 4 hebdomadaires + 3 mensuelles ;
- script de restauration `npm run backup:verify` : restaure la dernière sauvegarde dans une base temporaire et contrôle des comptages et des contraintes ;
- une sauvegarde n'est comptée valide qu'après restauration vérifiée ; la date de la dernière vérification est affichée dans l'administration.

## 9. Plan par étapes (réalisé : voir README)

1. Socle : projet, migrations, santé, déploiement Railway, tests.
2. Authentification, profils, droits, jeton d'installation, révocation.
3. Catalogue (80 produits), photos, licences, recherche étendue.
4. API des listes : opérations, concurrence, clôture, archives figées.
5. PWA personnel : grille, brouillon local, « Valider ».
6. PWA parents : liste, achat, correction, clôture, historique.
7. SSE, états hors connexion, reprise.
8. Sauvegardes vérifiées, mesure des coûts, recette des 15 critères.

Chaque étape s'achève par des tests automatisés et un bilan.
