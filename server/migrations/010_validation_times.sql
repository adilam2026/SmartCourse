-- Deux heures pour chaque validation : celle du téléphone au moment de l'appui (client_at, brute) et celle de la réception par le
-- serveur (received_at, déjà conservée). « at » reste l'heure affichée : l'heure du téléphone quand elle est plausible, sinon celle du
-- serveur ; client_at garde ce que le téléphone a réellement annoncé, même s'il n'a pas été retenu.
ALTER TABLE validations ADD COLUMN client_at timestamptz;

-- Corrections d'achat : événements « correct » (l'article revient à acheter) et « merge » (sa quantité rejoint une nouvelle demande).
ALTER TABLE list_events DROP CONSTRAINT list_events_kind_check;
ALTER TABLE list_events ADD CONSTRAINT list_events_kind_check CHECK (kind IN ('add','qty','remove','request_again','correct','merge'));
