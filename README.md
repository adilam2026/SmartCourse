# SmartCourse

Liste de courses familiale (PWA + serveur Node/TypeScript + PostgreSQL).
Référence technique : [docs/revue-technique.md](docs/revue-technique.md).

## Développement

```bash
cd server
npm install
export DATABASE_URL=postgres://smart:smart@localhost:5432/smartcourse
npm run migrate
npm run dev
npm test          # utilise TEST_DATABASE_URL (défaut : base smartcourse_test locale)
```

## Déploiement (Railway)

Un service `app` (Dockerfile à la racine) + un service Postgres. Variable requise : `DATABASE_URL`.
Les migrations s'appliquent au démarrage.
