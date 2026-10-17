import { unitLabel } from "../units";
import { VersionInfo } from "../components/VersionInfo";
import { useEffect, useState } from "react";
import { api, ApiError, NetworkError, type AuditProduct, type BackupStatus, type Profile, type ResetPreview } from "../api";
import { userMessage } from "../errors";
import { PriceDisplaySettings } from "../components/PriceDisplaySettings";
import { SyncPrices } from "../components/SyncPrices";
import { ShareSheet, type ShareTarget } from "../components/ShareAccess";
import { fmtDateTime } from "../format";
import { CATEGORY_EMOJI } from "../categories";
import { CityPicker } from "../components/CityPicker";
import { Dialog } from "../components/Dialog";
import { Menu, MenuItem } from "../components/Menu";
import { Icon, type IconName } from "../components/Icon";
import { RecoveryPanel } from "../components/RecoveryPanel";
import { isAnySecret, isNewSecret, SecretInput } from "../components/SecretInput";
import { NotificationSettings, usePushControl } from "../components/NotificationSettings";
import { PageHead } from "../components/PageHead";
import { useBackLayer } from "../useBackLayer";
import { PriceDialog } from "../components/PriceDialog";
import { PricesAdmin } from "./PricesAdmin";
import { setV3On, useV3 } from "../v3";
import { ProductForm } from "../components/ProductForm";
import { Thumb } from "../components/Thumb";
import { CatalogBrowser, CatPhoto } from "./CatalogBrowser";
import type { Engine, State } from "../sync/engine";
import type { Catalog, Product, Role } from "../types";

/** Accents and case flattened, for the local filter of the family list. */
const flatten = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/œ/g, "oe").trim();

const ROLE_LABEL: Record<Role, string> = { admin: "Administrateur", parent: "Parent", staff: "Personnel" };

const errText = userMessage;

type Section = "pricing" | "v3" | "profiles" | "recovery" | "reset" | "catalog" | "prices" | "notifications" | "backups" | "about";

/** Backup state in one sentence: what matters to the family. How it works stays on the operator side (server logs). */
function backupSummary(st: BackupStatus | null): { ok: boolean; text: string } {
  if (!st) return { ok: true, text: "Vérification…" };
  const old = (iso: string | null, days: number) => !iso || Date.now() - new Date(iso).getTime() > days * 86_400_000;
  const failedSince = st.lastVerifyFailedAt && (!st.lastVerifiedOkAt || st.lastVerifyFailedAt > st.lastVerifiedOkAt);
  if (!st.configured || failedSince || (st.tools && !st.tools.ok) || old(st.lastVerifiedOkAt, 3)) return { ok: false, text: "À vérifier" };
  return { ok: true, text: "Données sauvegardées" };
}

