import { unitLabel } from "../units";
import { useEffect, useState } from "react";
import { api, ApiError, NetworkError, type BackupStatus, type ExtendedResult, type Profile } from "../api";
import { fmtDateTime } from "../format";
import { CATEGORY_EMOJI } from "../categories";
import { Dialog } from "../components/Dialog";
import { ProductForm } from "../components/ProductForm";
import { Thumb } from "../components/Thumb";
import type { Engine, State } from "../sync/engine";
import type { Catalog, Product, Role } from "../types";

const ROLE_LABEL: Record<Role, string> = { admin: "Administrateur", parent: "Parent", staff: "Personnel" };

const errText = (e: unknown): string =>
  e instanceof NetworkError ? "Pas de connexion."
  : e instanceof ApiError ? (e.code === "last_admin" ? "Impossible : c'est le dernier administrateur actif." : e.code === "login_taken" ? "Cet identifiant existe déjà." : e.code === "weak_secret" ? "Code trop simple (évitez 123456, 111111…)." : e.message)
  : "Erreur.";

export function Settings({ engine, s }: { engine: Engine; s: State }) {
  const [section, setSection] = useState<"profiles" | "catalog">("profiles");
  return (
    <>
      <header className="topbar"><div className="topbar__title"><strong>Réglages</strong>{s.me?.family && <span className="muted">Code famille : <b data-testid="family-code">{s.me.family.code}</b></span>}</div></header>
      <div className="seg" role="tablist">
        <button role="tab" aria-selected={section === "profiles"} className={section === "profiles" ? "on" : ""} data-testid="seg-profiles" onClick={() => setSection("profiles")}>Profils</button>
        <button role="tab" aria-selected={section === "catalog"} className={section === "catalog" ? "on" : ""} data-testid="seg-catalog" onClick={() => setSection("catalog")}>Catalogue</button>
      </div>
      {section === "profiles" ? <><BackupCard /><Profiles me={s.me!.id} /></> : <CatalogAdmin engine={engine} />}
    </>
  );
}

function BackupCard() {
  const [st, setSt] = useState<BackupStatus | null>(null);
  useEffect(() => void api.backupStatus().then(setSt).catch(() => {}), []);
  if (!st) return null;
  const old = (iso: string | null, days: number) => !iso || Date.now() - new Date(iso).getTime() > days * 86_400_000;
  const failedSince = st.lastVerifyFailedAt && (!st.lastVerifiedOkAt || st.lastVerifyFailedAt > st.lastVerifiedOkAt);
  const toolsBad = st.tools && !st.tools.ok;
  const bad = !st.configured || old(st.lastVerifiedOkAt, 3) || !!failedSince || !!toolsBad;
  return (
    <div className={`banner ${bad ? "banner--pending" : "banner--info"} backupcard`} data-testid="backup-card">
      <span>
        <strong>Sauvegarde {st.configured ? "automatique" : "NON configurée (aucun bucket sûr ou clé absente)"}</strong>
        {st.configured && <><br />Stockage : {st.storage === "s3" ? "bucket (chiffré)" : "dossier local"} · {st.schedule}</>}
        <br />
        Dernière sauvegarde : {st.lastBackupAt ? fmtDateTime(st.lastBackupAt) : "aucune"}
        <br />
        Dernière restauration vérifiée : {st.lastVerifiedOkAt ? fmtDateTime(st.lastVerifiedOkAt) : "jamais"}
        {failedSince ? " — ÉCHEC de la dernière vérification" : ""}
        {toolsBad && <><br /><strong>Outils : </strong>{st.tools!.message}</>}
      </span>
    </div>
  );
}

