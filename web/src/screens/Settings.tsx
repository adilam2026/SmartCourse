import { unitLabel } from "../units";
import { VersionInfo } from "../components/VersionInfo";
import { useEffect, useState } from "react";
import { api, ApiError, NetworkError, type AuditProduct, type BackupStatus, type Profile, type ResetPreview } from "../api";
import { fmtDateTime } from "../format";
import { CATEGORY_EMOJI } from "../categories";
import { Dialog } from "../components/Dialog";
import { Icon, type IconName } from "../components/Icon";
import { RecoveryPanel } from "../components/RecoveryPanel";
import { NotificationSettings, usePushControl } from "../components/NotificationSettings";
import { PageHead } from "../components/PageHead";
import { useBackLayer } from "../useBackLayer";
import { ProductForm } from "../components/ProductForm";
import { Thumb } from "../components/Thumb";
import { CatalogBrowser, CatPhoto } from "./CatalogBrowser";
import type { Engine, State } from "../sync/engine";
import type { Catalog, Product, Role } from "../types";

/** Accents and case flattened, for the local filter of the family list. */
const flatten = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/œ/g, "oe").trim();

const ROLE_LABEL: Record<Role, string> = { admin: "Administrateur", parent: "Parent", staff: "Personnel" };

const errText = (e: unknown): string =>
  e instanceof NetworkError ? "Pas de connexion."
  : e instanceof ApiError ? (e.code === "last_admin" ? "Impossible : c'est le dernier administrateur actif." : e.code === "admin_cannot_deactivate" ? "Un administrateur ne peut pas être désactivé." : e.code === "primary_admin_protected" ? "Le rôle de l'administrateur principal ne peut pas être modifié." : e.code === "login_taken" ? "Cet identifiant existe déjà." : e.code === "weak_secret" ? "Mot de passe trop simple (évitez 123456, 111111…)." : e.code === "secret_mismatch" ? "Les deux mots de passe ne sont pas identiques." : e.code === "invalid_secret" ? "Le mot de passe doit comporter 6 caractères." : e.message)
  : "Erreur.";

type Section = "profiles" | "recovery" | "reset" | "catalog" | "notifications" | "backups" | "about";

/** Backup state in one word (the technical detail is one touch away). */
function backupSummary(st: BackupStatus | null): { ok: boolean; text: string } {
  if (!st) return { ok: true, text: "Vérification…" };
  const old = (iso: string | null, days: number) => !iso || Date.now() - new Date(iso).getTime() > days * 86_400_000;
  const failedSince = st.lastVerifyFailedAt && (!st.lastVerifiedOkAt || st.lastVerifyFailedAt > st.lastVerifiedOkAt);
  const toolsBad = st.tools && !st.tools.ok;
  if (!st.configured) return { ok: false, text: "Sauvegarde non configurée" };
  if (failedSince) return { ok: false, text: "Dernière vérification en échec" };
  if (toolsBad) return { ok: false, text: "Outils de sauvegarde à vérifier" };
  if (old(st.lastVerifiedOkAt, 3)) return { ok: false, text: "Sauvegarde à vérifier" };
  return { ok: true, text: "Sauvegardes à jour" };
}