export function Settings({ engine, s }: { engine: Engine; s: State }) {
  const [section, setSection] = useState<Section | null>(null);
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const push = usePushControl();
  const v3on = useV3();
  useEffect(() => void api.backupStatus().then(setBackup).catch(() => {}), []);
  useBackLayer(section !== null, () => setSection(null)); // Android Back: from a section to the list of settings
  const bs = backupSummary(backup);
  const pushText = push.status === "on" ? "Activées sur cet appareil" : push.status === "denied" ? "Bloquées par le téléphone" : push.status === "unsupported" ? "Non prises en charge" : "Désactivées sur cet appareil";

  if (section === null) {
    const items: { key: Section; icon: IconName; title: string; text: string; testid: string }[] = [
      { key: "profiles", icon: "users", title: "Famille et profils", text: "Profils, rôles, codes d'accès", testid: "seg-profiles" },
      { key: "recovery", icon: "lock", title: "Adresse de récupération", text: "Code famille et mot de passe oubliés", testid: "seg-recovery" },
      { key: "catalog", icon: "grid", title: "Catalogue", text: "Produits, photos, unités et prix", testid: "seg-catalog" },
      { key: "pricing", icon: "grid", title: "Gestion des prix", text: "Prix des articles, manquants, synchronisation", testid: "seg-pricing" },
      { key: "prices", icon: "info", title: "Prix", text: s.me?.prefs?.showTotals ? "Prix et total estimé" : s.me?.prefs?.showPrices ? "Prix indicatifs" : "Affichage simple, sans prix", testid: "seg-prices" },
      { key: "notifications", icon: "bell", title: "Notifications", text: pushText, testid: "seg-notifications" },
      { key: "backups", icon: "shield", title: "Sauvegarde", text: bs.text, testid: "seg-backups" },
      ...(s.me?.primary ? [{ key: "v3" as Section, icon: "grid" as IconName, title: "Aperçu V3", text: v3on ? "Activé sur cet appareil" : "Essai de la nouvelle interface", testid: "seg-v3" }] : []),
      ...(s.me?.primary ? [{ key: "reset" as Section, icon: "shield" as IconName, title: "Réinitialiser la famille", text: "Suppression définitive, pour recommencer", testid: "seg-reset" }] : []),
      { key: "about", icon: "info", title: "À propos", text: "Mises à jour de l'application", testid: "seg-about" },
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
  const titles: Record<Section, string> = { pricing: "Gestion des prix", v3: "Aperçu V3", profiles: "Famille et profils", recovery: "Adresse de récupération", reset: "Réinitialiser la famille", catalog: "Catalogue", prices: "Prix", notifications: "Notifications", backups: "Sauvegarde", about: "À propos" };
  return (
    <>
      <PageHead engine={engine} s={s} title={titles[section]} onBack={() => setSection(null)} backLabel="Réglages" backTestId="settings-back" subtitle={section === "profiles" && s.me?.family ? <>Code de la famille : <b data-testid="family-code">{s.me.family.code}</b></> : undefined} />
      {section === "pricing" && <PricesAdmin engine={engine} s={s} />}
      {section === "v3" && s.me?.primary && <PreviewV3 />}
      {section === "profiles" && <Profiles me={s.me!.id} familyCode={s.me!.family?.code ?? ""} />}
      {section === "recovery" && <RecoveryPanel />}
      {section === "reset" && <ResetFamily engine={engine} />}
      {section === "catalog" && <CatalogAdmin engine={engine} s={s} />}
      {section === "prices" && <><PriceDisplaySettings engine={engine} s={s} /><h2 className="sect">Synchroniser les prix</h2><SyncPrices engine={engine} s={s} /></>}
      {section === "notifications" && <div className="menu"><NotificationSettings /></div>}
      {section === "backups" && <BackupCard st={backup} />}
      {section === "about" && <div className="versioninfo--page"><VersionInfo engine={engine} /></div>}
    </>
  );
}

/** Aperçu V3 : active (ou coupe) la nouvelle interface de choix des articles sur CET appareil seulement. Réservé à l'administrateur principal. */
function PreviewV3() {
  const on = useV3();
  return (
    <div className="panel" data-testid="v3-panel">
      <p>Nouvelle interface de choix des articles (trois affichages, panneau de quantité), en essai.</p>
      <p className="muted" data-testid="v3-scope">Réservé à cet appareil : les autres téléphones et les autres profils ne la voient pas. Aucune donnée n'est modifiée.</p>
      <label className="check"><input type="checkbox" checked={on} onChange={(e) => setV3On(e.target.checked)} data-testid="v3-toggle" /> Activer la V3 sur cet appareil</label>
      {on && <button className="btn" data-testid="v3-off" onClick={() => setV3On(false)}>Revenir à la V2</button>}
    </div>
  );
}

function BackupCard({ st }: { st: BackupStatus | null }) {
  if (!st) return <p className="empty">Vérification…</p>;
  const sum = backupSummary(st);
  return (
    <div className="panel backupcard" data-testid="backup-card">
      <p><span className={`statebadge ${sum.ok ? "" : "statebadge--bad"}`} data-testid="backup-state"><Icon name={sum.ok ? "check" : "info"} size={16} /> {sum.ok ? "Vos données sont sauvegardées automatiquement" : "La sauvegarde automatique doit être vérifiée"}</span></p>
      <p className="muted">{st.lastBackupAt ? `Dernière sauvegarde : ${fmtDateTime(st.lastBackupAt)}` : "Aucune sauvegarde pour le moment."}</p>
      {!sum.ok && <p className="muted">Contactez la personne qui gère l'application.</p>}
    </div>
  );
}

function Profiles({ me, familyCode }: { me: string; familyCode: string }) {
  const [list, setList] = useState<Profile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [changing, setChanging] = useState<Profile | null>(null);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [shareAfter, setShareAfter] = useState(false); // « Définir un nouveau code et partager »
  const [sharing, setSharing] = useState<(ShareTarget & { id?: string }) | null>(null);
  // Result of the operation that just succeeded. The code lives here, in memory only, until the summary is closed or the screen left.
  const [done, setDone] = useState<{ text: string; id: string; displayName: string; login: string; secret: string } | null>(null);
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
  const openShare = (p: { id: string; displayName: string; login: string }) => setSharing({ id: p.id, displayName: p.displayName, login: p.login, secret: done?.id === p.id ? done.secret : undefined });
  const closeShare = () => { setSharing(null); setDone(null); }; // closing the summary erases the code from memory

  return (
    <>
      {error && <p className="error" role="alert" data-testid="settings-error">{error}</p>}
      {done && (
        <p className="notice notice--row" role="status" data-testid="settings-notice">
          <span>{done.text}</span>
          <button className="btn btn--small btn--primary" data-testid="share-open" onClick={() => openShare(done)}>Partager les accès</button>
          <button className="btn btn--small btn--ghost" aria-label="Masquer" data-testid="notice-dismiss" onClick={() => setDone(null)}>✕</button>
        </p>
      )}
      <ul className="rows rows--tight" data-testid="profiles">
        {list?.map((p) => (
          <li key={p.id} className={`row row--stack row--compact ${p.active ? "" : "row--off"}`} data-testid={`profile-${p.login}`}>
            <span className="row__name">
              <span className="row__title">{p.displayName}{p.id === me && " (vous)"}{p.primary && <span className="tag" data-testid={`primary-${p.login}`}>Principal</span>}</span>
              <small>@{p.login} · {ROLE_LABEL[p.role]}{p.active ? "" : " · désactivé"}</small>
            </span>
            {/* Le profil principal n'a ni rôle à choisir ni désactivation : pas de fenêtre pour lui. */}
            {!p.primary && <button className="btn btn--small btn--ghost" aria-label={`Modifier le profil de ${p.displayName}`} data-testid={`edit-${p.login}`} onClick={() => setEditing(p)}>Profil</button>}
            <span className="row__actions">
              <button className="btn btn--small" data-testid={`reset-${p.login}`} onClick={() => { setDone(null); setChanging(p); }}>Modifier le code</button>
              <button className="btn btn--small" data-testid={`share-${p.login}`} onClick={() => openShare(p)}>Partager</button>
            </span>
          </li>
        ))}
      </ul>
      <button className="btn btn--primary addbtn addbtn--compact" data-testid="add-profile" onClick={() => setAdding(true)}>+ Ajouter un profil</button>
      {adding && <AddProfile defaultCity={list?.find((x) => x.primary)?.city ?? ""} onClose={() => setAdding(false)} onCreated={(r) => { setAdding(false); setDone({ text: `Profil créé : ${r.displayName}.`, ...r }); void load(); }} />}
      {changing && <ChangePassword profile={changing} onClose={() => { setChanging(null); setShareAfter(false); }} onDone={(secret) => {
        const r = { id: changing.id, displayName: changing.displayName, login: changing.login, secret };
        setDone({ text: `Code secret de ${changing.displayName} modifié. Ses sessions ont été fermées.`, ...r });
        if (shareAfter) setSharing(r); // the code was saved: the complete access summary opens at once
        setShareAfter(false);
        setChanging(null);
        void load();
      }} />}
      {editing && <EditProfile profile={editing} onClose={() => setEditing(null)} run={async (fn) => { await run(fn); setEditing(null); }} />}
      {sharing && (
        <ShareSheet
          target={sharing}
          familyCode={familyCode}
          onClose={closeShare}
          onNewCode={() => { const p = list?.find((x) => x.id === sharing.id); setSharing(null); if (p) { setDone(null); setShareAfter(true); setChanging(p); } }}
        />
      )}
    </>
  );
}

/** « Modifier le profil » : rôle, désactivation. Un administrateur n'est jamais désactivé (le bouton n'existe pas, le serveur refuse aussi). */
function EditProfile({ profile, onClose, run }: { profile: Profile; onClose(): void; run(fn: () => Promise<unknown>): Promise<void> }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <Dialog title={`Modifier le profil de ${profile.displayName}`} onClose={onClose}>
      <div className="form">
        <label className="field">Rôle
          <select aria-label="Rôle" value={profile.role} data-testid="edit-role" onChange={(e) => void run(() => api.updateProfile(profile.id, { role: e.target.value as Role }))}>
            {(["admin", "parent", "staff"] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </label>
        {profile.role !== "admin" && (
          <button className="btn" data-testid={`toggle-${profile.login}`} onClick={() => void run(() => api.updateProfile(profile.id, { active: !profile.active }))}>{profile.active ? "Désactiver ce profil" : "Réactiver ce profil"}</button>
        )}
        {profile.role !== "admin" && !confirmDelete && <button className="btn btn--ghost" data-testid={`delete-${profile.login}`} onClick={() => setConfirmDelete(true)}>Supprimer ce profil…</button>}
        {confirmDelete && (
          <div className="panel danger" data-testid="delete-confirm">
            <p>Supprimer définitivement le profil de <b>{profile.displayName}</b> ? Son nom, son identifiant et son code sont effacés et ses accès fermés. Son nom devient « Ancien profil » dans l'historique des achats.</p>
            <button className="btn btn--danger" data-testid={`delete-confirm-${profile.login}`} onClick={() => void run(() => api.deleteProfile(profile.id))}>Oui, supprimer ce profil</button>
            <button className="btn btn--ghost" onClick={() => setConfirmDelete(false)}>Non, garder</button>
          </div>
        )}
        <button className="btn btn--ghost" onClick={onClose}>Fermer</button>
      </div>
    </Dialog>
  );
}

/** Un NOUVEAU code secret : 6 à 8 chiffres, choisi à la main, saisi deux fois, clavier numérique, saisie masquée. */
function PasswordFields({ secret, again, setSecret, setAgain, prefix }: { secret: string; again: string; setSecret(v: string): void; setAgain(v: string): void; prefix: string }) {
  const mismatch = again.length > 0 && secret !== again;
  return (
    <>
      <label className="field">Code secret — entre 6 et 8 chiffres<SecretInput kind="new" value={secret} onChange={setSecret} testid={`${prefix}-secret`} /></label>
      <label className="field">Confirmer le code secret<SecretInput kind="new" value={again} onChange={setAgain} testid={`${prefix}-secret2`} /></label>
      {mismatch && <p className="error" data-testid={`${prefix}-mismatch`}>Les deux codes secrets ne sont pas identiques.</p>}
    </>
  );
}

function ChangePassword({ profile, onClose, onDone }: { profile: Profile; onClose(): void; onDone(secret: string): void }) {
  const [secret, setSecret] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={`Modifier le code de ${profile.displayName}`} onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api.resetSecret(profile.id, secret, again);
          onDone(secret); // only after the server confirmed the change
        } catch (err) {
          setError(errText(err));
          setBusy(false);
        }
      }}>
        <PasswordFields secret={secret} again={again} setSecret={setSecret} setAgain={setAgain} prefix="pw" />
        <p className="muted">L'ancien code n'est jamais affiché. Toutes les sessions de ce profil seront fermées.</p>
        {error && <p className="error" role="alert" data-testid="pw-error">{error}</p>}
        <button className="btn btn--primary btn--big" disabled={busy || !isNewSecret(secret) || secret !== again} data-testid="pw-submit">{busy ? "Enregistrement…" : "Enregistrer le code secret"}</button>
        <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
      </form>
    </Dialog>
  );
}

