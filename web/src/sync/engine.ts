import { api as realApi, ApiError, NetworkError } from "../api";
import { AppDbClass, type AppDb, type OrphanRow } from "../db";
import type { Batch, Catalog, ListView, Me, Op, OpResult, Toggles } from "../types";
import { clampQty, clampQtyFine, fmtQty } from "../units";
import { buildOps, cancelQueuedAdd, editQueuedAdd, interpretResults, isPurchased, normalizeToggles, openItem, planBasket, projectedPresence, requestAgainToggle, setQuantityToggle, toggleProduct } from "./logic";
import type { BasketItem, BasketMode, BasketReport } from "./logic";

export interface Notice {
  id: number;
  text: string;
}

export interface State {
  phase: "boot" | "loggedOut" | "ready";
  me: Me | null;
  /** "offline" as soon as a request could not reach the server; back to "online" on the next answer. */
  conn: "online" | "offline";
  catalog: Catalog | null;
  /** undefined = not loaded yet · null = loaded, no active list */
  list: ListView | null | undefined;
  /** Unvalidated choices for `draftListId`. */
  toggles: Toggles;
  draftListId: string | null;
  /** Validated, not yet confirmed by the server (survives closing the app). */
  batches: Batch[];
  sending: boolean;
  justSynced: boolean;
  notices: Notice[];
  orphan: OrphanRow | null;
  /** Une liste clôturée a été supprimée (ici ou sur un autre téléphone) : l'historique se relit et ferme cette liste si elle est ouverte. */
  deleted: { listId: string; n: number } | null;
  loginError: string | null;
  loggingIn: boolean;
  lastLogin: { familyCode: string; login: string } | null;
  /** True while the live (SSE) channel is connected. */
  live: boolean;
  /** Family code to show once right after the first installation. */
  welcomeCode: string | null;
  /** Single-use installation token shown after a family reset, to prefill the first-installation form. */
  prefillInstallToken: string | null;
  /** Why the installation is open: the family was just deleted here, or an installation link was opened. */
  installFrom: "reset" | "link" | null;
  /** The installation authorisation was refused (used up or no longer valid). */
  installRefused: boolean;
  /** How this person likes the catalogue shown (kept per profile on this phone). */
  catalogView: CatalogView;
  v3Mode: V3Mode;
}

export type CatalogView = "all" | "categories";
/** V3 : trois présentations des articles à choisir (mémorisée par utilisateur sur cet appareil). */
/** Brouillon et lots d'envoi faits alors qu'aucune liste n'existe : la liste en cours est créée par le serveur à l'enregistrement. */
export const NO_LIST = "none";
export type V3Mode = "list" | "squares" | "cards";

/** The subset of EventSource the engine uses (so tests can fake it). */
export interface EventSourceLike {
  readyState: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onerror: ((e: any) => void) | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addEventListener(type: string, fn: (e: any) => void): void;
  close(): void;
}

export interface EngineDeps {
  /** Cancels this phone's notification subscription (signing out). */
  releasePush?: () => Promise<void>;
  eventSource?: (url: string) => EventSourceLike;
  api?: typeof realApi;
  db: AppDb;
  newId?: () => string;
  preload?: (urls: string[]) => void;
}

const TOKEN_KEY = "smartcourse.installToken";
const FROM_KEY = "smartcourse.installFrom";
const RETRY_MS = [3_000, 8_000, 20_000, 45_000];

export class Engine {
  private s: State = {
    phase: "boot", me: null, conn: "online", catalog: null, list: undefined, toggles: {}, draftListId: null, batches: [],
    sending: false, justSynced: false, notices: [], orphan: null, deleted: null, loginError: null, loggingIn: false, lastLogin: null, live: false, welcomeCode: null, prefillInstallToken: null, installFrom: null, installRefused: false, catalogView: "all", v3Mode: "squares",
  };
  private listeners = new Set<() => void>();
  /** Lots refusés par le serveur (jamais enregistrés) : lus par validate() pour ne pas annoncer un succès. */
  private dropped = new Set<string>();
  /** Demandes non envoyées d'une AUTRE famille, effacées de ce téléphone à la connexion (annoncées une fois). */
  private lostOnSwitch = 0;
  private api: typeof realApi;
  private db: AppDb;
  private newId: () => string;
  private preloadFn: (urls: string[]) => void;
  private noticeSeq = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryStep = 0;
  private retryPending = false;
  private inFlightBatchId: string | undefined;
  private preloaded = new Set<string>();
  private syncedTimer: ReturnType<typeof setTimeout> | undefined;
  private makeEventSource?: (url: string) => EventSourceLike;
  private es: EventSourceLike | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(deps: EngineDeps) {
    this.api = deps.api ?? realApi;
    this.db = deps.db;
    this.newId = deps.newId ?? (() => crypto.randomUUID());
    this.preloadFn = deps.preload ?? (() => {});
    this.makeEventSource = deps.eventSource;
    this.releasePush = deps.releasePush;
  }
  private releasePush?: () => Promise<void>;

  // ---- store plumbing ------------------------------------------------------------------------
  getState = (): State => this.s;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  private set(patch: Partial<State>) {
    // Never keep saying "saved" once the server stopped answering.
    if (patch.conn === "offline") patch = { ...patch, justSynced: false };
    this.s = { ...this.s, ...patch };
    for (const l of this.listeners) l();
  }
  private notice(text: string) {
    this.set({ notices: [...this.s.notices, { id: ++this.noticeSeq, text }] });
  }
  dismissNotice = (id: number) => this.set({ notices: this.s.notices.filter((n) => n.id !== id) });

