# Coûts et limites de dépense

**Tout ce qui concerne le coût de l'application est une estimation provisoire** : aucun déploiement n'a eu lieu, aucune mesure Railway n'existe. Ce document sépare trois choses qu'il ne faut pas confondre :

1. les **limites de dépense que vous avez configurées** (A) ;
2. le **coût de cette application seule** (B), estimé ;
3. la **consommation totale de votre workspace** (C), que je ne peux ni voir ni mesurer d'ici.

## A. Limites configurées par vous (je n'y touche pas)

| Réglage Railway | Valeur | Remarque |
|---|---|---|
| Plafond COMPUTE (limite stricte) | **10 $** | Railway refuse un plafond COMPUTE inférieur à 10 $ |
| Alerte personnalisée COMPUTE | **5 $** | Railway refuse une alerte personnalisée inférieure à 5 $ |
| AGENT | **0 $** | |

Je ne retire ni n'augmente ces valeurs, et je n'en proposerai pas d'autres sans votre demande. Mes anciennes suggestions (alerte à 4 $, plafond à 15 $) étaient impossibles avec ces minimums et sont retirées.

**Ce que font ces réglages** (documentation Railway pour les limites par workspace, [Cost Control](https://docs.railway.com/reference/usage-limits) ; le détail est à confirmer sur votre page Usage) :

- **L'alerte à 5 $ ne fait que prévenir par e-mail.** Elle n'arrête rien : **une alerte seule ne protège pas contre une facturation supplémentaire.** Si la consommation dépasse 5 $ puis 10 $ sans que vous réagissiez, rien ne s'interrompt avant le plafond.
- **Le plafond COMPUTE de 10 $ est ce qui protège**, mais il le fait en **mettant les services hors ligne** : à 10 $ de consommation COMPUTE, les workloads du **workspace entier** s'arrêtent, pas seulement cette application. Les services ne redémarrent pas toujours seuls après relèvement du plafond (parfois un redéploiement est nécessaire).
- Des utilisateurs ont signalé des arrêts alors que l'affichage montrait un usage inférieur au plafond (anomalies de comptage côté Railway).
- Ce que la catégorie « COMPUTE » englobe exactement (processeur et mémoire seulement, ou aussi disque et sortie réseau) **n'est pas confirmé** : un résumé tiers dit qu'elle inclut CPU, RAM, stockage et sortie réseau ; je n'ai pas pu le vérifier dans la documentation officielle. Les montants du plan Hobby (5 $ d'abonnement) ne sont probablement pas comptés comme consommation, mais ce point est à vérifier.

Conséquence pratique : **l'application peut être arrêtée à cause d'autres services de votre workspace**, même si elle consomme très peu elle-même (voir C).

## B. Coût de cette application seule : estimation provisoire

### Tarifs relevés (à reconfirmer sur la page tarifs)

| Poste | Tarif |
|---|---|
| Mémoire | 10 $ / Go / mois |
| CPU | 20 $ / vCPU / mois |
| Volume (disque) | 0,15 $ / Go / mois (sources tierces) |
| Sortie réseau | environ 0,05 $ / Go (sources tierces) |
| Bucket | 0,015 $ / Go / mois ; sortie et requêtes gratuites |

### Mesures locales (build de production, Node 22, Postgres 16, **pas Railway**)

Charge simulée : une famille de 3 personnes, 2 520 requêtes, 3 flux en direct ouverts.

| Mesure | Résultat |
|---|---|
| Mémoire du service Node | 102–111 Mo |
| CPU de Node sur 249 s (charge comprise) | 5 s (environ 2 % d'un cœur pendant la charge, environ 0 au repos) |
| Mémoire de Postgres (somme PSS de ses processus) | 86 Mo |
| Base après la charge | 8,8 Mo |

### Estimation mensuelle (service allumé en continu)

| Poste | Calcul | Par mois |
|---|---|---|
| Service Node, mémoire | 0,11 Go × 10 $ | 1,1 $ |
| Service Node, CPU | environ 0,005 vCPU × 20 $ | 0,1 $ |
| Postgres, mémoire | 0,09–0,15 Go × 10 $ | 0,9–1,5 $ |
| Postgres, CPU | environ 0,005 vCPU × 20 $ | 0,1 $ |
| Volume Postgres | moins de 0,1 Go | moins de 0,02 $ |
| Bucket (photos et sauvegardes) | moins de 0,05 Go | moins de 0,01 $ |
| Réseau | photos mises en cache sur les téléphones | négligeable |
| **Total application** | | **environ 2,5 à 3,5 $** |

**Pourquoi c'est provisoire** : Railway mesure la mémoire du conteneur (souvent plus élevée que la mémoire utile mesurée ici), l'image Postgres de Railway n'est pas la mienne, et je n'ai pas mesuré les sauvegardes quotidiennes (un `pg_dump` et une restauration de contrôle par jour : pics brefs de CPU et de mémoire sur une base de moins de 10 Mo). Fourchette réaliste : de **2,5 $ à environ 6 $** tant qu'aucune mesure Railway n'existe.

## C. Consommation totale de votre workspace : non mesurable d'ici

Je n'ai pas accès à votre compte Railway : **je ne connais pas la consommation de vos autres projets.** C'est pourtant elle qui déclenche l'alerte (5 $) et le plafond (10 $), puisque ces limites sont **par workspace**.

À remplir après quelques jours, depuis la page Usage de Railway (ou la commande `railway usage`) :

| Ligne | À relever | Valeur |
|---|---|---|
| Consommation COMPUTE du mois, **tous projets** | page Usage du workspace | ______ $ |
| dont cette application (service Node + Postgres + bucket) | détail par projet | ______ $ |
| dont les autres projets | différence | ______ $ |
| Marge avant l'alerte de 5 $ | 5 − consommation totale | ______ $ |
| Marge avant le plafond de 10 $ | 10 − consommation totale | ______ $ |

Lecture : si les autres projets consomment déjà, par exemple, 6 $ par mois, l'alerte est déjà passée et il ne reste que 4 $ avant que **tout** s'arrête : l'application, à 3 $, resterait en ligne ; à 5 $ elle serait coupée avec le reste.

**Décision qui vous revient** (je ne la prends pas) : si la marge est faible, soit réduire les autres consommations, soit déplacer cette application dans un workspace séparé, soit relever le plafond. Un plafond trop bas arrête la famille en pleine course ; l'absence de plafond expose à une facture sans limite.
