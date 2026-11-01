-- Rapport d'un foyer : articles qui GARDERAIENT une unité différente des décisions validées (unité considérée comme choisie
-- par la famille), avec l'état de leur prix.
--
-- CE N'EST PAS UNE SIMPLE REQUÊTE EN LECTURE SEULE : le script EXÉCUTE les migrations 026 à 030 (modifications de schéma et de
-- données, verrous sur les tables), lit leur journal, puis ANNULE la transaction (ROLLBACK). Conditions d'utilisation :
--   * uniquement sur une COPIE RESTAURÉE d'une sauvegarde, jamais sur la base de production ;
--   * dans un environnement PRIVÉ (poste ou serveur de l'administrateur) : le résultat contient des données du foyer et ne doit
--     jamais apparaître dans les journaux du dépôt public (aucune exécution par l'intégration continue GitHub) ;
--   * psql "$URL_DE_LA_COPIE_RESTAUREE" -v famille=CODEFAMILLE -f docs/catalogue/import-2026-11-01/rapport-foyer.sql
--     (depuis la racine du dépôt ; CODEFAMILLE = code famille actuel, 8 caractères).
\set ON_ERROR_STOP on
BEGIN;
\i server/migrations/026_family_identifier.sql
\i server/migrations/027_unit_corrections.sql
\i server/migrations/028_app_update.sql
\i server/migrations/029_catalogue_captures.sql
\i server/migrations/030_unit_decisions.sql
\pset footer off
\echo
\echo 'Articles du foyer dont l unité choisie par la famille serait conservée :'
SELECT DISTINCT ON (p.category, p.name, p.id) p.name AS article, u.old_unit AS unite_conservee, u.new_unit AS unite_decidee, 'migration ' || u.migration AS par,
       CASE WHEN fp.product_id IS NULL THEN 'aucun prix du foyer' ELSE fp.amount || ' DH / ' || fp.ref_qty::float || ' ' || fp.ref_unit END AS prix_du_foyer
  FROM unit_corrections u
  JOIN products p ON p.id::text = u.ref
  JOIN families f ON f.id = p.family_id
  LEFT JOIN family_prices fp ON fp.product_id = p.id
 WHERE u.subject = 'product' AND u.outcome = 'unit_kept_custom' AND f.code = :'famille'
   AND p.unit <> (SELECT coalesce(i.unit, e.unit) FROM products q LEFT JOIN initial_catalog i ON i.key = q.catalog_key LEFT JOIN extended_catalog e ON e.id = q.extended_id WHERE q.id = p.id)
 ORDER BY p.category, p.name, p.id, u.migration DESC;  -- décision la plus récente (030 après 027)
\echo 'Prix du foyer à compléter après le changement d unité (conservés tels quels) :'
SELECT p.name AS article, u.migration, u.old_value->>'amount' || ' DH / ' || (u.old_value->>'refQty')::float || ' ' || (u.old_value->>'refUnit') AS prix_conserve
  FROM unit_corrections u JOIN products p ON p.id::text = u.ref JOIN families f ON f.id = p.family_id
 WHERE u.subject = 'family_price' AND u.outcome = 'price_to_confirm' AND f.code = :'famille'
 ORDER BY p.name;
ROLLBACK;