export function Settings({ engine, s }: { engine: Engine; s: State }) {
  const [section, setSection] = useState<Section | null>(null);
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const push = usePushControl();
  useEffect(() => void api.backupStatus().then(setBackup).catch(() => {}), []);
  useBackLayer(section !== null, () => setSection(null)); // Android Back: from a section to the list of settings
  const bs = backupSummary(backup);
  const pushText = push.status === "on" ? "Activées sur cet appareil" : push.status === "denied" ? "Bloquées par le téléphone" : push.status === "unsupported" ? "Non prises en charge" : "Désactivées sur cet appareil";

  if (section === null) {
    const items: { key: Section; icon: IconName; title: string; text: string; testid: string }[] = [
      { key: "profiles", icon: "users", title: "Famille et profils", text: "Profils, rôles, codes d'accès", testid: "seg-profiles" },
      { key: "recovery", icon: "lock", title: "Adresse de récupération", text: "Code famille et mot de passe oubliés", testid: "seg-recovery" },
      { key: "catalog", icon: "grid", title: "Catalogue", text: "Produits, photos et unités", testid: "seg-catalog" },
      { key: "notifications", icon: "bell", title: "Notifications", text: pushText, testid: "seg-notifications" },
      { key: "backups", icon: "shield", title: "Sauvegardes", text: bs.text, testid: "seg-backups" },
      ...(s.me?.primary ? [{ key: "reset" as Section, icon: "shield" as IconName, title: "Réinitialiser la famille", text: "Suppression définitive, pour recommencer", testid: "seg-reset" }] : []),
      { key: "about", icon: "info", title: "À propos et version", text: "Version installée, mises à jour", testid: "seg-about" },
    ];
    return (
      <>
        <PageHead engine={engine} s={s} title="Réglages" subtitle={s.me?.family ? <>Famille « {s.me.family.name} » · code <b data-testid="family-code">{s.me.family.code}</b></> : undefined} />
        <nav className="menu" aria-label="Réglages">
          {items.map((i) => (
            <button key={i.key} className="menuitem" data-testid={i.testid} onClick={() => setSection(i.key)}>
              <span className="menuitem__icon"><Icon name={i.icon} size={24} /></span>
              <span className="menuitem__text"><b>{i.title}</b><small className={i.key === "backups" && !bs.ok ? "bad" : ""}>{i.text}</small></span>
              <Icon name="chevron-right" />
            </button>
          ))}
        </nav>
      </>
    );
  }
  const titles: Record<Section, string> = { profiles: "Famille et profils", recovery: "Adresse de récupération", reset: "Réinitialiser la famille", catalog: "Catalogue", notifications: "Notifications", backups: "Sauvegardes", about: "À propos et version" };
  return (
    <>
      <PageHead engine={engine} s={s} title={titles[section]} onBack={() => setSection(null)} backLabel="Réglages" backTestId="settings-back" subtitle={section === "profiles" && s.me?.family ? <>Code de la famille : <b data-testid="family-code">{s.me.family.code}</b></> : undefined} />
      {section === "profiles" && <Profiles me={s.me!.id} />}
      {section === "recovery" && <RecoveryPanel />}
      {section === "reset" && <ResetFamily engine={engine} />}
      {section === "catalog" && <CatalogAdmin engine={engine} />}
      {section === "notifications" && <div className="menu"><NotificationSettings /></div>}
      {section === "backups" && <BackupCard st={backup} />}
      {section === "about" && <div className="versioninfo--page"><VersionInfo engine={engine} /></div>}
    </>
  );
}

function BackupCard({ st }: { st: BackupStatus | null }) {
  const [details, setDetails] = useState(false);
  if (!st) return <p className="empty">Vérification…</p>;
  const sum = backupSummary(st);
  const failedSince = st.lastVerifyFailedAt && (!st.lastVerifiedOkAt || st.lastVerifyFailedAt > st.lastVerifiedOkAt);
  const toolsBad = st.tools && !st.tools.ok;
  return (
    <div className="panel backupcard" data-testid="backup-card">
      <p><span className={`statebadge ${sum.ok ? "" : "statebadge--bad"}`} data-testid="backup-state"><Icon name={sum.ok ? "check" : "info"} size={16} /> {sum.text}</span></p>
      <p className="muted">{st.lastBackupAt ? `Dernière sauvegarde : ${fmtDateTime(st.lastBackupAt)}` : "Aucune sauvegarde pour le moment."}</p>
      <button className="disclose" data-testid="backup-details-toggle" aria-expanded={details} onClick={() => setDetails((v) => !v)}>{details ? "Masquer les détails techniques" : "Détails techniques"}</button>
      {details && (
        <div data-testid="backup-details" className="muted">
          <strong>Sauvegarde {st.configured ? "automatique" : "NON configurée (aucun bucket sûr ou clé absente)"}</strong>
          {st.configured && <><br />Stockage : {st.storage === "s3" ? "bucket (chiffré)" : "dossier local"} · {st.schedule}</>}
          <br />
          Dernière sauvegarde : {st.lastBackupAt ? fmtDateTime(st.lastBackupAt) : "aucune"}
          <br />
          Dernière restauration vérifiée : {st.lastVerifiedOkAt ? fmtDateTime(st.lastVerifiedOkAt) : "jamais"}
          {failedSince ? " — ÉCHEC de la dernière vérification" : ""}
          {toolsBad && <><br /><strong>Outils : </strong>{st.tools!.message}</>}
        </div>
      )}
    </div>
  );
}

