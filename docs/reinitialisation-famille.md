# Réinitialiser ma famille et recommencer la première installation

## Ce qui est livré
- **Installation avec e-mail obligatoire et vérifié** (interface ET serveur) : l'installation exige une adresse de récupération ; la famille reste « en attente » (tout est refusé côté serveur sauf la finalisation) jusqu'à ce que le lien reçu soit ouvert. Si l'envoi d'e-mails n'est pas configuré, l'installation est **refusée avant toute création** et le jeton **n'est pas consommé**. Si l'envoi échoue après la création, l'écran « Vérifiez votre e-mail » permet de **renvoyer** le lien (les échecs ne comptent pas dans la limite horaire) ou de **changer l'adresse** : la famille n'est jamais recréée ni inutilisable.
- **« Réinitialiser la famille »** (Réglages, administrateur principal seulement) : suppression définitive de **cette** famille, après identification (nom, code, profils, décompte précis) et triple confirmation : mot de passe, code famille retapé, case « définitif ».
- **Garde-fou « Brevo fonctionne réellement »** : la réinitialisation n'est possible que si l'envoi est configuré **et** si l'adresse du principal est **vérifiée** (une adresse vérifiée est une adresse qui a reçu un e-mail). Le bouton « Envoyer un e-mail de test » (Réglages → Adresse de récupération) en donne la preuve à la demande.
- **Outil d'exploitation** : `admin-cli purge-family <CODE>` (simulation par défaut) ; `--execute --confirm <CODE>` pour supprimer.

## Ce que la suppression efface (et seulement cela)
Profils, sessions, abonnements aux notifications, adresses et jetons de récupération, journaux d'e-mails, listes, articles de liste, achats, validations, événements, historiques et archives, journal d'audit de la famille, produits de la famille, **photos propres à la famille** (base et fichiers). La famille est identifiée par son identifiant **et** son code. Avant validation de la transaction, le serveur vérifie qu'**aucune ligne** de cette famille ne subsiste et que **rien** d'une autre famille n'a changé (sinon, tout est annulé). Une ligne d'audit sans donnée personnelle (empreinte du code, volumes) atteste l'opération.

**Conservés** : catalogue partagé (80 + 163 produits et leurs photos), migrations, configuration Railway/Brevo, toutes les autres familles. Le jeton d'installation consommé reste consommé.

## Téléphones
Les données locales sont indexées par famille. À la réinitialisation, le téléphone qui l'a lancée est vidé aussitôt (listes, brouillons, file d'envoi, catalogue, identité, caches). Les **autres téléphones** : leurs sessions sont fermées ; **à la reconnexion à une autre famille**, l'application efface d'abord brouillons, file d'envoi, cache et identité de l'ancienne famille — rien n'est réinjecté (testé de bout en bout).

## Parcours exact pour recréer la famille
1. Réglages → **Adresse de récupération** : adresse vérifiée ? Appuyer sur **Envoyer un e-mail de test**, vérifier la réception dans la boîte (courriers indésirables compris).
2. Réglages → **Réinitialiser la famille** : contrôler le nom, le code et le décompte ; saisir le mot de passe, retaper le code, cocher la case ; **Supprimer définitivement la famille**.
3. L'application revient à **Première installation** avec le message « Votre famille a été supprimée. Vous pouvez maintenant créer une nouvelle famille. » L'autorisation de recréer (usage unique) est gardée par l'application, sans saisie ni copie ; elle survit à la fermeture de l'application. Sur un autre téléphone, ouvrir le lien d'installation fourni par `admin-cli`.
4. Renseigner : nom de la famille, nom affiché, identifiant, **mot de passe (6 caractères) ×2**, **e-mail de récupération (obligatoire)** → **Créer ma famille**.
5. Écran « Vérifiez votre e-mail » : ouvrir le lien reçu (sur ce téléphone ou un autre) ; l'écran se termine seul → code famille affiché → **Continuer**.
6. Chaque personne se reconnecte avec le nouveau code famille ; les profils se recréent dans Réglages → Famille et profils (mot de passe choisi à la main).

## Sauvegardes
Les sauvegardes quotidiennes sont des copies **complètes de la base** (toutes familles), chiffrées, conservées 7 jours + 4 semaines + 3 mois : **celles qui précèdent la suppression contiennent encore la famille supprimée jusqu'à leur expiration** (au plus ~3 mois). Elles ne se trient pas par famille : en effacer reviendrait à effacer celles des autres familles, ce qui n'a pas été fait. `admin-cli purge-family … --execute` liste après coup les sauvegardes concernées (clé et date). Si vous voulez que la famille disparaisse aussi des sauvegardes, il faut attendre leur expiration ou décider d'en supprimer à la main dans le stockage (en acceptant de perdre les autres familles de ces dates).