function Profiles({ me }: { me: string }) {
  const [list, setList] = useState<Profile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [shown, setShown] = useState<{ title: string; secret: string } | null>(null);
  const load = () => api.profiles().then((r) => setList(r.profiles)).catch((e) => setError(errText(e)));
  useEffect(() => void load(), []);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <>
      {error && <p className="error" role="alert" data-testid="settings-error">{error}</p>}
      <ul className="rows" data-testid="profiles">
        {list?.map((p) => (
          <li key={p.id} className={`row row--stack ${p.active ? "" : "row--off"}`} data-testid={`profile-${p.login}`}>
            <span className="row__name">{p.displayName}{p.id === me && " (vous)"}<small>@{p.login} · {ROLE_LABEL[p.role]}{p.active ? "" : " · désactivé"}</small></span>
            <span className="row__actions">
              <select aria-label="Rôle" value={p.role} onChange={(e) => void run(() => api.updateProfile(p.id, { role: e.target.value as Role }))}>
                {(["admin", "parent", "staff"] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
              <button className="btn btn--small" data-testid={`reset-${p.login}`} onClick={() => void run(async () => setShown({ title: `Nouveau code de ${p.displayName}`, secret: (await api.resetSecret(p.id)).secret }))}>Nouveau code</button>
              <button className="btn btn--small btn--ghost" data-testid={`toggle-${p.login}`} onClick={() => void run(() => api.updateProfile(p.id, { active: !p.active }))}>{p.active ? "Désactiver" : "Réactiver"}</button>
            </span>
          </li>
        ))}
      </ul>
      <button className="btn btn--primary btn--big addbtn" data-testid="add-profile" onClick={() => setAdding(true)}>+ Ajouter un profil</button>
      {adding && <AddProfile onClose={() => setAdding(false)} onCreated={(name, secret) => { setAdding(false); setShown({ title: `Profil créé : ${name}`, secret }); void load(); }} />}
      {shown && (
        <Dialog title={shown.title} onClose={() => setShown(null)}>
          <p>Code secret à 6 chiffres. Il ne sera plus affiché : notez-le et donnez-le à la personne.</p>
          <p className="secret" data-testid="shown-secret">{shown.secret}</p>
          <button className="btn btn--primary btn--big" onClick={() => setShown(null)}>J'ai noté le code</button>
        </Dialog>
      )}
    </>
  );
}

function AddProfile({ onClose, onCreated }: { onClose(): void; onCreated(name: string, secret: string): void }) {
  const [displayName, setName] = useState("");
  const [login, setLogin] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title="Nouveau profil" onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        try {
          const r = await api.createProfile({ displayName, login: login.trim().toLowerCase(), role });
          onCreated(r.profile.displayName, r.secret);
        } catch (err) {
          setError(errText(err));
        }
      }}>
        <label className="field">Nom affiché<input value={displayName} onChange={(e) => setName(e.target.value)} required maxLength={40} data-testid="np-name" /></label>
        <label className="field">Identifiant (unique dans la famille)<input value={login} onChange={(e) => setLogin(e.target.value)} required pattern="[a-zA-Z0-9._-]{2,30}" autoCapitalize="none" data-testid="np-login" /></label>
        <label className="field">Rôle
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} data-testid="np-role">
            {(["staff", "parent", "admin"] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </label>
        <p className="muted">Un code secret à 6 chiffres sera généré.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn btn--primary btn--big" data-testid="np-submit">Créer</button>
        <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
      </form>
    </Dialog>
  );
}

function CatalogAdmin({ engine }: { engine: Engine }) {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ExtendedResult[] | null>(null);
  const [form, setForm] = useState<{ product?: Product } | null>(null);
  const load = () => api.catalogAdmin().then(setCat).catch((e) => setError(errText(e)));
  useEffect(() => void load(), []);
  useEffect(() => {
    if (q.trim().length < 2) return setResults(null);
    const t = setTimeout(() => api.searchExtended(q.trim()).then((r) => setResults(r.results)).catch((e) => setError(errText(e))), 250);
    return () => clearTimeout(t);
  }, [q]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await Promise.all([load(), engine.refresh()]);
      if (q.trim().length >= 2) setResults((await api.searchExtended(q.trim())).results);
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn btn--primary btn--big addbtn" data-testid="add-article" onClick={() => setForm({})}>+ Ajouter un article</button>
      {form && cat && (
        <ProductForm
          product={form.product}
          categories={cat.categories.map((c) => ({ key: c.key, label: c.label }))}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); void act(async () => {}); }}
        />
      )}
      <label className="field search">Chercher un produit à ajouter
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex. pêches, couscous…" data-testid="ext-search" />
      </label>
      {results && (
        <ul className="rows" data-testid="ext-results">
          {results.length === 0 && <li className="empty">Aucun résultat.</li>}
          {results.map((r) => (
            <li key={r.id} className="row">
              <Thumb photoUrl={r.photoUrl} category={r.category} />
              <span className="row__name">{r.name}{r.brand && <small>{r.brand}</small>}</span>
              {r.alreadyAdded ? <span className="muted">Déjà ajouté</span> : <button className="btn btn--small btn--primary" data-testid={`ext-add-${r.name}`} onClick={() => void act(() => api.addFromExtended(r.id))}>Ajouter</button>}
            </li>
          ))}
        </ul>
      )}
      {cat?.categories.map((c) => (
        <section key={c.key}>
          <h2 className="sect">{CATEGORY_EMOJI[c.key]} {c.label}</h2>
          <ul className="rows">
            {c.products.map((p) => (
              <li key={p.id} className={`row row--cat ${p.active ? "" : "row--off"}`} data-testid={`prod-${p.name}`}>
                <Thumb photoUrl={p.photoUrl} category={c.key} />
                <span className="row__name">{p.name}{p.brand && <small>{p.brand}</small>}<small>Unité : {unitLabel(p.unit)}</small>{!p.active && <small>désactivé</small>}</span>
                <span className="rowbtns">
                  <button className="btn btn--small" data-testid={`edit-${p.name}`} aria-label={`Modifier ${p.name}`} onClick={() => setForm({ product: p })}>Modifier</button>
                  <button className="btn btn--small btn--ghost" data-testid={`active-${p.name}`} onClick={() => void act(() => api.patchProduct(p.id, { active: !p.active }))}>{p.active ? "Désactiver" : "Réactiver"}</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