/** Six visible characters; typed twice. Never generated, never displayed afterwards. */
const six = (v: string) => [...v].length === 6 && !/\s/.test(v);
const clean = (v: string) => v.replace(/\s/g, "").slice(0, 6);

function Profiles({ me }: { me: string }) {
  const [list, setList] = useState<Profile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [changing, setChanging] = useState<Profile | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
      {notice && <p className="notice" role="status" data-testid="settings-notice">{notice}</p>}
      <ul className="rows" data-testid="profiles">
        {list?.map((p) => (
          <li key={p.id} className={`row row--stack ${p.active ? "" : "row--off"}`} data-testid={`profile-${p.login}`}>
            <span className="row__name">{p.displayName}{p.id === me && " (vous)"}<small>@{p.login} · {ROLE_LABEL[p.role]}{p.primary ? " principal" : ""}{p.active ? "" : " · désactivé"}</small></span>
            <span className="row__actions">
              {p.primary ? (
                <span className="muted" data-testid={`primary-${p.login}`}>Rôle protégé</span>
              ) : (
                <select aria-label="Rôle" value={p.role} onChange={(e) => void run(() => api.updateProfile(p.id, { role: e.target.value as Role }))}>
                  {(["admin", "parent", "staff"] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              )}
              <button className="btn btn--small" data-testid={`reset-${p.login}`} onClick={() => { setNotice(null); setChanging(p); }}>Modifier le mot de passe</button>
              {/* Un administrateur n'est jamais désactivé : le bouton n'existe pas (et le serveur refuse aussi). */}
              {p.role !== "admin" && <button className="btn btn--small btn--ghost" data-testid={`toggle-${p.login}`} onClick={() => void run(() => api.updateProfile(p.id, { active: !p.active }))}>{p.active ? "Désactiver" : "Réactiver"}</button>}
            </span>
          </li>
        ))}
      </ul>
      <button className="btn btn--primary btn--big addbtn" data-testid="add-profile" onClick={() => setAdding(true)}>+ Ajouter un profil</button>
      {adding && <AddProfile onClose={() => setAdding(false)} onCreated={(name) => { setAdding(false); setNotice(`Profil créé : ${name}. Communiquez-lui le mot de passe que vous avez choisi.`); void load(); }} />}
      {changing && <ChangePassword profile={changing} onClose={() => setChanging(null)} onDone={() => { setNotice(`Mot de passe de ${changing.displayName} modifié. Ses sessions ont été fermées.`); setChanging(null); void load(); }} />}
    </>
  );
}

function PasswordFields({ secret, again, setSecret, setAgain, prefix }: { secret: string; again: string; setSecret(v: string): void; setAgain(v: string): void; prefix: string }) {
  const mismatch = again.length > 0 && secret !== again;
  return (
    <>
      <label className="field">Mot de passe — 6 caractères<input type="password" maxLength={6} autoComplete="new-password" value={secret} onChange={(e) => setSecret(clean(e.target.value))} required data-testid={`${prefix}-secret`} /></label>
      <label className="field">Confirmer le mot de passe<input type="password" maxLength={6} autoComplete="new-password" value={again} onChange={(e) => setAgain(clean(e.target.value))} required data-testid={`${prefix}-secret2`} /></label>
      {mismatch && <p className="error" data-testid={`${prefix}-mismatch`}>Les deux mots de passe ne sont pas identiques.</p>}
    </>
  );
}

function ChangePassword({ profile, onClose, onDone }: { profile: Profile; onClose(): void; onDone(): void }) {
  const [secret, setSecret] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={`Modifier le mot de passe de ${profile.displayName}`} onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api.resetSecret(profile.id, secret, again);
          onDone();
        } catch (err) {
          setError(errText(err));
          setBusy(false);
        }
      }}>
        <PasswordFields secret={secret} again={again} setSecret={setSecret} setAgain={setAgain} prefix="pw" />
        <p className="muted">L'ancien mot de passe n'est jamais affiché. Toutes les sessions de ce profil seront fermées.</p>
        {error && <p className="error" role="alert" data-testid="pw-error">{error}</p>}
        <button className="btn btn--primary btn--big" disabled={busy || !six(secret) || secret !== again} data-testid="pw-submit">{busy ? "Enregistrement…" : "Enregistrer le mot de passe"}</button>
        <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
      </form>
    </Dialog>
  );
}

