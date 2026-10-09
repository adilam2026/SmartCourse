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

## 2. Coût de l'application ≠ consommation de votre workspace (scénarios estimatifs, pas des limites)

Principe (tarifs Railway relevés dans des sources secondaires concordantes, **à reconfirmer sur votre page Usage**) : l'abonnement Hobby de 5 $ **inclut** 5 $ de consommation ; on paie le plus grand des deux. Le coût supplémentaire dû à cette application serait donc max(0 ; consommation totale du workspace − 5 $).

Les valeurs ci-dessous sont **des scénarios fondés sur mes estimations de coût de l'application (§1)**, qui sont elles-mêmes des extrapolations de mesures locales. **Ce ne sont ni des seuils garantis ni des limites de Railway.** La facturation réelle dépend de la mémoire réellement mesurée par Railway, du temps d'activité, des volumes, de la sortie réseau et de vos autres services, que je ne vois pas.

| Scénario : consommation mensuelle de vos **autres** projets (U) | A. Railway seul (application ≈ 2,5 à 3,5 $, jusqu'à ≈ 6 $) | B. Railway + Supabase Free (application ≈ 1,2 à 1,6 $, jusqu'à ≈ 2,5 $) |
|---|---|---|
| U ≈ 1 $ | total ≈ 3,5 à 4,5 $ : **sous les 5 $ dans l'estimation centrale** ; au-dessus si l'estimation haute se vérifie (≈ 7 $) | total ≈ 2,2 à 2,6 $ (≈ 3,5 $ en haut de fourchette) : sous les 5 $ |
| U ≈ 2 $ | total ≈ 4,5 à 5,5 $ : **limite**, dépassement possible | total ≈ 3,2 à 3,6 $ (≈ 4,5 $) : sous les 5 $ |
| U ≈ 3 $ | total ≈ 5,5 à 6,5 $ : dépassement probable | total ≈ 4,2 à 4,6 $ (≈ 5,5 $) : sous les 5 $ en estimation centrale, **dépassement possible** en haut de fourchette |
| U ≈ 4 $ ou plus | dépassement | total ≈ 5,2 à 5,6 $ ou plus : dépassement probable |

À lire comme un ordre de grandeur : **je ne connais pas U**, et la fourchette haute de l'application peut faire basculer un scénario. **Aucune de ces lignes n'est une promesse de rester dans les 5 $.** Le seul moyen de le savoir est la mesure : consommation réelle d'une semaine de l'application, ajoutée à U relevé sur votre page Usage (§11).

Rappel de vos limites (inchangées) : alerte 5 $ (prévient seulement), plafond COMPUTE 10 $ (arrête **tous** les services du workspace), AGENT 0 $. Un dépassement des 5 $ coûte de l'argent en plus ; 10 $ arrête tout, application familiale comprise.

## 3. Pourquoi je ne garantis pas le budget
1. U est inconnu (et les scénarios du §2 ne sont pas des seuils).
2. Mes mesures sont locales : la mémoire facturée par Railway est celle du conteneur (souvent supérieure).
3. La sortie vers Supabase compte comme sortie Railway et comme sortie Supabase (§6) : faible, mais à mesurer.
4. Le quota de sortie Supabase n'est plus menacé par la relecture périodique depuis son optimisation (§6) ; il reste partagé avec vos autres projets de l'organisation.