function AddProfile({ defaultCity, onClose, onCreated }: { defaultCity: string; onClose(): void; onCreated(r: { id: string; displayName: string; login: string; secret: string }): void }) {
  const [displayName, setName] = useState("");
  const [login, setLogin] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const [secret, setSecret] = useState("");
  const [again, setAgain] = useState("");
  const [city, setCity] = useState(defaultCity);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title="Nouveau profil" onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        try {
          const r = await api.createProfile({ displayName, login: login.trim().toLowerCase(), role, secret, secretConfirm: again, city });
          onCreated({ id: r.profile.id, displayName: r.profile.displayName, login: r.profile.login, secret }); // only after the server confirmed the creation
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
        <CityPicker key={defaultCity} value={city} onChange={setCity} testid="np-city" />
        <PasswordFields secret={secret} again={again} setSecret={setSecret} setAgain={setAgain} prefix="np" />
        <p className="muted">Vous choisissez ce code : entre 6 et 8 chiffres. Rien n'est généré automatiquement.</p>
        {error && <p className="error" role="alert" data-testid="np-error">{error}</p>}
        <button className="btn btn--primary btn--big" disabled={!isNewSecret(secret) || secret !== again || !displayName.trim() || !login.trim() || !city} data-testid="np-submit">Créer</button>
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
  const ready = pv.ready.recoveryEmailVerified;
  return (
    <div className="panel danger" data-testid="reset-panel">
      <p data-testid="reset-family"><b>Famille « {pv.family.name} »</b></p>
      <p data-testid="reset-counts">Tous les profils, listes, achats et articles de cette famille seront supprimés. Cette action est définitive.</p>
      {!ready && (
        <p className="error" role="alert" data-testid="reset-notready">
          La suppression n'est possible qu'une fois votre adresse e-mail de récupération vérifiée (Réglages → Adresse de récupération).
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
          setError(errText(err));
          setBusy(false);
        }
      }}>
        <label className="field">Votre mot de passe actuel<SecretInput kind="current" value={password} onChange={setPassword} testid="reset-password" /></label>
        <label className="field"><span>Retapez le code famille (<b data-testid="reset-code">{pv.family.code}</b>)</span><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" required data-testid="reset-confirm-code" /></label>
        <label className="check"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} data-testid="reset-sure" /> Je confirme la suppression de la famille.</label>
        {error && <p className="error" role="alert" data-testid="reset-error">{error}</p>}
        <button className="btn btn--danger btn--big" disabled={busy || !ready || !sure || !isAnySecret(password) || code.trim().toUpperCase() !== pv.family.code} data-testid="reset-submit">{busy ? "Suppression…" : "Supprimer définitivement la famille"}</button>
      </form>
    </div>
  );
}