function AddProfile({ onClose, onCreated }: { onClose(): void; onCreated(name: string): void }) {
  const [displayName, setName] = useState("");
  const [login, setLogin] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const [secret, setSecret] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title="Nouveau profil" onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        try {
          const r = await api.createProfile({ displayName, login: login.trim().toLowerCase(), role, secret, secretConfirm: again });
          onCreated(r.profile.displayName);
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
        <PasswordFields secret={secret} again={again} setSecret={setSecret} setAgain={setAgain} prefix="np" />
        <p className="muted">Vous choisissez ce mot de passe : chiffres, lettres ou symboles. Rien n'est généré automatiquement.</p>
        {error && <p className="error" role="alert" data-testid="np-error">{error}</p>}
        <button className="btn btn--primary btn--big" disabled={!six(secret) || secret !== again || !displayName.trim() || !login.trim()} data-testid="np-submit">Créer</button>
        <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
      </form>
    </Dialog>
  );
}

/** Zone dangereuse — suppression définitive de la famille (administrateur principal). Identification, décompte, mot de passe ET code à retaper. */
function ResetFamily({ engine }: { engine: Engine }) {
  const [pv, setPv] = useState<ResetPreview | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => void api.resetPreview().then(setPv).catch((e) => setError(errText(e))), []);
  if (!pv) return <p className="empty">{error ?? "Chargement…"}</p>;
  const ready = pv.ready.mailConfigured && pv.ready.recoveryEmailVerified;
  const c = pv.counts;
  return (
    <div className="panel danger" data-testid="reset-panel">
      <p><b>Famille « {pv.family.name} »</b> — code <b data-testid="reset-code">{pv.family.code}</b></p>
      <p className="muted">{pv.family.profiles.map((p) => `${p.displayName} (${ROLE_LABEL[p.role as Role]}${p.primary ? ", principal" : ""})`).join(" · ")}</p>
      <p data-testid="reset-counts">Sera supprimé : {c.profiles} profil(s), {c.lists} liste(s) et leurs achats et historiques, {c.products} article(s) de la famille, {c.ownedPhotos} photo(s) propre(s), {c.pushSubscriptions} abonnement(s) aux notifications, l'adresse de récupération et les liens associés. Les accès de tous les profils sont fermés.</p>
      <p className="muted">Conservés : le catalogue partagé (243 produits et leurs photos) et toutes les autres familles. Les sauvegardes déjà faites contiennent encore cette famille jusqu'à leur expiration.</p>
      {!ready && (
        <p className="error" role="alert" data-testid="reset-notready">
          {!pv.ready.mailConfigured ? "L'envoi d'e-mails n'est pas configuré sur le serveur." : "L'adresse de récupération n'est pas vérifiée."} Vérifiez d'abord que l'envoi d'e-mails fonctionne (Réglages → Adresse de récupération → e-mail de test) : la nouvelle installation en dépend.
        </p>
      )}
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const r = await api.resetFamily(password, code);
          // The family is gone: the app leaves at once (its own session is closed) and the new single-use token is kept on the installation form.
          await engine.afterFamilyReset(r.installToken);
        } catch (err) {
          setError(err instanceof ApiError && err.code === "wrong_password" ? "Mot de passe incorrect." : err instanceof ApiError && err.code === "code_mismatch" ? "Le code famille saisi ne correspond pas." : errText(err));
          setBusy(false);
        }
      }}>
        <label className="field">Votre mot de passe<input type="password" maxLength={6} autoComplete="current-password" value={password} onChange={(e) => setPassword(clean(e.target.value))} required data-testid="reset-password" /></label>
        <label className="field">Retapez le code famille ({pv.family.code})<input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" required data-testid="reset-confirm-code" /></label>
        <label className="check"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} data-testid="reset-sure" /> Je comprends que c'est définitif et irréversible.</label>
        {error && <p className="error" role="alert" data-testid="reset-error">{error}</p>}
        <button className="btn btn--danger btn--big" disabled={busy || !ready || !sure || !six(password) || code.trim().toUpperCase() !== pv.family.code} data-testid="reset-submit">{busy ? "Suppression…" : "Supprimer définitivement la famille"}</button>
      </form>
    </div>
  );
}


