# Coûts : mesures et prévision

Aucun déploiement Railway n'a été fait depuis cet environnement (pas d'accès à votre compte) : **le coût réel reste à constater sur la page « Usage » de Railway** après une semaine. Ce document donne ce qui a été mesuré localement et la façon de le convertir en dollars.

## Tarifs relevés (à reconfirmer sur la page tarifs avant engagement)

| Poste | Tarif | Source |
|---|---|---|
| Plan Hobby | 5 $/mois, qui incluent 5 $ de consommation | [doc Railway](https://docs.railway.com/pricing/plans) |
| Mémoire | 10 $ / Go / mois | idem |
| CPU | 20 $ / vCPU / mois | idem |
| Volume | 0,15 $ / Go / mois (sources tierces) | à confirmer |
| Sortie réseau | environ 0,05 $ / Go (sources tierces) | à confirmer |
| Bucket | 0,015 $ / Go / mois, sortie et requêtes gratuites | [doc buckets](https://docs.railway.com/storage-buckets/billing) |

## Mesures locales (build de production, Node 22, Postgres 16)

Charge simulée : une famille de 3 personnes, 40 tours de « ajout par le personnel + achat par un parent + 60 lectures », soit 2 520 requêtes, avec 3 flux SSE ouverts en permanence.

| Mesure | Résultat |
|---|---|
| Mémoire du service Node au repos | 111 Mo |
| Mémoire du service Node après la charge | 102 Mo |
| CPU consommé par Node pendant 249 s (charge comprise) | 5 s (≈ 2 % d'un cœur pendant la charge, ≈ 0 au repos) |
| Mémoire de Postgres (PSS cumulée de tous ses processus) | 86 Mo |
| Taille de la base après la charge | 8,8 Mo |
| Erreurs 5xx | 0 |

## Prévision (service allumé en continu, 730 h/mois)

| Poste | Calcul | Par mois |
|---|---|---|
| Service Node, mémoire | 0,11 Go × 10 $ | 1,1 $ |
| Service Node, CPU | 0,005 vCPU en moyenne × 20 $ | 0,1 $ |
| Postgres, mémoire | 0,09–0,15 Go × 10 $ | 0,9–1,5 $ |
| Postgres, CPU | 0,005 vCPU × 20 $ | 0,1 $ |
| Volume Postgres | moins de 0,1 Go × 0,15 $ | moins de 0,02 $ |
| Bucket (photos + sauvegardes chiffrées) | moins de 0,05 Go × 0,015 $ | moins de 0,01 $ |
| Réseau | photos mises en cache sur les téléphones | négligeable |
| **Total** | | **environ 2,5 à 3,5 $** |

Cela rentre dans les 5 $ de consommation inclus dans le plan Hobby, **sans garantie** : Railway mesure la mémoire du conteneur (qui peut dépasser la mémoire « utile » mesurée ici), et l'image Postgres de Railway peut consommer plus que mon Postgres local. Si la page Usage indique plus de 5 $ projetés, la consommation excédentaire est facturée en plus du forfait. Mon estimation précédente (6–8 $) supposait 256 Mo par service ; les mesures la ramènent plus bas, mais elle reste à confirmer en réel.

## À faire après le déploiement

1. Relever sur la page Usage de Railway : mémoire moyenne de chaque service, CPU, volume, sortie réseau. Remplacer le tableau « Prévision » par ces chiffres.
2. Créer une **alerte** d'usage à 4 $.

## Limite de dépense : ce qu'elle fait

D'après les retours d'utilisateurs sur le forum Railway (la documentation officielle n'a pas pu être ouverte depuis cet environnement) :
- Une limite **stricte** (« hard limit ») **arrête les services du workspace** quand elle est atteinte : l'application serait alors **hors service** pour toute la famille jusqu'à ce que vous relevez la limite.
- Les services ne repartent pas toujours seuls : il peut falloir les redéployer.
- Des anomalies de comptage ont été signalées (arrêt alors que l'usage affiché était inférieur à la limite).
- Les données de bucket sont conservées, l'accès est suspendu.

**Recommandation : ne pas activer de limite stricte** pour une application que la famille utilise en magasin. Utiliser une alerte à 4 $ et, si vous voulez un plafond, le fixer largement au-dessus de la prévision (par exemple 15 $). **Je n'active rien sans votre accord.** Les services étant peu consommateurs, un dépassement imprévu viendrait surtout d'une boucle ou d'un bug : l'alerte suffit à le voir.