## 4. Vérifier vos quotas Supabase sans rien perturber (lecture seule, par vous)
Je n'ai aucun accès à votre compte Supabase et je n'en demande pas. Pour vérifier vous-même, sans modifier quoi que ce soit :
1. Tableau de bord Supabase → votre organisation → **Usage** : base de données (Mo), stockage (Go), sortie (Go) pour le mois en cours, **par projet**.
2. Organisation → **Billing** : plan (Free/Pro).
3. **La limite de 2 projets Free s'applique à l'ensemble des organisations où vous êtes propriétaire (Owner) ou administratrice (Administrator)**, et non par organisation (documentation officielle : « The project limit applies across all organizations where you are an Owner or Administrator »). Les projets **en pause ne comptent pas**. Il faut donc compter vos projets Free **actifs dans toutes vos organisations** : si vous en avez déjà 2, un projet dédié à cette application est **impossible en Free** (créer une organisation séparée n'y change rien).
4. Le quota de sortie (§6) est, lui, **par organisation** : un projet dans une organisation à part n'utilise pas la sortie de vos autres organisations, mais il compte quand même dans la limite des 2 projets.
5. Notez si un projet existant est proche de 500 Mo.

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
| **Sortie non mise en cache : 5 Go/mois** et **sortie mise en cache : 5 Go/mois**, deux quotas **indépendants**, par organisation et partagés entre tous les services (base, stockage, authentification…) | La « sortie mise en cache » est celle servie par le CDN (essentiellement le stockage de fichiers via Smart CDN) : **elle ne concerne pas nos requêtes SQL**. Notre trafic base → serveur est de la sortie **non mise en cache**, comptée comme « sortie du pooler partagé » (la documentation précise qu'elle n'est pas comptée en plus comme sortie de base) : **je suppose qu'elle consomme les 5 Go non cachés, à vérifier dans votre page Usage**. Au dépassement, l'organisation est **restreinte jusqu'au début du cycle suivant** (ou passage en Pro) ; il n'y a pas de tarif de dépassement en Free. Les restrictions exactes ne sont pas détaillées dans la page lue : **prévoir une interruption possible** |
| **Stockage : 1 Go** | Ajout d'images impossible au-delà ; non concerné si on garde le bucket Railway |
| **Pause après 7 jours sans activité suffisante** | Application **hors service** jusqu'à reprise manuelle (« Resume project ») ; avertissement par e-mail ~1 semaine avant ; **restauration possible pendant 1 an** (la doc elle-même est incohérente : titre « 90 jours », texte « 1 an » : à ne pas parier dessus) |
| **Pas de sauvegarde automatique** (Free) | **Aucune copie** si vous n'en faites pas : d'où §7 |
| **IPv4** | Gratuit via le pooler ; la connexion directe en IPv6 exige l'option payante pour IPv4 |
| **Disponibilité** | Pas d'engagement de service sur Free |

### Trafic : ce que j'ai mesuré et ce que j'estime
**Relecture périodique optimisée (faite, testée)** : la relecture ne télécharge plus le catalogue : elle lit la liste en cours, qui porte une **révision du catalogue** ; le catalogue (14,7 Ko) n'est retéléchargé que si cette révision a changé (article ajouté, modifié, désactivé, nouvelle image). Mesuré en navigateur, flux temps réel bloqué : **25 s sans changement = 3 lectures de la liste, 0 du catalogue, 462 octets au total** (avant : 3 × ≈ 15 Ko ≈ 44 Ko). Un ajout, un renommage et une désactivation sont repris chacun avec **un seul** téléchargement du catalogue.

Taille mesurée d'une liste en cours : 0,2 Ko (vide) à **7,9 Ko pour 30 articles**. Une relecture coûte donc **≈ 8 Ko au plus** (liste de 30 articles) au lieu de ≈ 23 Ko : **gain ≈ ×3 avec une liste pleine, bien plus avec une liste vide** (la liste reste relue en entier ; l'alléger davantage demanderait une révision de liste, non faite).

| Scénario (estimatif ; ordre de grandeur du trafic base → serveur, assimilé à la taille des réponses HTTP) | Calcul | Sortie non cachée Supabase / mois |
|---|---|---|
| Usage normal avec flux temps réel (3 profils × ≈ 40 rafraîchissements/jour) | 120/jour × ≈ 8 Ko | **≈ 0,03 Go** |
| Flux temps réel retenu → relecture toutes les 8 s, 1 h/jour au premier plan par profil, liste de 30 articles | 3 × 450 × 8 Ko × 30 j | **≈ 0,3 Go** (avant optimisation : ≈ 0,9 Go) |
| Même cas, 3 h/jour par profil | idem × 3 | **≈ 1 Go** (avant optimisation : ≈ 2,7 Go) |