function CatalogAdmin({ engine }: { engine: Engine }) {
  const [view, setView] = useState<"mine" | "all">("mine");
  const [cat, setCat] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [form, setForm] = useState<{ product?: Product } | null>(null);
  const [audit, setAudit] = useState<Record<string, AuditProduct>>({});
  const [filter, setFilter] = useState<"all" | "check" | "own" | "none">("all");
  const [compare, setCompare] = useState<{ product: Product; catalogUrl: string } | null>(null);
  const load = () => Promise.all([
    api.catalogAdmin().then(setCat),
    api.catalogAudit().then((r) => setAudit(Object.fromEntries(r.products.map((p) => [p.id, p])))).catch(() => {}),
  ]).catch((e) => setError(errText(e)));
  useEffect(() => void load(), []);
  const count = (f: (a: AuditProduct) => boolean) => Object.values(audit).filter(f).length;
  const matches = (p: Product) => {
    const a = audit[p.id];
    if (filter === "all" || !a) return filter === "all";
    return filter === "check" ? a.sharedWithOtherNames || !!a.catalogPhotoUrl : filter === "own" ? a.photoSource === "famille" : a.photoSource === "none";
  };
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await Promise.all([load(), engine.refresh()]);
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="seg seg--wrap" role="tablist" aria-label="Affichage du catalogue">
        <button role="tab" aria-selected={view === "mine"} className={view === "mine" ? "on" : ""} data-testid="cat-view-mine" onClick={() => setView("mine")}>Mes produits</button>
        <button role="tab" aria-selected={view === "all"} className={view === "all" ? "on" : ""} data-testid="cat-view-all" onClick={() => setView("all")}>Tous les produits</button>
      </div>
      {view === "all" && cat && <CatalogBrowser categories={cat.categories.map((c) => ({ key: c.key, label: c.label }))} onChanged={() => Promise.all([load(), engine.refresh()])} />}
      {view === "mine" && <><button className="btn btn--primary btn--big addbtn" data-testid="add-article" onClick={() => setForm({})}>+ Ajouter un article</button>
      {form && cat && (
        <ProductForm
          product={form.product}
          categories={cat.categories.map((c) => ({ key: c.key, label: c.label }))}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); void act(async () => {}); }}
        />
      )}
      <label className="field search">Chercher dans mes produits
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex. lait, lessive…" data-testid="mine-search" />
      </label>
      <div className="catchips" role="tablist" aria-label="Contrôle des photos" data-testid="photo-filters">
        {([["all", "Tous"], ["check", `À vérifier (${count((a) => a.sharedWithOtherNames || !!a.catalogPhotoUrl)})`], ["own", `Photos de la famille (${count((a) => a.photoSource === "famille")})`], ["none", `Sans photo (${count((a) => a.photoSource === "none")})`]] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={filter === k} className={`catchip ${filter === k ? "on" : ""}`} data-testid={`pf-${k}`} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>
      {cat?.categories.map((c) => {
        const needle = flatten(q);
        const prods = c.products.filter((p) => (!needle || flatten(p.name).includes(needle)) && matches(p));
        if (!prods.length) return null;
        return (
        <section key={c.key}>
          <h2 className="sect">{CATEGORY_EMOJI[c.key]} {c.label}</h2>
          <ul className="rows">
            {prods.map((p) => (
              <li key={p.id} className={`row row--cat ${p.active ? "" : "row--off"}`} data-testid={`prod-${p.name}`}>
                <Thumb photoUrl={p.photoUrl} category={c.key} />
                <span className="row__name">{p.name}{p.brand && <small>{p.brand}</small>}<small>Unité : {unitLabel(p.unit)}</small>{!p.active && <small>désactivé</small>}
                  {audit[p.id] && <small data-testid={`photosrc-${p.name}`}>Photo : {audit[p.id]!.photoSource === "famille" ? "de la famille" : audit[p.id]!.photoSource === "catalogue" ? "du catalogue" : "aucune"}{audit[p.id]!.sharedWithOtherNames && <em> · partagée avec un autre article</em>}</small>}</span>
                <span className="rowbtns">
                  {audit[p.id]?.catalogPhotoUrl && <button className="btn btn--small" data-testid={`usecat-${p.name}`} aria-label={`Comparer la photo de ${p.name} avec celle du catalogue`} onClick={() => setCompare({ product: p, catalogUrl: audit[p.id]!.catalogPhotoUrl! })}>Photo du catalogue</button>}
                  <button className="btn btn--small" data-testid={`edit-${p.name}`} aria-label={`Modifier ${p.name}`} onClick={() => setForm({ product: p })}>Modifier</button>
                  <button className="btn btn--small btn--ghost" data-testid={`active-${p.name}`} onClick={() => void act(() => api.patchProduct(p.id, { active: !p.active }))}>{p.active ? "Désactiver" : "Réactiver"}</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
        );
      })}
      </>}
      {compare && (
        <Dialog title={`Photo de « ${compare.product.name} »`} onClose={() => setCompare(null)}>
          <div className="cmp" data-testid="photo-compare">
            <figure><CatPhoto url={compare.product.photoUrl} name={compare.product.name} /><figcaption>Actuelle</figcaption></figure>
            <figure><CatPhoto url={compare.catalogUrl} name={`${compare.product.name} (catalogue)`} /><figcaption>Catalogue</figcaption></figure>
          </div>
          <p className="muted">La photo du catalogue correspond au même nom de produit. Remplacer ne touche à aucune autre photo ; l'ancienne reste dans l'historique des listes archivées.</p>
          <button className="btn btn--primary btn--big" data-testid="usecat-confirm" onClick={() => { const id = compare.product.id; setCompare(null); void act(() => api.patchProduct(id, { resetImage: true })); }}>Utiliser la photo du catalogue</button>
          <button className="btn btn--ghost" onClick={() => setCompare(null)}>Garder la photo actuelle</button>
        </Dialog>
      )}
    </>
  );
}