function CatalogAdmin({ engine, s }: { engine: Engine; s: State }) {
  const [view, setView] = useState<"mine" | "all">("mine");
  const [cat, setCat] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [form, setForm] = useState<{ product?: Product } | null>(null);
  const [audit, setAudit] = useState<Record<string, AuditProduct>>({});
  const [filter, setFilter] = useState<"all" | "check" | "own" | "none">("all");
  const [tab, setTab] = useState<"all" | "shown" | "hidden">("all");
  const [photosOpen, setPhotosOpen] = useState(false);
  const [priceFor, setPriceFor] = useState<string | null>(null); // id de l'article dont on met le prix à jour
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
  const every = cat?.categories.flatMap((c) => c.products) ?? [];
  const nShown = every.filter((p) => p.active).length;
  const nHidden = every.length - nShown;
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
      {view === "mine" && <>
      {form && cat && (
        <ProductForm
          key={form.product?.id ?? "new"}
          product={form.product ? cat.categories.flatMap((c) => c.products).find((x) => x.id === form.product!.id) ?? form.product : undefined}
          categories={cat.categories.map((c) => ({ key: c.key, label: c.label }))}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); void act(async () => {}); }}
        />
      )}
      {priceFor && cat && (() => {
        const prod = cat.categories.flatMap((c) => c.products).find((x) => x.id === priceFor);
        return prod ? <PriceDialog key={prod.id} product={prod} onClose={() => setPriceFor(null)} onChanged={() => void act(async () => {})} /> : null;
      })()}
      <div className="catbar">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher un produit" aria-label="Chercher dans mes produits" data-testid="mine-search" />
        <button className="btn btn--primary btn--small" data-testid="add-article" onClick={() => setForm({})}>+ Article</button>
      </div>
      <div className="seg seg--wrap cattabs" role="tablist" aria-label="Articles affichés ou masqués">
        {([["all", `Tous (${every.length})`], ["shown", `Affichés (${nShown})`], ["hidden", `Masqués (${nHidden})`]] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} data-testid={`cat-tab-${k}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      <button className="linkbtn linkbtn--inline photoslink" aria-expanded={photosOpen} data-testid="pf-toggle" onClick={() => setPhotosOpen((v) => !v)}>
        {photosOpen ? "Masquer le contrôle des photos" : `Contrôle des photos${count((a) => a.sharedWithOtherNames || !!a.catalogPhotoUrl) ? ` · ${count((a) => a.sharedWithOtherNames || !!a.catalogPhotoUrl)} à vérifier` : ""}`}
      </button>
      {photosOpen && (
        <div className="catchips" role="tablist" aria-label="Contrôle des photos" data-testid="photo-filters">
          {([["all", "Tous"], ["check", `À vérifier (${count((a) => a.sharedWithOtherNames || !!a.catalogPhotoUrl)})`], ["own", `Photos de la famille (${count((a) => a.photoSource === "famille")})`], ["none", `Sans photo (${count((a) => a.photoSource === "none")})`]] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={filter === k} className={`catchip ${filter === k ? "on" : ""}`} data-testid={`pf-${k}`} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>
      )}
      {cat?.categories.map((c) => {
        const needle = flatten(q);
        const prods = c.products.filter((p) => (!needle || flatten(p.name).includes(needle)) && matches(p) && (tab === "all" || (tab === "shown") === p.active));
        if (!prods.length) return null;
        return (
        <section key={c.key}>
          <h2 className="sect">{CATEGORY_EMOJI[c.key]} {c.label}</h2>
          <ul className="rows">
            {prods.map((p) => (
              <li key={p.id} className={`row row--cat row--cat4 ${p.active ? "" : "row--off"}`} data-testid={`prod-${p.name}`} data-active={p.active ? "1" : "0"}>
                <Thumb photoUrl={p.photoUrl} category={c.key} />
                <span className="row__name">{p.name}<small>{[p.brand, unitLabel(p.unit)].filter(Boolean).join(" · ")} · <b className={p.active ? "stateon" : "stateoff"} data-testid={`state-${p.name}`}>{p.active ? "Affiché" : "Masqué"}</b></small></span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={p.active}
                  aria-label={`${p.name} : ${p.active ? "affiché" : "masqué"}. Changer`}
                  className={`switch ${p.active ? "on" : ""}`}
                  data-testid={`active-${p.name}`}
                  onClick={() => void act(() => api.patchProduct(p.id, { active: !p.active }))}
                >
                  <span className="switch__track" aria-hidden="true"><i /></span>
                </button>
                <span className="rowbtns">
                  <button className="btn btn--small" data-testid={`edit-${p.name}`} aria-label={`Modifier ${p.name}`} onClick={() => setForm({ product: p })}>Modifier</button>
                  {s.me?.prefs?.showPrices && <button className="btn btn--small" data-testid={`price-${p.name}`} aria-label={`Mettre à jour le prix de ${p.name}`} onClick={() => setPriceFor(p.id)}>Prix</button>}
                  {audit[p.id]?.catalogPhotoUrl && (
                    <Menu label={`Autres actions pour ${p.name}`} testid={`more-${p.name}`}>
                      {(close) => <MenuItem testid={`usecat-${p.name}`} onClick={() => { close(); setCompare({ product: p, catalogUrl: audit[p.id]!.catalogPhotoUrl! }); }}>Photo du catalogue</MenuItem>}
                    </Menu>
                  )}
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
