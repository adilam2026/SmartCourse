-- Suppression d'un profil sans supprimer la famille : le profil est anonymisé sur place (nom, identifiant et code effacés, accès fermés,
-- abonnements aux notifications supprimés). La ligne reste pour l'intégrité de l'historique d'achats (qui affiche « Ancien profil »).
ALTER TABLE profiles ADD COLUMN deleted_at timestamptz;
