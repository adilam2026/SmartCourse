# SmartCourse

Liste de courses familiale : PWA (React) + serveur Node/TypeScript (Fastify) + PostgreSQL.

| Document | Contenu |
|---|---|
| [docs/revue-technique.md](docs/revue-technique.md) | décisions, architecture, modèle de données, synchronisation et conflits |
| [docs/deploiement.md](docs/deploiement.md) | mise en ligne sur Railway, première installation, secours |
| [docs/couts.md](docs/couts.md) | tarifs, mesures, prévision, limite de dépense |
| [docs/photos-licences.md](docs/photos-licences.md) | sources de photos, licences, procédure d'import |
| [docs/marques-a-valider.md](docs/marques-a-valider.md) | marques à choisir |
| [docs/recette.md](docs/recette.md) | critères ↔ tests ; ce qui n'est pas couvert |

## Développement

```bash
# base locale
export DATABASE_URL=postgres://smart:smart@localhost:5432/smartcourse

cd server && npm install && npm run migrate && npm run dev      # API sur :3000
cd web    && npm install && npm run dev                          # PWA sur :5173 (proxy vers :3000)

# tests
cd server && npm test      # serveur : PostgreSQL réel (TEST_DATABASE_URL, défaut smartcourse_test)
cd web    && npm test      # moteur de synchronisation
cd e2e    && npm install && npm test   # navigateur réel ; nécessite server et web construits (npm run build)
```

Outils d'exploitation (dans `server/`) : `npm run admin -- reset|token`, `npm run backup -- run|verify|list|prune`, `npm run photos -- import manifeste.json`, `npm run photos -- purge [--dry-run]` (supprime les images que plus rien ne référence).