  // ---- startup & session ---------------------------------------------------------------------
  async start(): Promise<void> {
    const last = (await this.db.meta.get("lastLogin"))?.value as State["lastLogin"] | undefined;
    let token: string | null = null;
    let from: State["installFrom"] = null;
    try {
      token = localStorage.getItem(TOKEN_KEY);
      if (token) from = localStorage.getItem(FROM_KEY) === "reset" ? "reset" : "link";
    } catch {
      /* ignore */
    }
    this.set({ lastLogin: last ?? null, prefillInstallToken: token, installFrom: from });
    try {
      const { me } = await this.api.me();
      await this.enter(me);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        this.set({ phase: "loggedOut" });
      } else {
        // Offline start: keep working from the last known person and the local cache.
        const cached = (await this.db.meta.get("lastMe"))?.value as Me | undefined;
        if (!cached) return this.set({ phase: "loggedOut", conn: "offline" });
        this.set({ conn: "offline" });
        await this.enter(cached, false);
        this.scheduleRetry();
      }
    }
  }

  dismissWelcome = () => this.set({ welcomeCode: null });

  /** The address of a new family was verified (on this phone or another): leave the waiting screen and enter the application. */
  async completeSetup(): Promise<boolean> {
    const { me } = await this.api.me();
    if (me.setupPending) return false;
    await this.enter(me);
    return true;
  }

  /**
   * The family was deleted on the server (definitive reset): nothing of it stays on this phone — lists, drafts, outbox, catalogue,
   * remembered identity, cached pictures — and the first-installation form opens with the new single-use token.
   */
  async afterFamilyReset(installToken: string): Promise<void> {
    clearTimeout(this.retryTimer);
    this.retryPending = false;
    this.closeEvents();
    await Promise.race([this.releasePush?.().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
    await this.wipeLocal();
    try {
      localStorage.setItem(TOKEN_KEY, installToken); // kept for the installation: it must survive a closed tab until it is used
      localStorage.setItem(FROM_KEY, "reset");
    } catch {
      /* private mode: memory only */
    }
    this.set({ phase: "loggedOut", me: null, catalog: null, list: undefined, toggles: {}, batches: [], draftListId: null, orphan: null, notices: [], lastLogin: null, welcomeCode: null, prefillInstallToken: installToken, installFrom: "reset", installRefused: false });
  }

  /** The person deleted their own account: nothing of it stays on this phone and the login screen opens. */
  async afterAccountDeleted(): Promise<void> {
    clearTimeout(this.retryTimer);
    this.retryPending = false;
    this.closeEvents();
    await Promise.race([this.releasePush?.().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
    await this.wipeLocal();
    this.set({ phase: "loggedOut", me: null, catalog: null, list: undefined, toggles: {}, batches: [], draftListId: null, orphan: null, notices: [], lastLogin: null, welcomeCode: null });
  }

  /** An installation link (/#/install/…) was opened: the authorisation is kept here, never typed or shown. */
  acceptInstallLink(token: string): void {
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(FROM_KEY, "link");
    } catch {
      /* private mode: memory only */
    }
    this.set({ prefillInstallToken: token, installFrom: "link", installRefused: false, loginError: null });
  }

  private forgetInstallToken(): void {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(FROM_KEY);
    } catch {
      /* ignore */
    }
  }

  /** Everything this phone remembers about any family. */
  private async wipeLocal(): Promise<void> {
    await Promise.all([this.db.cache.clear(), this.db.drafts.clear(), this.db.outbox.clear(), this.db.orphans.clear(), this.db.meta.clear()]);
    try {
      if (typeof caches !== "undefined") for (const k of await caches.keys()) if (!/precache/i.test(k)) await caches.delete(k);
    } catch {
      /* the cache API may be unavailable */
    }
  }

  /**
   * Signing in as a DIFFERENT family than the one remembered here (e.g. after a reset and a new installation): the old family's
   * drafts, outbox and cache are erased first, so nothing of it can ever be sent into the new one.
   */
  private async wipeIfOtherFamily(me: Me): Promise<void> {
    const mine = me.familyId;
    const stale = async (table: { filter(fn: (r: { familyId: string }) => boolean): { count(): Promise<number> } }) => (await table.filter((r) => r.familyId !== mine).count()) > 0;
    const known = (await this.db.meta.get("lastMe"))?.value as Me | undefined;
    const other = (known && known.familyId !== mine) || (await stale(this.db.cache as never)) || (await stale(this.db.outbox as never)) || (await stale(this.db.drafts as never)) || (await stale(this.db.orphans as never));
    if (!other) return;
    const login = (await this.db.meta.get("lastLogin"))?.value;
    // Jamais de perte silencieuse : ce qui n'avait pas encore été envoyé (lots en attente, brouillons) est compté puis annoncé.
    const lost = (await this.db.outbox.filter((r) => r.familyId !== mine).toArray()).reduce((n, b) => n + (b as unknown as { ops: unknown[] }).ops.length, 0)
      + (await this.db.drafts.filter((r) => r.familyId !== mine).toArray()).reduce((n, d) => n + Object.keys(d.toggles).length, 0);
    this.lostOnSwitch = lost;
    await this.wipeLocal();
    if (login && this.s.lastLogin) await this.db.meta.put({ key: "lastLogin", value: this.s.lastLogin });
  }

  async login(familyCode: string, login: string, secret: string): Promise<void> {
    this.set({ loggingIn: true, loginError: null });
    try {
      await this.api.login(familyCode, login, secret);
      const { me } = await this.api.me(); // full profile (an administrator also gets the family code)
      await this.db.meta.put({ key: "lastLogin", value: { familyCode: familyCode.trim().toUpperCase(), login: login.trim().toLowerCase() } });
      this.set({ lastLogin: { familyCode: familyCode.trim().toUpperCase(), login: login.trim().toLowerCase() } });
      await this.enter(me);
    } catch (e) {
      const msg =
        e instanceof NetworkError ? "Pas de connexion. Réessayez."
        : e instanceof ApiError && e.status === 401 ? "Identifiants invalides ou accès temporairement bloqué."
        : e instanceof ApiError && e.status === 429 ? "Trop d'essais. Patientez un instant."
        : "Connexion impossible.";
      this.set({ loginError: msg });
    } finally {
      this.set({ loggingIn: false });
    }
  }

  /** First installation: consumes the one-shot install token, creates the family and its first administrator. */
  async setup(input: { familyName: string; displayName: string; login: string; secret: string; secretConfirm: string; recoveryEmail: string; city: string }): Promise<string | null> {
    this.set({ loggingIn: true, loginError: null });
    try {
      const r = await this.api.setupFamily({
        installToken: (this.s.prefillInstallToken ?? "").trim(),
        familyName: input.familyName,
        admin: { displayName: input.displayName, login: input.login.trim().toLowerCase(), secret: input.secret, secretConfirm: input.secretConfirm, recoveryEmail: input.recoveryEmail.trim(), city: input.city },
      });
      const lastLogin = { familyCode: r.familyCode, login: input.login.trim().toLowerCase() };
      await this.db.meta.put({ key: "lastLogin", value: lastLogin });
      this.forgetInstallToken(); // used: it cannot be used again anyway
      this.set({ lastLogin, welcomeCode: r.familyCode, prefillInstallToken: null, installFrom: null, installRefused: false });
      const { me } = await this.api.me();
      await this.enter(me);
      return r.familyCode;
    } catch (e) {
      if (e instanceof ApiError && e.code === "invalid_install_token") {
        this.forgetInstallToken();
        this.set({ prefillInstallToken: null, installFrom: null, installRefused: true, loginError: null });
        return null;
      }
      this.set({
        loginError:
          e instanceof NetworkError ? "Pas de connexion. Réessayez."
          : e instanceof ApiError && e.code === "mail_unavailable" ? "L’e-mail n’a pas pu être envoyé. Veuillez réessayer dans quelques instants. Rien n’a été créé : vous pouvez réessayer."
          : e instanceof ApiError && e.code === "email_required" ? "Une adresse e-mail de récupération est obligatoire."
          : e instanceof ApiError && e.code === "weak_secret" ? "Code secret trop simple (évitez 123456, 111111…)."
          : e instanceof ApiError && e.status === 400 ? "Vérifiez les champs (identifiant : lettres minuscules, chiffres, . _ -)."
          : "Installation impossible.",
      });
      return null;
    } finally {
      this.set({ loggingIn: false });
    }
  }

  private async enter(me: Me, online = true): Promise<void> {
    if (online) await this.wipeIfOtherFamily(me);
    await this.db.meta.put({ key: "lastMe", value: me });
    if (me.setupPending) {
      // Installation inachevée : seul l'écran de vérification est possible (le serveur refuse tout le reste).
      this.set({ me, phase: "ready" });
      return;
    }
    this.set({ me, phase: "ready" });
    await this.loadLocal(me);
    if (this.lostOnSwitch > 0) {
      this.notice(`${this.lostOnSwitch} demande${this.lostOnSwitch > 1 ? "s" : ""} non envoyée${this.lostOnSwitch > 1 ? "s" : ""} d'une autre famille ${this.lostOnSwitch > 1 ? "ont" : "a"} été effacée${this.lostOnSwitch > 1 ? "s" : ""} de ce téléphone : rien n'est mélangé avec cette famille.`);
      this.lostOnSwitch = 0;
    }
    this.openEvents();
    if (online) await this.refresh();
    await this.flush(); // the screen is already up (phase "ready"); this only drains the outbox
  }

  async logout(): Promise<void> {
    // First: this phone stops receiving this profile's notifications (waits at most 3 s, never blocks signing out).
    await Promise.race([this.releasePush?.().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
    try {
      await this.api.logout();
    } catch {
      /* the session cookie may stay valid on the server; we still leave the app */
    }
    // Local drafts and the outbox stay on the device, keyed to this person, and are sent after the next login.
    clearTimeout(this.retryTimer);
    this.retryPending = false;
    this.closeEvents();
    this.set({ phase: "loggedOut", me: null, catalog: null, list: undefined, toggles: {}, batches: [], draftListId: null, orphan: null, notices: [] });
  }

  // ---- live updates (SSE) ----------------------------------------------------------------------
  // Events only say "something changed": the client refetches the state, so a missed event can never
  // leave it wrong (the server also sends "ready" on every (re)connection, which triggers a refetch).

  private openEvents(): void {
    if (this.es || !this.makeEventSource || this.s.phase !== "ready") return;
    const es = this.makeEventSource("/api/events");
    this.es = es;
    es.addEventListener("ready", () => {
      this.set({ live: true });
      this.scheduleRefresh();
    });
    for (const t of ["list.updated", "list.created", "list.closed", "catalog.updated"]) es.addEventListener(t, () => this.scheduleRefresh());
    es.addEventListener("list.deleted", (e) => {
      try {
        const listId = String(JSON.parse(e.data as string).listId);
        this.set({ deleted: { listId, n: (this.s.deleted?.n ?? 0) + 1 } });
      } catch {
        /* malformed event: the history is read again on the next visit */
      }
      this.scheduleRefresh();
    });
    // Another phone of THIS profile changed the display preferences: read them again (other profiles' changes are ignored).
    es.addEventListener("prefs.updated", (e) => {
      try {
        if (JSON.parse(e.data as string).profileId === this.s.me?.id) this.scheduleRefresh();
      } catch {
        /* malformed event: the next poll will catch up */
      }
    });
    es.onerror = () => {
      this.set({ live: false });
      if (es.readyState === 2 && this.es === es) {
        // Closed for good (e.g. the server refused: session revoked). Find out why via a normal request.
        this.es = null;
        void this.refresh();
      }
    };
  }

  private closeEvents(): void {
    clearTimeout(this.refreshTimer);
    this.es?.close();
    this.es = null;
    this.set({ live: false });
  }

  private scheduleRefresh(): void {
    clearTimeout(this.refreshTimer); // a burst of events costs one refetch
    this.refreshTimer = setTimeout(() => void this.refresh(), 120);
  }

  // ---- local persistence ---------------------------------------------------------------------
  private async loadLocal(me: Me): Promise<void> {
    const key: [string, string] = [me.familyId, me.id];
    const cache = await this.db.cache.get(key);
    const batches = await this.db.outbox.where("[familyId+profileId]").equals(key).sortBy("createdAt");
    const orphans = await this.db.orphans.where("[familyId+profileId]").equals(key).sortBy("createdAt");
    const listId = cache?.list?.id ?? null;
    let toggles: Toggles = {};
    let draftListId = listId;
    if (listId) {
      toggles = (await this.db.drafts.get([me.familyId, me.id, listId]))?.toggles ?? {};
    } else {
      // No list known: the most recent draft (if any) is kept for when a list reappears.
      const drafts = await this.db.drafts.where("[familyId+profileId+listId]").between([me.familyId, me.id, ""], [me.familyId, me.id, "￿"]).toArray();
      const d = drafts[drafts.length - 1];
      if (d) {
        toggles = d.toggles;
        draftListId = d.listId;
      }
    }
    const pref = (await this.db.meta.get(`catalogView:${me.familyId}:${me.id}`))?.value;
    const v3 = (await this.db.meta.get(`v3Mode:${me.familyId}:${me.id}`))?.value;
    this.set({
      catalogView: pref === "categories" ? "categories" : "all",
      v3Mode: v3 === "list" || v3 === "cards" ? v3 : "squares",
      catalog: cache?.catalog ?? null,
      list: cache ? cache.list : undefined,
      batches: batches.map(({ familyId: _f, profileId: _p, ...b }) => b),
      toggles: normalizeToggles(cache?.list, batches, toggles),
      draftListId,
      orphan: orphans[orphans.length - 1] ?? null,
    });
  }

  private async persistDraft(): Promise<void> {
    const { me, draftListId, toggles } = this.s;
    if (!me || !draftListId) return;
    if (Object.keys(toggles).length === 0) await this.db.drafts.delete([me.familyId, me.id, draftListId]);
    else await this.db.drafts.put({ familyId: me.familyId, profileId: me.id, listId: draftListId, toggles });
  }

  private async persistOutbox(): Promise<void> {
    const { me, batches } = this.s;
    if (!me) return;
    await this.db.transaction("rw", this.db.outbox, async () => {
      await this.db.outbox.where("[familyId+profileId]").equals([me.familyId, me.id]).delete();
      await this.db.outbox.bulkPut(batches.map((b) => ({ ...b, familyId: me.familyId, profileId: me.id })));
    });
  }

  private async persistCache(): Promise<void> {
    const { me, catalog, list } = this.s;
    if (!me) return;
    await this.db.cache.put({ familyId: me.familyId, profileId: me.id, me, catalog, list, savedAt: Date.now() });
  }

  // ---- server state --------------------------------------------------------------------------
  /** One read at a time: triggers that arrive meanwhile (poll tick, SSE event, back to foreground) share one follow-up read. */
  private refreshing: Promise<void> | null = null;
  private refreshAgain = false;

  refresh(): Promise<void> {
    if (this.refreshing) {
      this.refreshAgain = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      do {
        this.refreshAgain = false;
        await this.refreshOnce();
      } while (this.refreshAgain);
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async refreshOnce(): Promise<void> {
    if (!this.s.me) return;
    try {
      // The list is small (a few hundred bytes to a few KB) and comes with the catalogue revision: the catalogue (≈ 15 KB)
      // is downloaded only when it is unknown or its revision changed (article added, edited, deactivated, new picture).
      const { list, catalogRev, prefsRev } = await this.api.activeList();
      const known = this.s.catalog;
      const catalog = known && catalogRev !== undefined && known.rev === catalogRev ? known : await this.api.catalog();
      this.set({ conn: "online" });
      await this.applyServerState(catalog, list);
      await this.syncPrefs(prefsRev);
    } catch (e) {
      if (e instanceof NetworkError) this.set({ conn: "offline" });
      else if (e instanceof ApiError && e.status === 401) this.set({ phase: "loggedOut" });
    }
  }

  /**
   * Safety-net poll for when no live stream is delivering (a proxy holds it back). It is a *frequency*, not a delivery
   * guarantee: it does nothing while the app is in the background, while the stream is live, while a read is already
   * running, and while offline (then only the existing back-off retry runs: 3 s, 8 s, 20 s, then every 45 s).
   * Returns true when it started a read.
   */
  async pollTick(visible: boolean): Promise<boolean> {
    if (!visible || this.s.phase !== "ready" || this.s.live || this.refreshing) return false;
    if (this.s.conn === "offline") {
      if (!this.retryPending) this.scheduleRetry();
      return false;
    }
    await this.refresh();
    return true;
  }

  // ---- display preferences (prices): per profile, synchronised on all of its phones ----------------------
  private pendingPrefs: { showPrices: boolean; showTotals: boolean } | null = null;

  /** A preference changed on another phone (revision differs): read the profile again. A change not sent yet always wins locally. */
  private async syncPrefs(serverRev: number | undefined): Promise<void> {
    const me = this.s.me;
    if (!me) return;
    if (this.pendingPrefs) {
      await this.pushPrefs();
      return;
    }
    if (serverRev === undefined || serverRev === (me.prefs?.rev ?? 0)) return;
    const fresh = (await this.api.me()).me;
    if (fresh.prefs) await this.setMe({ ...me, prefs: fresh.prefs });
  }

  private async setMe(me: Me): Promise<void> {
    this.set({ me });
    await this.db.meta.put({ key: "lastMe", value: me });
  }

  private async pushPrefs(): Promise<void> {
    const want = this.pendingPrefs;
    const me = this.s.me;
    if (!want || !me) return;
    try {
      const { prefs } = await this.api.setPrefs(want);
      this.pendingPrefs = null;
      await this.setMe({ ...me, prefs });
    } catch (e) {
      if (!(e instanceof NetworkError)) this.pendingPrefs = null; // refused: the server value will be read again
    }
  }

  /** Show prices / show amounts and total. The choice applies at once on this phone (even offline) and follows the profile to its other phones. */
  async setPrefs(showPrices: boolean, showTotals: boolean): Promise<void> {
    const me = this.s.me;
    if (!me) return;
    const totals = showTotals;
    const prices = showPrices || totals; // amounts imply prices
    await this.setMe({ ...me, prefs: { showPrices: prices, showTotals: totals, rev: me.prefs?.rev ?? 0 } });
    this.pendingPrefs = { showPrices: prices, showTotals: totals };
    await this.pushPrefs();
  }

  /** Ville du profil (prix de la ville). Demande le réseau : rien n'est affiché comme enregistré avant la réponse du serveur. */
  async setCity(city: string): Promise<void> {
    const me = this.s.me;
    if (!me) return;
    const r = await this.api.setCity(city);
    await this.setMe({ ...this.s.me!, city: r.city });
  }

  private async applyServerState(catalog: Catalog, list: ListView | null): Promise<void> {
    let { toggles, draftListId } = this.s;
    const hadNoList = draftListId === NO_LIST;
    if (list && draftListId && draftListId !== NO_LIST && draftListId !== list.id) {
      // A new list replaced the one these choices were made for: never apply them silently.
      const adds = Object.entries(toggles).filter(([, t]) => t.want).map(([p]) => p);
      await this.stashOrphan(draftListId, adds);
      toggles = {};
    }
    if (list) draftListId = list.id;
    this.set({ catalog, list, toggles: normalizeToggles(list, this.s.batches, toggles), draftListId });
    // Le brouillon fait sans liste suit la liste qui vient d'apparaître (créée par quelqu'un d'autre ou par notre propre lot).
    if (hadNoList && list && this.s.me) await this.db.drafts.delete([this.s.me.familyId, this.s.me.id, NO_LIST]);
    await Promise.all([this.persistCache(), this.persistDraft()]);
    this.preloadFn(catalog.categories.flatMap((c) => c.products.map((p) => p.photoUrl).filter((u): u is string => !!u && !this.preloaded.has(u))));
    for (const c of catalog.categories) for (const p of c.products) if (p.photoUrl) this.preloaded.add(p.photoUrl);
  }

  private async stashOrphan(fromListId: string, productIds: string[]): Promise<void> {
    const me = this.s.me;
    if (!me || productIds.length === 0) return;
    const prev = this.s.orphan;
    const ids = [...new Set([...(prev?.productIds ?? []), ...productIds])];
    const orphan: OrphanRow = { id: prev?.id ?? this.newId(), familyId: me.familyId, profileId: me.id, fromListId, productIds: ids, createdAt: Date.now() };
    await this.db.orphans.put(orphan);
    this.set({ orphan });
  }

  /** Explicit, one-tap resume of the choices made for a closed list, into the current list. */
  async resumeOrphan(): Promise<void> {
    const { orphan, list, catalog } = this.s;
    if (!orphan || !this.selectable()) return;
    const active = new Set(catalog?.categories.flatMap((c) => c.products.map((p) => p.id)));
    let toggles = this.s.toggles;
    for (const productId of orphan.productIds) {
      if (!active.has(productId)) continue; // product no longer offered
      toggles = toggleProduct(list, this.s.batches, toggles, productId);
      if (toggles[productId]?.want === false) toggles = toggleProduct(list, this.s.batches, toggles, productId); // never un-select by accident
    }
    await this.db.orphans.delete(orphan.id);
    this.set({ toggles, orphan: null, draftListId: this.s.draftListId ?? list?.id ?? NO_LIST });
    await this.persistDraft();
  }

  async dismissOrphan(): Promise<void> {
    const o = this.s.orphan;
    if (!o) return;
    await this.db.orphans.delete(o.id);
    this.set({ orphan: null });
  }

  // ---- draft actions -------------------------------------------------------------------------
  /** Peut-on choisir des articles ? Une liste en cours, ou aucune liste (le brouillon attend : la validation crée la liste). */
  private selectable(): boolean {
    const l = this.s.list;
    return l === null || (l !== undefined && l.status === "active");
  }

  async toggle(productId: string): Promise<void> {
    const { list, batches, toggles } = this.s;
    if (!this.selectable()) return;
    if (isPurchased(list, productId, batches) && !toggles[productId]?.again) return this.notice("Déjà acheté : utilisez « Nouvelle demande » pour en demander encore.");
    const wasPresent = projectedPresence(list, batches, productId);
    const hasServerRow = !!openItem(list, productId);
    const wantNow = toggles[productId]?.want ?? wasPresent;
    if (wantNow && !hasServerRow && wasPresent && !toggles[productId]) {
      // Present only because of a queued add: un-selecting means cancelling that queued add.
      const r = cancelQueuedAdd(batches, productId, this.inFlightBatchId);
      if (!r.ok) return this.notice("Enregistrement en cours. Réessayez dans un instant.");
      this.set({ batches: r.batches, toggles: normalizeToggles(list, r.batches, toggles) });
      await this.persistOutbox();
      return;
    }
    this.set({ toggles: toggleProduct(list, batches, toggles, productId), draftListId: this.s.draftListId ?? list?.id ?? NO_LIST });
    await this.persistDraft();
  }

  /** The unit of a product: the line's own (frozen when it was requested), else the product's current one. */
  private unitFor(productId: string) {
    const line = openItem(this.s.list, productId);
    if (line) return line.unit;
    for (const c of this.s.catalog?.categories ?? []) for (const p of c.products) if (p.id === productId) return p.unit ?? "piece";
    return "piece" as const;
  }

  /** Sets the wanted quantity of a selected product. Never adds a second line; never touches other articles. */
  async setQuantity(productId: string, wanted: number, exact = false): Promise<void> {
    const { list, batches, toggles } = this.s;
    if (!this.selectable()) return;
    const qty = exact ? clampQtyFine(wanted, this.unitFor(productId)) : clampQty(wanted, this.unitFor(productId));
    const present = projectedPresence(list, batches, productId);
    if (!(toggles[productId]?.want ?? present)) return; // the counter only exists on a selected card
    if (present && !openItem(list, productId) && !toggles[productId]) {
      // In the list only through a queued (offline) add: the quantity goes into that very add, so a sync can never add it twice.
      const r = editQueuedAdd(batches, productId, qty, this.inFlightBatchId);
      if (!r.ok) return this.notice("Enregistrement en cours. Réessayez dans un instant.");
      this.set({ batches: r.batches });
      await this.persistOutbox();
      return;
    }
    this.set({ toggles: setQuantityToggle(list, batches, toggles, productId, qty), draftListId: this.s.draftListId ?? list?.id ?? NO_LIST });
    await this.persistDraft();
  }

  /** Explicit "new request" for a product that was already bought in this list. */
  async requestAgain(productId: string): Promise<void> {
    const { list, batches, toggles } = this.s;
    if (!list || list.status !== "active") return; // « nouvelle demande » suppose un article déjà acheté dans une liste
    if (!isPurchased(list, productId, batches)) return;
    this.set({ toggles: requestAgainToggle(list, batches, toggles, productId), draftListId: this.s.draftListId ?? list.id });
    await this.persistDraft();
  }

  async setCatalogView(view: CatalogView): Promise<void> {
    const me = this.s.me;
    this.set({ catalogView: view });
    if (me) await this.db.meta.put({ key: `catalogView:${me.familyId}:${me.id}`, value: view });
  }

  /** V3 : change d'affichage tout de suite ; le choix est gardé pour ce profil sur cet appareil (aucune donnée de la famille n'est touchée). */
  async setV3Mode(mode: V3Mode): Promise<void> {
    const me = this.s.me;
    this.set({ v3Mode: mode });
    if (me) await this.db.meta.put({ key: `v3Mode:${me.familyId}:${me.id}`, value: mode });
  }

  /** "Valider": move the pending choices into the outbox (persisted first), then try to send. */
  /**
   * Résultat réel de la validation : « sent » (le serveur a enregistré), « queued » (gardée sur ce téléphone, envoyée au retour du réseau),
   * « failed » (refusée par le serveur : rien n'est enregistré), « nothing » (aucun changement à envoyer).
   */
  async validate(): Promise<"sent" | "queued" | "failed" | "nothing"> {
    const { list, toggles } = this.s;
    // Not refused while a sync is in flight: the new batch is queued and the running loop sends it right after
    // (a second tap is harmless: the first one already emptied the pending choices).
    if (!this.selectable()) return "nothing";
    const ops = buildOps(list, this.s.batches, toggles, this.newId);
    if (ops.length === 0) {
      this.set({ toggles: {} });
      await this.persistDraft();
      return "nothing";
    }
    // The validation keeps the moment the person pressed the button, even if the phone is offline and it is sent hours later.
    const batch: Batch = { id: this.newId(), listId: list?.id ?? NO_LIST, ops, createdAt: Date.now(), validatedAt: new Date().toISOString() };
    this.set({ batches: [...this.s.batches, batch], toggles: {} });
    await Promise.all([this.persistOutbox(), this.persistDraft()]); // on disk before any network call
    await this.flush();
    if (this.dropped.delete(batch.id)) return "failed";
    return this.s.batches.some((b) => b.id === batch.id) ? "queued" : "sent";
  }

  // ---- sending -------------------------------------------------------------------------------
  async flush(): Promise<void> {
    if (this.s.sending || !this.s.me) return;
    let refreshNeeded = false;
    while (this.s.batches.length > 0 && this.s.me) {
      const batch = this.s.batches[0]!;
      this.inFlightBatchId = batch.id;
      this.set({ sending: true });
      let res: Awaited<ReturnType<typeof this.api.postOps>>;
      try {
        res = await this.api.postOps(batch.listId === NO_LIST ? "active" : batch.listId, batch.ops, { id: batch.id, at: batch.validatedAt }); // « active » : le serveur crée la liste du jour si besoin
      } catch (e) {
        this.inFlightBatchId = undefined;
        this.set({ sending: false });
        if (e instanceof NetworkError) {
          this.set({ conn: "offline" }); // nothing is claimed as saved
          this.scheduleRetry();
          return;
        }
        if (e instanceof ApiError && e.status === 401) return void this.set({ phase: "loggedOut" });
        if (e instanceof ApiError && e.status >= 500) return this.scheduleRetry();
        // La liste visée n'existe plus (clôturée puis supprimée) : rien n'est ajouté à une archive ni recréé ; les articles redeviennent une
        // proposition « Reprendre » (jamais perdus en silence).
        if (e instanceof ApiError && e.status === 404 && batch.listId !== NO_LIST) {
          const adds = [...new Set(batch.ops.filter((o) => o.type === "add" || o.type === "request_again").map((o) => (o as { productId: string }).productId))];
          const rest = this.s.batches.filter((b) => b.id !== batch.id);
          this.dropped.add(batch.id);
          this.set({ batches: rest, toggles: normalizeToggles(this.s.list, rest, this.s.toggles), sending: false });
          await this.stashOrphan(batch.listId, adds);
          this.notice("Cette liste n'existe plus : vos articles vous sont proposés à nouveau, rien n'a été ajouté à une liste archivée.");
          await this.persistOutbox();
          continue;
        }
        // 400/403/404: the server will never accept this batch — drop it rather than retry forever.
        this.dropped.add(batch.id);
        this.set({ batches: this.s.batches.filter((b) => b.id !== batch.id), toggles: normalizeToggles(this.s.list, this.s.batches.filter((b) => b.id !== batch.id), this.s.toggles) });
        this.notice("Un envoi n'a pas pu être enregistré. Vérifiez la liste.");
        await this.persistOutbox();
        continue;
      }
      this.inFlightBatchId = undefined;
      this.retryStep = 0;
      const remaining = this.s.batches.filter((b) => b.id !== batch.id);
      const names = new Map<string, string>();
      for (const c of this.s.catalog?.categories ?? []) for (const p of c.products) names.set(p.id, p.name);
      for (const i of this.s.list?.items ?? []) names.set(i.productId, i.name);
      const { notices, orphanAdds } = interpretResults(batch, res.results, (id) => names.get(id) ?? "Produit");
      const currentListId = this.s.list?.id;
      const stillCurrent = res.list.status === "active" && (res.list.id === currentListId || (currentListId === undefined && this.s.list === null));
      const list = stillCurrent ? res.list : this.s.list;
      if (!stillCurrent) refreshNeeded = true;
      const wasNoList = this.s.draftListId === NO_LIST;
      this.set({ batches: remaining, list, sending: false, conn: "online", justSynced: true, toggles: normalizeToggles(list, remaining, this.s.toggles), draftListId: wasNoList && list ? list.id : this.s.draftListId });
      if (wasNoList && list && this.s.me) await this.db.drafts.delete([this.s.me.familyId, this.s.me.id, NO_LIST]); // le brouillon suit la liste créée
      for (const t of notices) this.notice(t);
      if (orphanAdds.length) await this.stashOrphan(batch.listId, orphanAdds);
      await Promise.all([this.persistOutbox(), this.persistCache(), this.persistDraft()]);
      clearTimeout(this.syncedTimer);
      this.syncedTimer = setTimeout(() => this.set({ justSynced: false }), 3_000);
    }
    if (refreshNeeded) await this.refresh();
  }

  // ---- direct actions (parents) ----------------------------------------------------------------
  // Purchases and corrections are never queued: the other parents must be able to trust "bought" at once,
  // so they need the server to answer. Without a connection they are refused, visibly.

  private async direct(op: Op, okText?: (r: OpResult) => string | null): Promise<OpResult | null> {
    const list = this.s.list;
    if (!list || list.status !== "active") return null;
    try {
      const res = await this.api.postOps(list.id, [op]);
      const r = res.results[0]!;
      this.set({ conn: "online", list: res.list.id === list.id && res.list.status === "active" ? res.list : this.s.list });
      this.set({ toggles: normalizeToggles(this.s.list, this.s.batches, this.s.toggles) });
      await Promise.all([this.persistCache(), this.persistDraft()]);
      if (r.status === "rejected") {
        const msg: Record<string, string> = {
          list_closed: "Cette liste vient d'être clôturée.",
          item_removed: "Cet article vient d'être retiré de la liste.",
          item_unknown: "Cet article n'est plus dans la liste.",
          purchase_unknown: "Cet achat est introuvable.",
        };
        // A new request in another unit exists: adding kilos to pieces would be meaningless, so nothing is merged or changed.
        const clash = r.reason === "duplicate_open" && r.detail?.quantity !== undefined && r.detail.unit ? `Correction impossible pour l'instant : une nouvelle demande de ce produit existe déjà dans une autre unité (${fmtQty(r.detail.quantity, r.detail.unit)}). Retirez-la ou achetez-la d'abord ; l'achat reste inchangé.` : null;
        this.notice(clash ?? msg[r.reason ?? ""] ?? "Cette action n'a pas pu être enregistrée.");
        if (r.reason === "list_closed") void this.refresh();
      } else if (okText) {
        const t = okText(r);
        if (t) this.notice(t);
      }
      return r;
    } catch (e) {
      if (e instanceof NetworkError) {
        this.set({ conn: "offline" });
        this.notice("Pas de connexion : cette action n'a pas été enregistrée. Réessayez quand le réseau est revenu.");
        this.scheduleRetry();
      } else if (e instanceof ApiError && e.status === 401) this.set({ phase: "loggedOut" });
      else this.notice("Cette action n'a pas pu être enregistrée. Réessayez.");
      return null;
    }
  }

  purchase(itemId: string) {
    return this.direct({ opId: this.newId(), type: "purchase", itemId }, (r) =>
      r.status === "already" ? `Déjà acheté${r.detail?.purchasedBy ? ` par ${r.detail.purchasedBy.displayName}` : ""}.` : null,
    );
  }

  correct(purchaseId: string, reason: string) {
    return this.direct({ opId: this.newId(), type: "correct", purchaseId, reason: reason.trim() || null }, (r) => (r.status === "already" ? "Cet achat était déjà corrigé." : null));
  }

  async createList(): Promise<void> {
    try {
      const { list } = await this.api.createList();
      this.set({ list, conn: "online" });
      await this.applyServerState(this.s.catalog ?? (await this.api.catalog()), list);
    } catch (e) {
      if (e instanceof NetworkError) this.set({ conn: "offline" }), this.notice("Pas de connexion : la liste n'a pas été créée.");
      else if (e instanceof ApiError && e.status === 409) await this.refresh(); // someone just created it
      else this.notice("Impossible de créer la liste.");
    }
  }

  /**
   * Favourite or past order → pending choices in the list being edited (nothing is sent before « Valider »; the favourite or the old
   * order is never changed). Without a current list, one is created first. Returns what was done, or null if nothing could be prepared.
   */
  async applyBasket(items: BasketItem[], mode: BasketMode, title: string): Promise<BasketReport | null> {
    if (!this.s.list) await this.createList();
    const { list, catalog, batches, toggles } = this.s;
    if (!list || list.status !== "active") return null;
    if (mode === "replace" && (batches.length > 0 || this.s.sending)) {
      this.notice("Un envoi est en cours : réessayez dans un instant.");
      return null;
    }
    const byId = new Map<string, { active: boolean; unit: import("../types").Unit }>();
    for (const c of catalog?.categories ?? []) for (const p of c.products) byId.set(p.id, { active: p.active, unit: p.unit });
    const { toggles: next, report } = planBasket({ list, batches, toggles, items, mode, product: (id) => byId.get(id) });
    this.set({ toggles: next, draftListId: this.s.draftListId ?? list.id });
    await this.persistDraft();
    const parts = [
      report.added.length ? `${report.added.length} ajouté${report.added.length > 1 ? "s" : ""}` : "",
      report.summed.length ? `${report.summed.length} quantité${report.summed.length > 1 ? "s" : ""} additionnée${report.summed.length > 1 ? "s" : ""}` : "",
      report.set.length ? `${report.set.length} quantité${report.set.length > 1 ? "s" : ""} remplacée${report.set.length > 1 ? "s" : ""}` : "",
      report.removed.length ? `${report.removed.length} retiré${report.removed.length > 1 ? "s" : ""}` : "",
    ].filter(Boolean);
    this.notice(`« ${title} » préparé : ${parts.length ? parts.join(", ") : "rien à changer"}. Modifiez si besoin puis validez.`);
    const skipped: string[] = [];
    if (report.inactive.length) skipped.push(`produits masqués (non réaffichés) : ${report.inactive.join(", ")}`);
    if (report.unitMismatch.length) skipped.push(`unité différente (non modifiés) : ${report.unitMismatch.join(", ")}`);
    if (report.purchased.length) skipped.push(`déjà achetés dans cette liste : ${report.purchased.join(", ")}`);
    if (skipped.length) this.notice(`Non repris — ${skipped.join(" ; ")}.`);
    return report;
  }

  /** Returns what the server reports (remaining / purchased) or null if it did not happen. */
  async closeList(): Promise<{ remaining: number; purchased: number } | null> {
    const list = this.s.list;
    if (!list || list.status !== "active") return null;
    try {
      const r = await this.api.closeList(list.id);
      this.set({ conn: "online" });
      await this.refresh();
      return r;
    } catch (e) {
      if (e instanceof NetworkError) this.set({ conn: "offline" }), this.notice("Pas de connexion : la liste n'a pas été clôturée.");
      else this.notice("Impossible de clôturer la liste.");
      return null;
    }
  }

  private scheduleRetry(): void {
    clearTimeout(this.retryTimer);
    const delay = RETRY_MS[Math.min(this.retryStep++, RETRY_MS.length - 1)]!;
    this.retryPending = true;
    this.retryTimer = setTimeout(() => { this.retryPending = false; void this.retryNow(); }, delay);
  }

  /** Called by the browser hooks: connection back, app in the foreground, retry timer… */
  async retryNow(): Promise<void> {
    if (this.s.phase !== "ready") return;
    clearTimeout(this.retryTimer);
    this.retryPending = false;
    this.openEvents();
    await this.refresh();
    if (this.s.conn === "online") await this.flush();
    else this.scheduleRetry();
  }
}

export function createEngine(deps: Partial<EngineDeps> = {}): Engine {
  return new Engine({ db: deps.db ?? new AppDbClass(), ...deps });
}
