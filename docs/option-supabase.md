# Option : Railway (serveur) + Supabase Free (base PostgreSQL)

**Étude, pas une décision. Rien n'est migré, rien n'est souscrit, rien n'est déployé, aucune limite Railway n'est modifiée.**
Objectif donné : rester dans les 5 $/mois déjà payés à Railway, toutes applications confondues. **Ce budget ne peut pas être garanti sans mesure** (voir §3).

## 0. Ce qui est vérifié et ce qui ne l'est pas

| Sujet | Statut |
|---|---|
| Quotas Free de Supabase : 500 Mo de base par projet, 1 Go de stockage, 5 Go de sortie (egress) | **Lu dans la documentation officielle** (dépôt GitHub `supabase/supabase`, `billing-on-supabase.mdx`) |
| Pause après 7 jours de faible activité, restauration possible 1 an ; lecture seule au-delà de 500 Mo ; pas de sauvegardes automatiques en Free ; sauvegardes ne couvrant pas le stockage de fichiers | **Lu dans la documentation officielle** (mêmes sources : `free-project-pausing`, `database-size`, `backups`) |
| Modes de connexion (direct IPv6, pooler session 5432 IPv4, pooler transaction 6543) et leurs limites | **Lu dans la documentation officielle** (`connecting-to-postgres`) |
| Compatibilité de **notre code** (verrous, transactions, connexions) | **Vérifiée par lecture du code** ; **aucun essai contre un vrai projet Supabase** (aucun accès) |
| **Vos** quotas et votre consommation Supabase | **Non vérifiables** : aucun connecteur Supabase dans votre compte, pas d'identifiants. Voir §4 |
| Consommation de **votre** workspace Railway | **Non vérifiable** (pas d'accès). Voir §3 |
| Tarifs Railway (Hobby 5 $ = 5 $ de crédit d'usage ; mémoire 10 $/Go/mois, CPU 20 $/vCPU/mois, sortie 0,05 $/Go, volume 0,15 $/Go/mois) | Sources secondaires concordantes ; la page officielle n'est pas joignable d'ici : **à reconfirmer sur votre page Usage** |
| Débit et connexions simultanées maximales du plan Free | **Non confirmés** (la page officielle renvoie à une autre page non lue) |

## 1. Comparaison chiffrée (estimations d'après mes mesures locales, pas des mesures Railway ni Supabase)

| Poste (par mois) | A. Railway seul | B. Railway (serveur) + Supabase Free (base) |
|---|---|---|
| Service applicatif Node (≈ 0,11 Go de mémoire, CPU quasi nul) | ≈ 1,2 $ | ≈ 1,2 $ |
| PostgreSQL | ≈ 1,0 à 1,6 $ (mémoire + volume) | **0 $** (Supabase Free) |
| Images (≈ 2 Mo pour les 80 visuels ; moins de 0,05 Go avec les photos de la famille) | < 0,01 $ (bucket Railway à 0,015 $/Go) | < 0,01 $ (on garde le bucket Railway) ou 0 $ (Supabase Storage / Cloudflare R2) |
| Sortie réseau Railway vers les téléphones | ≈ 0,01 $ | ≈ 0,01 $ |
| **Total application seule** | **≈ 2,5 à 3,5 $** (prudent : jusqu'à ≈ 6 $) | **≈ 1,2 à 1,6 $** (prudent : jusqu'à ≈ 2,5 $) |
| Sauvegardes indépendantes (§7) | 0 $ (dans le bucket Railway) | 0 $ (GitHub Actions + stockage gratuit), **plus de travail** |

**Gain attendu de B : environ 1 à 2 $ par mois**, soit un tiers à la moitié du coût de l'application. C'est une estimation, pas une mesure.

## 2. Coût de l'application ≠ consommation de votre workspace

Votre abonnement Hobby est de 5 $ qui **incluent** 5 $ de consommation : vous payez le plus grand des deux (5 $ ou votre consommation). Donc :

> coût supplémentaire dû à cette application = max(0 ; consommation de tous vos projets − 5 $)

- Si vos autres projets consomment **U** $/mois, l'option A reste dans les 5 $ tant que **U + (2,5 à 3,5) ≤ 5**, soit **U ≤ 1,5 à 2,5 $**.
- L'option B reste dans les 5 $ tant que **U + (1,2 à 1,6) ≤ 5**, soit **U ≤ 3,4 à 3,8 $**.
- **Je ne connais pas U.** C'est le chiffre qui décide. À relever sur la page Usage de Railway (consommation du mois en cours, par projet) avant de choisir.

Rappel de vos limites (inchangées) : alerte 5 $ (prévient seulement), plafond COMPUTE 10 $ (arrête **tous** les services du workspace), AGENT 0 $. Une consommation de 5 à 10 $ coûte donc de l'argent en plus des 5 $ payés ; 10 $ arrête tout, application familiale comprise.

## 3. Pourquoi je ne garantis pas le budget
1. U est inconnu.
2. Mes mesures sont locales : la mémoire facturée par Railway est celle du conteneur (souvent supérieure).
3. La sortie vers Supabase compte comme sortie Railway et comme sortie Supabase (§6) : faible, mais à mesurer.
4. Les 5 Go de sortie Supabase peuvent être dépassés dans un cas précis (relecture périodique, §6).

## 4. Vérifier vos quotas Supabase sans rien perturber (lecture seule, par vous)
Je n'ai aucun accès à votre compte Supabase et je n'en demande pas. Pour vérifier vous-même, sans modifier quoi que ce soit :
1. Tableau de bord Supabase → votre organisation → **Usage** : base de données (Mo), stockage (Go), sortie (Go) pour le mois en cours, **par projet**.
2. Organisation → **Billing** : plan (Free/Pro) et nombre de projets. Free : **2 projets actifs maximum**, les projets en pause ne comptent pas.
3. Vous remarquerez si un projet existant est proche de 500 Mo ou de 5 Go : le quota de **sortie est par organisation**, partagé avec vos autres applications.
4. **Recommandation de prudence : créer un projet Supabase dédié, dans une organisation séparée si possible**, pour que cette application ne consomme pas la sortie de vos autres projets et inversement.

## 5. Compatibilité de l'application avec Supabase (lecture du code)

| Point | Constat dans le code | Verdict |
|---|---|---|
| Une seule connexion PostgreSQL suffit-elle ? | Oui : `pg.Pool(max 10)` sur `DATABASE_URL`. Aucun SDK Supabase nécessaire. | **Aucune réécriture** |
| Transactions et verrous de ligne | `BEGIN … COMMIT`, `SELECT … FOR UPDATE/SHARE`, `SET LOCAL` : tout reste **dans une transaction sur une seule connexion**. | Compatibles, y compris en mode transaction |
| Verrous consultatifs **de session** | `pg_advisory_lock` dans `migrate.ts` (migrations) et `pg_try_advisory_lock` dans `backup.ts` : valables seulement sur **une même connexion qui dure**. `pg_advisory_xact_lock` (import des images) est sans problème. | **Incompatibles avec le pooler en mode transaction (6543)** ; compatibles avec le **mode session (5432)** et la connexion directe |
| `LISTEN/NOTIFY` | **Non utilisé** (le flux temps réel est tenu en mémoire dans le processus ; une seule instance). Une phrase de `revue-technique.md` le laissait entendre : elle est inexacte. | Sans objet |
| Requêtes préparées nommées | Aucune (`pg` n'en crée que si on lui donne un `name`). | Sans objet |
| Connexion IPv6 / IPv4 | La connexion **directe** de Supabase est en IPv6 seulement (IPv4 = option payante). | Utiliser le **pooler en mode session, port 5432** (IPv4, tous plans) |
| SSL | `sslmode=require` avec notre version de `pg` **vérifie** le certificat avec les autorités du système (test fait) ; Supabase utilise sa propre autorité. | Fournir son certificat racine via `NODE_EXTRA_CA_CERTS` (aucun changement de code) ; sinon la connexion échoue |
| Extensions / rôles | Aucune extension, aucun `GRANT`/rôle dans nos migrations. | Compatible |
| Déclencheurs d'immuabilité des images, historique figé | Du SQL standard. | Compatible |
| **Vérification de restauration actuelle** (`backup.ts`) | Fait `CREATE DATABASE` sur **le même serveur** puis `pg_restore` dedans. Sur Supabase, un rôle non superutilisateur et un pooler qui ne route que vers la base du projet. | **Non adaptée** : à déplacer hors de Supabase (§7). Les sauvegardes intégrées doivent rester **désactivées** (`BACKUP_KEY` absent) dans cette option |
| Client `pg_dump` | L'image embarque les clients 16, 17, 18 et choisit celui du serveur. | Compatible (version de Supabase à lire dans Database settings) |
| **Sécurité : API de données Supabase** | Nos tables sont dans le schéma `public`. Sur un projet existant, un nouveau tableau `public` reçoit tous les droits pour les rôles `anon`/`authenticated` : **sans précaution, des tables (profils, codes hachés) seraient lisibles par l'API publique avec la clé `anon`**. | **Obligatoire** : révoquer les droits et activer RLS sur toutes nos tables, ou désactiver l'API de données du projet, **avant** de lancer les migrations ; à tester |

**Conclusion de compatibilité : une chaîne de connexion suffit** (pooler session 5432, SSL avec le certificat de Supabase). Aucun SDK, aucune réécriture. Petits changements envisageables plus tard : un script de révocation des droits `anon`, une variable pour le certificat dans l'image Docker. **Je ne les ai pas faits.**

## 6. Limites du gratuit et conséquences

| Limite (Free) | Conséquence si atteinte |
|---|---|
| **Base : 500 Mo** par projet (la nôtre : 8,8 Mo avec les 80 produits ; croissance lente) | **Lecture seule** : les écritures échouent (« cannot execute INSERT in a read-only transaction ») ; la famille ne peut plus rien acheter ni cocher. Libérable en supprimant des données puis `vacuum`, sinon passage en Pro (25 $) |
| **Sortie : 5 Go/mois** (par organisation) | Comportement exact **non confirmé sur la page lue** ; Supabase applique des **restrictions** aux organisations Free qui dépassent. Prévoir une interruption possible |
| **Stockage : 1 Go** | Ajout d'images impossible au-delà ; non concerné si on garde le bucket Railway |
| **Pause après 7 jours sans activité suffisante** | Application **hors service** jusqu'à reprise manuelle (« Resume project ») ; avertissement par e-mail ~1 semaine avant ; **restauration possible pendant 1 an** (la doc elle-même est incohérente : titre « 90 jours », texte « 1 an » : à ne pas parier dessus) |
| **Pas de sauvegarde automatique** (Free) | **Aucune copie** si vous n'en faites pas : d'où §7 |
| **IPv4** | Gratuit via le pooler ; la connexion directe en IPv6 exige l'option payante pour IPv4 |
| **Disponibilité** | Pas d'engagement de service sur Free |

### Trafic : ce que j'ai mesuré et ce que j'estime
Mesuré en local : catalogue **14,7 Ko** par lecture, liste en cours **0,2 Ko** (vide) à quelques Ko (remplie), base **8,8 Mo**. Estimation de ce qui sort de la base vers le serveur par rafraîchissement : **≈ 20 à 30 Ko**.

| Scénario | Calcul | Sortie Supabase / mois |
|---|---|---|
| Usage normal avec flux temps réel (3 profils × ≈ 40 rafraîchissements/jour) | 120/jour × 30 Ko | **≈ 0,1 Go** |
| Flux temps réel retenu par un proxy → relecture toutes les 8 s, 1 h/jour au premier plan par profil | 3 × 450 × 30 Ko × 30 jours | **≈ 1,2 Go** |
| Même cas, 3 h/jour par profil (téléphone resté ouvert au magasin) | idem × 3 | **≈ 3,6 Go** (proche des 5 Go, partagés avec vos autres projets) |

**Risque réel** : si le flux temps réel ne fonctionne pas sur Railway (non vérifié, §3 de `proposition-railway.md`), la relecture toutes les 8 s lit **le catalogue entier à chaque fois** alors qu'il change rarement. **Amélioration à envisager (non faite)** : relire seulement la liste en cours (quelques centaines d'octets) et le catalogue sur événement ou toutes les quelques minutes ; cela divise le trafic par ~50.

La pause est peu probable pendant l'usage familial (activité quotidienne) mais **possible pendant des vacances** : la sauvegarde quotidienne décrite en §7 fait aussi office d'activité régulière.

## 7. Sauvegardes indépendantes avec restauration vérifiée (conception, non réalisée)

Principe : **ni Railway ni Supabase ne détiennent la seule copie**, et **chaque copie est restaurée dans une base jetable avant d'être déclarée valide**.

1. **Tâche planifiée GitHub Actions** (quotidienne, dépôt privé, secrets du dépôt) :
   - `pg_dump` de la base Supabase par le **pooler session (IPv4)** avec le client de la bonne version ;
   - **restauration dans un PostgreSQL jetable du coureur GitHub** (pas dans Supabase), puis les contrôles déjà écrits (comptage des lignes de chaque table, liste des migrations, invariants métier) ;
   - chiffrement AES-256-GCM avec `BACKUP_KEY` (le code existe) ;
   - dépôt dans un **stockage indépendant gratuit** : Cloudflare R2 (10 Go gratuits, sortie gratuite, API S3 ; compte requis) ou Backblaze B2 (10 Go gratuits) ; en secours une copie en artefact GitHub (rétention limitée) ;
   - rétention 7 quotidiennes + 4 hebdomadaires + 3 mensuelles (fonction existante) ;
   - **copie des photos de la famille** (quelques Mo) au même endroit : cela comble le trou noté dans `proposition-railway.md` §3.
2. **Test de restauration mensuel** (procédure écrite) : restaurer la dernière sauvegarde dans une base locale, ouvrir l'application dessus.
3. **Visibilité** : afficher dans Réglages la date de la dernière sauvegarde **vérifiée** (petite écriture de la tâche dans une table dédiée).
4. **Alerte** : si la tâche échoue (ou ne tourne pas depuis 2 jours), GitHub envoie un e-mail ; à compléter par un contrôle depuis l'application.

Limites : les tâches planifiées GitHub peuvent être retardées ou désactivées après une longue inactivité du dépôt ; les secrets de connexion à la base sont stockés dans GitHub ; il faut un compte R2 ou B2. **Travail de code nécessaire** (une URL de base de contrôle distincte, un point d'entrée en ligne de commande, l'export des photos, la table de statut) : environ une journée, **non commencé**.

## 8. Images : où les mettre
- **Recommandé : rester sur le bucket Railway** (< 0,01 $ par mois pour moins de 0,05 Go). Aucun changement, et les images n'ajoutent pas de dépendance à la pause de Supabase.
- Supabase Storage (1 Go gratuits) est possible : son interface S3 prend en charge `PutObject`, `GetObject`, `HeadObject`, `DeleteObject`, ce que notre code utilise ; **pas de versions** (suppression définitive). Endpoint et région à lire dans vos paramètres Supabase (non confirmés). Gain : < 0,01 $ : **sans intérêt**.
- Cloudflare R2 (10 Go gratuits) : pertinent surtout pour les **sauvegardes**.

## 9. Recommandation

1. **Ne pas migrer tout de suite.** Relevez d'abord **U**, la consommation mensuelle de votre workspace Railway hors cette application (page Usage). Si **U ≤ 1,5 $**, l'option A (Railway seul, ≈ 2,5–3,5 $) tient dans vos 5 $ et reste la plus simple (une seule plateforme, sauvegardes déjà prêtes).
2. Si **1,5 $ < U ≤ 3,4 $**, l'option B (Supabase Free) devient la seule qui reste probablement dans les 5 $ : **gain ≈ 1 à 2 $/mois**, au prix de : pause possible, lecture seule à 500 Mo, quota de sortie partagé, un **projet dédié** à créer, un durcissement de sécurité obligatoire (§5) et de **nouvelles sauvegardes indépendantes** (§7, ≈ 1 jour de travail).
3. Si **U > 3,4 $**, aucune des deux options ne garantit les 5 $ ; il faudra réduire d'autres services ou accepter un coût au-delà de 5 $.
4. Dans tous les cas : un **test à blanc** (projet Supabase jetable, jeu de données d'essai, `scripts/check-tunnel.mjs`, migrations, sauvegarde et restauration) avant toute donnée réelle, puis **une semaine de mesure** des coûts réels.

## 10. Ce que j'ai besoin de vous pour continuer
- la valeur de **U** (ou les captures de la page Usage de Railway) ;
- votre choix A / B ;
- pour B : accord pour un **projet Supabase dédié** (vous le créez, ou vous me guidez ; je ne demande aucun identifiant ici), accord pour un compte R2 ou B2 pour les sauvegardes ;
- votre décision sur l'amélioration « relire seulement la liste en cours » (réduit le trafic, petit changement).

**Rien de tout cela n'est fait.** Aucune souscription, aucune migration, aucun déploiement, aucune modification de vos limites.
