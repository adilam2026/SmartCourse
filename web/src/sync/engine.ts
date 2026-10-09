import { api as realApi, ApiError, NetworkError } from "../api";
import { AppDbClass, type AppDb, type OrphanRow } from "../db";
import type { Batch, Catalog, ListView, Me, Op, OpResult, Toggles } from "../types";
import { buildOps, cancelQueuedAdd, interpretResults, isPurchased, normalizeToggles, projectedPresence, toggleProduct } from "./logic";

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
  loginError: string | null;
  loggingIn: boolean;
  lastLogin: { familyCode: string; login: string } | null;
  /** True while the live (SSE) channel is connected. */
  live: boolean;
  /** Family code to show once right after the first installation. */
  welcomeCode: string | null;
}

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
  eventSource?: (url: string) => EventSourceLike;
  api?: typeof realApi;
  db: AppDb;
  newId?: () => string;
  preload?: (urls: string[]) => void;
}

const RETRY_MS = [3_000, 8_000, 20_000, 45_000];

export class Engine {
  private s: State = {
    phase: "boot", me: null, conn: "online", catalog: null, list: undefined, toggles: {}, draftListId: null, batches: [],
    sending: false, justSynced: false, notices: [], orphan: null, loginError: null, loggingIn: false, lastLogin: null, live: false, welcomeCode: null,
  };
  private listeners = new Set<() => void>();
  private api: typeof realApi;
  private db: AppDb;
  private newId: () => string;
  private preloadFn: (urls: string[]) => void;
  private noticeSeq = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryStep = 0;
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
  }

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
    this.set({ lastLogin: last ?? null });
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
  async setup(input: { installToken: string; familyName: string; displayName: string; login: string; secret: string }): Promise<string | null> {
    this.set({ loggingIn: true, loginError: null });
    try {
      const r = await this.api.setupFamily({
        installToken: input.installToken.trim(),
        familyName: input.familyName,
        admin: { displayName: input.displayName, login: input.login.trim().toLowerCase(), secret: input.secret },
      });
      const lastLogin = { familyCode: r.familyCode, login: input.login.trim().toLowerCase() };
      await this.db.meta.put({ key: "lastLogin", value: lastLogin });
      this.set({ lastLogin, welcomeCode: r.familyCode });
      const { me } = await this.api.me();
      await this.enter(me);
      return r.familyCode;
    } catch (e) {
      this.set({
        loginError:
          e instanceof NetworkError ? "Pas de connexion. Réessayez."
          : e instanceof ApiError && e.status === 403 ? "Jeton d'installation invalide ou déjà utilisé."
          : e instanceof ApiError && e.code === "weak_secret" ? "Code trop simple (évitez 123456, 111111…)."
          : e instanceof ApiError && e.status === 400 ? "Vérifiez les champs (identifiant : lettres minuscules, chiffres, . _ -)."
          : "Installation impossible.",
      });
      return null;
    } finally {
      this.set({ loggingIn: false });
    }
  }

  private async enter(me: Me, online = true): Promise<void> {
    await this.db.meta.put({ key: "lastMe", value: me });
    this.set({ me, phase: "ready" });
    await this.loadLocal(me);
    this.openEvents();
    if (online) await this.refresh();
    await this.flush(); // the screen is already up (phase "ready"); this only drains the outbox
  }

  async logout(): Promise<void> {
    try {
      await this.api.logout();
    } catch {
      /* the session cookie may stay valid on the server; we still leave the app */
    }
    // Local drafts and the outbox stay on the device, keyed to this person, and are sent after the next login.
    clearTimeout(this.retryTimer);
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
    for (const t of ["list.updated", "list.created", "list.closed"]) es.addEventListener(t, () => this.scheduleRefresh());
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
    this.set({
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
  async refresh(): Promise<void> {
    if (!this.s.me) return;
    try {
      const [catalog, { list }] = await Promise.all([this.api.catalog(), this.api.activeList()]);
      this.set({ conn: "online" });
      await this.applyServerState(catalog, list);
    } catch (e) {
      if (e instanceof NetworkError) this.set({ conn: "offline" });
      else if (e instanceof ApiError && e.status === 401) this.set({ phase: "loggedOut" });
    }
  }

  private async applyServerState(catalog: Catalog, list: ListView | null): Promise<void> {
    let { toggles, draftListId } = this.s;
    if (list && draftListId && draftListId !== list.id) {
      // A new list replaced the one these choices were made for: never apply them silently.
      const adds = Object.entries(toggles).filter(([, t]) => t.want).map(([p]) => p);
      await this.stashOrphan(draftListId, adds);
      toggles = {};
    }
    if (list) draftListId = list.id;
    this.set({ catalog, list, toggles: normalizeToggles(list, this.s.batches, toggles), draftListId });
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
    if (!orphan || !list || list.status !== "active") return;
    const active = new Set(catalog?.categories.flatMap((c) => c.products.map((p) => p.id)));
    let toggles = this.s.toggles;
    for (const productId of orphan.productIds) {
      if (!active.has(productId)) continue; // product no longer offered
      toggles = toggleProduct(list, this.s.batches, toggles, productId);
      if (toggles[productId]?.want === false) toggles = toggleProduct(list, this.s.batches, toggles, productId); // never un-select by accident
    }
    await this.db.orphans.delete(orphan.id);
    this.set({ toggles, orphan: null });
    await this.persistDraft();
  }

  async dismissOrphan(): Promise<void> {
    const o = this.s.orphan;
    if (!o) return;
    await this.db.orphans.delete(o.id);
    this.set({ orphan: null });
  }

  // ---- draft actions -------------------------------------------------------------------------
  async toggle(productId: string): Promise<void> {
    const { list, batches, toggles } = this.s;
    if (!list || list.status !== "active") return;
    if (isPurchased(list, productId)) return this.notice("Déjà acheté : ce produit ne peut plus être retiré.");
    const wasPresent = projectedPresence(list, batches, productId);
    const hasServerRow = list.items.some((i) => i.productId === productId);
    const wantNow = toggles[productId]?.want ?? wasPresent;
    if (wantNow && !hasServerRow && wasPresent && !toggles[productId]) {
      // Present only because of a queued add: un-selecting means cancelling that queued add.
      const r = cancelQueuedAdd(batches, productId, this.inFlightBatchId);
      if (!r.ok) return this.notice("Enregistrement en cours. Réessayez dans un instant.");
      this.set({ batches: r.batches, toggles: normalizeToggles(list, r.batches, toggles) });
      await this.persistOutbox();
      return;
    }
    this.set({ toggles: toggleProduct(list, batches, toggles, productId), draftListId: this.s.draftListId ?? list.id });
    await this.persistDraft();
  }

  /** "Valider": move the pending choices into the outbox (persisted first), then try to send. */
  async validate(): Promise<void> {
    const { list, toggles } = this.s;
    if (!list || list.status !== "active" || this.s.sending) return;
    const ops = buildOps(list, toggles, this.newId);
    if (ops.length === 0) {
      this.set({ toggles: {} });
      return this.persistDraft();
    }
    const batch: Batch = { id: this.newId(), listId: list.id, ops, createdAt: Date.now() };
    this.set({ batches: [...this.s.batches, batch], toggles: {} });
    await Promise.all([this.persistOutbox(), this.persistDraft()]); // on disk before any network call
    await this.flush();
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
        res = await this.api.postOps(batch.listId, batch.ops);
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
        // 400/403/404: the server will never accept this batch — drop it rather than retry forever.
        this.set({ batches: this.s.batches.filter((b) => b.id !== batch.id), toggles: normalizeToggles(this.s.list, this.s.batches.filter((b) => b.id !== batch.id), this.s.toggles) });
        this.notice("Un envoi a été refusé par le serveur.");
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
      const stillCurrent = res.list.status === "active" && res.list.id === currentListId;
      const list = stillCurrent ? res.list : this.s.list;
      if (!stillCurrent) refreshNeeded = true;
      this.set({ batches: remaining, list, sending: false, conn: "online", justSynced: true, toggles: normalizeToggles(list, remaining, this.s.toggles) });
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
        this.notice(msg[r.reason ?? ""] ?? "Action refusée.");
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
      else this.notice("Action refusée par le serveur.");
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
    this.retryTimer = setTimeout(() => void this.retryNow(), delay);
  }

  /** Called by the browser hooks: connection back, app in the foreground, retry timer… */
  async retryNow(): Promise<void> {
    if (this.s.phase !== "ready") return;
    clearTimeout(this.retryTimer);
    this.openEvents();
    await this.refresh();
    if (this.s.conn === "online") await this.flush();
    else this.scheduleRetry();
  }
}

export function createEngine(deps: Partial<EngineDeps> = {}): Engine {
  return new Engine({ db: deps.db ?? new AppDbClass(), ...deps });
}