Ces chiffres ne comptent pas les requêtes de session (quelques centaines d'octets par requête) ni les en-têtes du protocole : l'ordre de grandeur est ≈ ±50 %. Ils restent des estimations à confirmer sur votre page Usage Supabase après un essai.

**Pause** : l'usage familial quotidien produit de l'activité, mais la pause reste **possible** (vacances, application peu utilisée). La documentation dit que le projet est jugé inactif s'il ne reçoit pas « sufficient user database activity » sur 7 jours, et qu'« a few daily requests » suffit généralement. **Je ne peux pas garantir qu'une sauvegarde quotidienne (ou une requête automatique) compte comme activité suffisante** : ce n'est pas écrit dans la documentation lue et je ne l'ai pas testé. Ne comptez donc pas sur elle pour empêcher la pause ; surveillez l'e-mail d'avertissement envoyé environ une semaine avant, et sachez que la reprise est manuelle.

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

## 9. Recommandation (provisoire)

1. **Ne pas migrer maintenant.** Avant de choisir A ou B, il faut **mesurer** : U (consommation mensuelle de vos autres projets), le plan et la consommation prévue (captures du §11), et l'état de vos projets Supabase.
2. **Lecture des scénarios du §2** : plus U est faible, moins le choix compte ; plus U approche 2 à 3 $, plus B devient la seule option susceptible de rester dans les 5 $ ; au-delà, aucune option ne tient dans les 5 $ sans réduire d'autres services. Ce sont des ordres de grandeur, pas des seuils.
3. **B n'a de sens que si** : vous avez de la place dans la limite de 2 projets Free (toutes organisations), le gain de 1 à 2 $ par mois compte pour vous, et vous acceptez : pause possible, lecture seule à 500 Mo, quota de sortie, un durcissement de sécurité obligatoire (§5) et des sauvegardes indépendantes à construire (§7, ≈ 1 jour de travail).
4. **Dans tous les cas** : test à blanc (projet jetable, jeu d'essai, `scripts/check-tunnel.mjs`, migrations, sauvegarde et restauration) avant toute donnée réelle, puis **une semaine de mesure** des coûts réels.

## 10. Ce que j'ai besoin de vous pour continuer
- les **captures du §11** (lecture seule) ;
- votre choix A / B, **après** lecture des captures et de ce document ;
- pour B uniquement : accord pour un **projet Supabase dédié** (qui doit rentrer dans la limite des 2 projets Free de toutes vos organisations ; vous le créez, ou vous me guidez ; aucun identifiant n'est demandé) et pour un compte R2 ou B2 pour les sauvegardes.

**Rien de tout cela n'est fait.** Aucune souscription, aucune migration, aucun service ajouté, aucun déploiement, aucune modification de vos limites.

## 11. Captures à fournir pour décider (lecture seule)

**Règles** : ne cliquez sur aucun bouton « Upgrade », « Resume », « Pause », « Delete » ni sur aucun réglage. Ne montrez **aucune** variable d'environnement, clé d'API, jeton, mot de passe ni chaîne de connexion (masquez-les). Les libellés exacts peuvent différer de ceux ci-dessous : prenez l'écran équivalent.

**Railway** (espace de travail concerné par les 5 $ payés)
1. **Plan et facturation** : le plan (nom, prix mensuel, crédit d'usage inclus, date de renouvellement) et les **dernières factures** (pour voir si un mois a déjà dépassé les 5 $).
2. **Usage du workspace, mois en cours** : la consommation à ce jour, la **consommation estimée / projetée** du mois si elle est affichée, et la ventilation **par projet** puis **par ressource** (CPU, mémoire, réseau, volumes, buckets). Si possible aussi le **mois précédent**.
3. **Limites de dépense** : l'alerte, le plafond et la ligne AGENT telles qu'elles sont réglées (affichage seul).
4. **Liste de tous les projets et services** du workspace (nom, type, état en ligne/arrêté), avec pour les **trois services qui consomment le plus** l'onglet **Metrics sur 7 jours** (mémoire, CPU, réseau).
5. Si vous avez des **volumes** ou des **buckets** : leur taille.

**Supabase** (toutes les organisations dont vous êtes propriétaire ou administratrice)
1. **Liste de vos organisations** (sélecteur en haut) avec, pour chacune, son **plan** (Free/Pro) et votre rôle.
2. Pour **chaque organisation** : la **liste des projets** avec leur **statut (actif / en pause)** et leur région. Cela permet de compter les projets Free **actifs** (limite : 2 au total, toutes organisations confondues).
3. Pour **chaque organisation** : **Usage** du cycle en cours (dates de début et de fin du cycle) avec **Egress (non mise en cache)**, **Cached Egress** si affiché, **Database size par projet** et **Storage size**.
4. Pour chaque organisation : **Billing** (plan, plafond de dépense s'il existe).
5. Pour un projet existant concerné (ou celui qui serait utilisé) : la **taille de calcul** et la **version de PostgreSQL**, sans aucune clé ni chaîne de connexion.

Avec ces captures je pourrai : recalculer U et les scénarios du §2 avec vos vrais chiffres, dire si un projet Supabase dédié est possible, et préciser le gain réel. **Ce sera encore une estimation** : seule une semaine de mesure après un essai donnera la consommation réelle.
