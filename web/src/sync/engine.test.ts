import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiError, NetworkError } from "../api";
import { AppDbClass } from "../db";
import type { Catalog, ListItem, ListView, Me, Op, OpResult } from "../types";
import { Engine, type EventSourceLike } from "./engine";

const me = (id = "p1", familyId = "f1"): Me => ({ id, familyId, displayName: "Marie", login: "marie", role: "staff" });
const product = (id: string, category = "c") => ({ id, category, name: id.toUpperCase(), brand: null, active: true, photoUrl: null });
const catalog: Catalog = { categories: [{ key: "c", label: "C", products: ["lait", "riz", "sucre"].map((p) => product(p)) }] };
const item = (productId: string, status: "to_buy" | "purchased" = "to_buy", rev = 1): ListItem => ({
  id: `i-${productId}`, productId, category: "c", name: productId.toUpperCase(), brand: null, photoUrl: null, productActive: true, status, rev,
});

/** A tiny in-memory server honouring the real semantics we rely on (idempotent op ids, closed lists). */
class FakeServer {
  listId: string | null = "L1";
  items: ListItem[] = [];
  seen = new Map<string, OpResult>();
  down = false;
  calls: { listId: string; ops: Op[] }[] = [];
  meOk = true;
  cat: Catalog = catalog;
  catalogRev: number | undefined; // undefined = ancien serveur, sans révision
  catalogCalls = 0;

  view(): ListView | null {
    return this.listId ? { id: this.listId, status: "active", createdAt: "", closedAt: null, items: this.items.map((i) => ({ ...i })) } : null;
  }
  api = {
    me: async () => { this.check(); if (!this.meOk) throw new ApiError(401, "unauthenticated", "x"); return { me: me() }; },
    login: async () => { this.check(); return { me: me() }; },
    logout: async () => ({ ok: true as const }),
    catalog: async () => { this.check(); this.catalogCalls++; return this.catalogRev === undefined ? this.cat : { ...this.cat, rev: this.catalogRev }; },
    activeList: async () => { this.check(); return { list: this.view(), catalogRev: this.catalogRev }; },
    postOps: async (listId: string, ops: Op[]) => {
      this.check();
      this.calls.push({ listId, ops });
      const results: OpResult[] = ops.map((op) => {
        const prev = this.seen.get(op.opId);
        if (prev) return { ...prev, replay: true };
        let r: OpResult;
        if (listId !== this.listId) r = { opId: op.opId, status: "rejected", reason: "list_closed" };
        else if (op.type === "add") {
          const ex = this.items.find((i) => i.productId === op.productId);
          if (ex) r = { opId: op.opId, status: "already" };
          else { this.items.push(item(op.productId)); r = { opId: op.opId, status: "applied" }; }
        } else if (op.type === "remove") {
          const ex = this.items.find((i) => i.productId === op.productId);
          if (!ex) r = { opId: op.opId, status: "rejected", reason: "item_unknown" };
          else if (ex.status === "purchased") r = { opId: op.opId, status: "rejected", reason: "locked_purchased" };
          else if (ex.rev !== op.baseRev) r = { opId: op.opId, status: "rejected", reason: "stale" };
          else { this.items = this.items.filter((i) => i !== ex); r = { opId: op.opId, status: "applied" }; }
        } else r = { opId: op.opId, status: "rejected", reason: "item_unknown" };
        this.seen.set(op.opId, r);
        return r;
      });
      return { results, list: this.view() ?? ({ id: listId, status: "archived", createdAt: "", closedAt: "", items: [] } as ListView) };
    },
  } as any;
  private check() { if (this.down) throw new NetworkError(); }
}

let ids = 0;
const newId = () => `id-${++ids}`;
let db: AppDbClass;
let srv: FakeServer;
const mk = () => new Engine({ db, api: srv.api, newId });
const boot = async (e = mk()) => { await e.start(); return e; };

beforeEach(async () => {
  db = new AppDbClass(`t-${Math.random()}`);
  srv = new FakeServer();
  ids = 0;
});

describe("moteur de synchronisation", () => {
  it("critère 1 : le catalogue de la liste active est là dès l'ouverture", async () => {
    const e = await boot();
    expect(e.getState().phase).toBe("ready");
    expect(e.getState().catalog?.categories[0]?.products).toHaveLength(3);
    expect(e.getState().list?.id).toBe("L1");
  });

  it("critère 2 : cocher puis décocher laisse « Valider » grisé (aucun changement)", async () => {
    const e = await boot();
    await e.toggle("lait");
    expect(Object.keys(e.getState().toggles)).toEqual(["lait"]);
    await e.toggle("lait");
    expect(e.getState().toggles).toEqual({});
  });

  it("critère 3 : fermer puis rouvrir l'application conserve les choix non validés", async () => {
    const e1 = await boot();
    await e1.toggle("lait");
    await e1.toggle("riz");
    srv.down = true; // réouverture sans réseau
    const e2 = await boot();
    expect(Object.keys(e2.getState().toggles).sort()).toEqual(["lait", "riz"]);
    expect(e2.getState().conn).toBe("offline");
    expect(e2.getState().catalog).not.toBeNull(); // cache local : le catalogue est là hors connexion
  });

  it("critère 4 : valider envoie, le serveur confirme, le bouton redevient grisé", async () => {
    const e = await boot();
    await e.toggle("lait");
    const p = e.validate();
    expect(e.getState().batches).toHaveLength(1); // déjà en file (sur disque) avant la réponse
    await p;
    const s = e.getState();
    expect(s.batches).toEqual([]);
    expect(s.toggles).toEqual({});
    expect(s.justSynced).toBe(true);
    expect(srv.items.map((i) => i.productId)).toEqual(["lait"]);
    expect(s.list?.items.map((i) => i.productId)).toEqual(["lait"]);
  });

  it("un double appui sur « Valider » n'envoie qu'une fois", async () => {
    const e = await boot();
    await e.toggle("lait");
    await Promise.all([e.validate(), e.validate()]);
    expect(srv.calls).toHaveLength(1);
  });

  it("critère 10 : hors connexion, « Valider » met en attente sans annoncer de succès ; le retour du réseau envoie les mêmes opérations", async () => {
    const e = await boot();
    await e.toggle("lait");
    srv.down = true;
    await e.validate();
    let s = e.getState();
    expect(s.conn).toBe("offline");
    expect(s.justSynced).toBe(false); // jamais « enregistré » sans confirmation
    expect(s.batches).toHaveLength(1);
    expect(s.toggles).toEqual({}); // plus de brouillon : c'est un envoi en attente
    expect(srv.items).toEqual([]);

    // l'application est fermée puis rouverte, toujours sans réseau : l'envoi en attente est conservé
    const e2 = await boot();
    expect(e2.getState().batches).toHaveLength(1);
    const pendingOps = e2.getState().batches[0]!.ops;

    srv.down = false;
    await e2.retryNow();
    s = e2.getState();
    expect(s.batches).toEqual([]);
    expect(s.conn).toBe("online");
    expect(srv.items.map((i) => i.productId)).toEqual(["lait"]);
    expect(srv.calls.at(-1)!.ops).toEqual(pendingOps); // mêmes identifiants d'opération
  });

  it("une validation répétée après interruption ne crée pas de doublon", async () => {
    const e = await boot();
    await e.toggle("lait");
    await e.validate();
    // la réponse s'est perdue : on simule l'état « envoi en file » avec les mêmes op_id
    const sent = srv.calls[0]!;
    const again = await srv.api.postOps(sent.listId, sent.ops);
    expect(again.results.every((r: OpResult) => r.replay)).toBe(true);
    expect(srv.items).toHaveLength(1);
  });

  it("annuler (décocher) un produit dont l'ajout est encore en file retire cet ajout", async () => {
    const e = await boot();
    await e.toggle("lait");
    await e.toggle("riz");
    srv.down = true;
    await e.validate();
    expect(e.getState().batches[0]!.ops).toHaveLength(2);
    await e.toggle("lait");
    expect(e.getState().batches[0]!.ops.map((o: any) => o.productId)).toEqual(["riz"]);
    srv.down = false;
    await e.retryNow();
    expect(srv.items.map((i) => i.productId)).toEqual(["riz"]);
  });

  it("critère 7 : un article acheté entre-temps ne peut pas être retiré par un ancien brouillon", async () => {
    srv.items = [item("lait", "to_buy", 1)];
    const e1 = await boot();
    await e1.toggle("lait"); // brouillon : retirer le lait (rev 1)
    expect(e1.getState().toggles["lait"]).toEqual({ want: false, seenRev: 1 });
    srv.items = [item("lait", "purchased", 2)]; // un parent l'achète
    const e2 = await boot();
    expect(e2.getState().toggles).toEqual({}); // le brouillon est écarté, l'article reste coché et verrouillé
    await e2.toggle("lait");
    expect(e2.getState().toggles).toEqual({});
    expect(e2.getState().notices.at(-1)?.text).toContain("Déjà acheté");
  });

  it("retrait périmé (acheté puis corrigé) : refusé, expliqué, rien n'est retiré", async () => {
    srv.items = [item("lait", "to_buy", 1)];
    const e = await boot();
    await e.toggle("lait");
    srv.items = [item("lait", "to_buy", 3)]; // acheté puis corrigé pendant ce temps
    await e.validate();
    expect(srv.items.map((i) => i.productId)).toEqual(["lait"]);
    expect(e.getState().notices.map((n) => n.text).join(" ")).toContain("« LAIT » a changé");
  });

  it("critère 12 : si une nouvelle liste remplace l'ancienne, le brouillon n'est pas appliqué ; reprise explicite", async () => {
    const e1 = await boot();
    await e1.toggle("lait");
    await e1.toggle("riz");
    srv.listId = "L2"; // L1 clôturée, L2 créée
    srv.items = [];
    const e2 = await boot();
    const s = e2.getState();
    expect(s.list?.id).toBe("L2");
    expect(s.toggles).toEqual({}); // rien d'appliqué silencieusement
    expect(s.orphan?.productIds.sort()).toEqual(["lait", "riz"]);
    expect(srv.calls).toEqual([]); // et rien envoyé
    await e2.resumeOrphan();
    expect(Object.keys(e2.getState().toggles).sort()).toEqual(["lait", "riz"]);
    expect(e2.getState().orphan).toBeNull();
    expect(srv.items).toEqual([]); // reprendre = préparer ; l'envoi reste un « Valider » explicite
  });

  it("un envoi en file pour une liste clôturée est refusé par le serveur et proposé pour la nouvelle liste", async () => {
    const e1 = await boot();
    await e1.toggle("lait");
    srv.down = true;
    await e1.validate(); // en file pour L1
    srv.down = false;
    srv.listId = "L2";
    srv.items = [];
    const e2 = await boot();
    expect(e2.getState().batches).toEqual([]); // envoyé, refusé
    expect(srv.items).toEqual([]); // L2 intacte
    expect(e2.getState().orphan?.productIds).toEqual(["lait"]);
    expect(e2.getState().notices.map((n) => n.text).join(" ")).toContain("clôturée");
  });

  it("les brouillons sont rattachés à un profil : une autre personne ne les voit pas", async () => {
    const e1 = await boot();
    await e1.toggle("lait");
    const other = new Engine({ db, newId, api: { ...srv.api, me: async () => ({ me: me("p2") }) } as any });
    await other.start();
    expect(other.getState().toggles).toEqual({});
    const again = await boot();
    expect(Object.keys(again.getState().toggles)).toEqual(["lait"]);
  });

  it("la déconnexion conserve les envois en attente de la personne", async () => {
    const e = await boot();
    await e.toggle("lait");
    srv.down = true;
    await e.validate();
    await e.logout();
    expect(e.getState().phase).toBe("loggedOut");
    srv.down = false;
    const e2 = await boot();
    await e2.retryNow();
    expect(srv.items.map((i) => i.productId)).toEqual(["lait"]);
  });

  it("session expirée (401) : retour à la connexion sans perdre le brouillon", async () => {
    const e1 = await boot();
    await e1.toggle("lait");
    srv.meOk = false;
    const e2 = await boot();
    expect(e2.getState().phase).toBe("loggedOut");
    srv.meOk = true;
    const e3 = await boot();
    expect(Object.keys(e3.getState().toggles)).toEqual(["lait"]);
  });

  it("aucune liste active : état « null » conservé et brouillon gardé pour la prochaine liste", async () => {
    const e1 = await boot();
    await e1.toggle("lait");
    srv.listId = null;
    const e2 = await boot();
    expect(e2.getState().list).toBeNull();
    expect(Object.keys(e2.getState().toggles)).toEqual(["lait"]);
  });
});

class FakeEventSource implements EventSourceLike {
  readyState = 1;
  onerror: ((e: unknown) => void) | null = null;
  handlers = new Map<string, ((e: unknown) => void)[]>();
  closed = false;
  addEventListener(type: string, fn: (e: unknown) => void) { this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]); }
  close() { this.closed = true; this.readyState = 2; }
  emit(type: string) { for (const h of this.handlers.get(type) ?? []) h({}); }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("validation pendant un envoi en cours", () => {
  it("un appui sur « Valider » pendant qu'un envoi est en vol n'est pas perdu : il part juste après", async () => {
    const e = await boot();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const real = srv.api.postOps;
    let first = true;
    srv.api.postOps = async (listId: string, ops: Op[]) => {
      if (first) { first = false; await gate; } // le premier envoi reste « en vol »
      return real(listId, ops);
    };
    await e.toggle("lait");
    const p1 = e.validate();
    await new Promise((r) => setTimeout(r, 20));
    expect(e.getState().sending).toBe(true);
    await e.toggle("riz");
    const p2 = e.validate(); // appui pendant l'envoi
    expect(e.getState().toggles).toEqual({}); // pris en compte tout de suite (en file)
    expect(e.getState().batches).toHaveLength(2);
    release();
    await Promise.all([p1, p2]);
    await new Promise((r) => setTimeout(r, 50));
    expect(srv.items.map((i) => i.productId).sort()).toEqual(["lait", "riz"]);
    expect(e.getState().batches).toEqual([]);
    expect(srv.calls).toHaveLength(2);
  });

  it("double appui rapide : un seul envoi", async () => {
    const e = await boot();
    await e.toggle("lait");
    await Promise.all([e.validate(), e.validate(), e.validate()]);
    expect(srv.calls).toHaveLength(1);
  });
});

describe("temps réel (SSE)", () => {
  it("un événement déclenche une relecture : les changements validés par d'autres apparaissent sans action", async () => {
    const es = new FakeEventSource();
    const e = new Engine({ db, api: srv.api, newId, eventSource: () => es });
    await e.start();
    es.emit("ready");
    expect(e.getState().live).toBe(true);
    srv.items = [item("lait")]; // un parent a modifié la liste
    es.emit("list.updated");
    es.emit("list.updated"); // rafale : une seule relecture
    await wait(300);
    expect(e.getState().list?.items.map((i) => i.productId)).toEqual(["lait"]);
  });

  it("critère 9 / 10 : l'événement ne remplace pas les choix non validés, il les complète", async () => {
    const es = new FakeEventSource();
    const e = new Engine({ db, api: srv.api, newId, eventSource: () => es });
    await e.start();
    await e.toggle("riz"); // brouillon local
    srv.items = [item("lait")]; // ajout indépendant d'un autre membre
    es.emit("list.updated");
    await wait(300);
    expect(e.getState().list?.items.map((i) => i.productId)).toEqual(["lait"]);
    expect(Object.keys(e.getState().toggles)).toEqual(["riz"]);
    await e.validate();
    expect(srv.items.map((i) => i.productId).sort()).toEqual(["lait", "riz"]); // les deux sont conservés
  });

  it("flux fermé par le serveur (session révoquée) : retour à la connexion", async () => {
    const es = new FakeEventSource();
    const e = new Engine({ db, api: srv.api, newId, eventSource: () => es });
    await e.start();
    srv.meOk = false;
    srv.api.catalog = async () => { throw new ApiError(401, "unauthenticated", "x"); };
    es.readyState = 2;
    es.onerror?.({});
    await wait(100);
    expect(e.getState().phase).toBe("loggedOut");
    expect(e.getState().live).toBe(false);
  });

  it("la déconnexion ferme le flux", async () => {
    const es = new FakeEventSource();
    const e = new Engine({ db, api: srv.api, newId, eventSource: () => es });
    await e.start();
    await e.logout();
    expect(es.closed).toBe(true);
  });

  it("coupure du flux : « live » retombe, la reprise relit l'état", async () => {
    const es = new FakeEventSource();
    const e = new Engine({ db, api: srv.api, newId, eventSource: () => es });
    await e.start();
    es.emit("ready");
    es.readyState = 0; // le navigateur retente
    es.onerror?.({});
    expect(e.getState().live).toBe(false);
    srv.items = [item("sucre")];
    es.emit("ready"); // reconnecté : le serveur envoie « ready »
    await wait(300);
    expect(e.getState().live).toBe(true);
    expect(e.getState().list?.items.map((i) => i.productId)).toEqual(["sucre"]);
  });
});

describe("relecture périodique (filet de sécurité quand le flux temps réel est retenu)", () => {
  /** Serveur lent : chaque lecture de la liste attend qu'on la libère ; on compte les lectures simultanées. */
  const slowServer = () => {
    let inFlight = 0, maxInFlight = 0, total = 0;
    const gates: (() => void)[] = [];
    const orig = srv.api.activeList;
    srv.api.activeList = async () => {
      total++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((ok) => gates.push(ok));
      inFlight--;
      return orig();
    };
    return { stats: () => ({ maxInFlight, total, inFlight }), release: () => { while (gates.length) gates.shift()!(); } };
  };

  it("jamais deux relectures en même temps (serveur lent, déclencheurs en rafale)", async () => {
    const e = await boot();
    const s = slowServer();
    const calls = [e.refresh(), e.refresh(), e.refresh()]; // tick périodique + événement + retour au premier plan
    await wait(20);
    expect(s.stats().maxInFlight).toBe(1);
    s.release();
    await wait(20);
    s.release(); // la relecture « une dernière fois » demandée pendant la première
    await Promise.all(calls);
    expect(s.stats().maxInFlight).toBe(1);
    expect(s.stats().total).toBeLessThanOrEqual(2); // une en cours + une seule de rattrapage, pas trois
  });

  it("politique : rien en arrière-plan, rien si le flux est actif, rien pendant une lecture, rien hors connexion (seule la reprise espacée tourne)", async () => {
    const e = await boot();
    let reads = 0;
    const orig = srv.api.activeList; srv.api.activeList = async () => { reads++; return orig(); };
    expect(await e.pollTick(false)).toBe(false); // application en arrière-plan
    expect(reads).toBe(0);
    expect(await e.pollTick(true)).toBe(true); // au premier plan, sans flux actif : une lecture
    expect(reads).toBe(1);
    const es = new FakeEventSource();
    const live = new Engine({ db, api: srv.api, newId, eventSource: () => es });
    await live.start(); es.emit("ready"); await wait(200);
    const before = reads;
    expect(await live.pollTick(true)).toBe(false); // flux actif : pas de relecture
    expect(reads).toBe(before);
    srv.down = true; // hors connexion
    await e.refresh();
    expect(e.getState().conn).toBe("offline");
    const r = reads;
    for (let i = 0; i < 5; i++) expect(await e.pollTick(true)).toBe(false); // 5 ticks hors connexion : aucune requête de plus
    expect(reads).toBe(r);
  });

  it("hors connexion : la reprise suit le délai croissant (3 s, 8 s, 20 s, 45 s), pas toutes les 8 s ; retour du réseau = une lecture", async () => {
    const e = await boot();
    srv.down = true; await e.refresh();
    await e.pollTick(true); // programme la reprise espacée une seule fois
    const timers = (e as any).retryPending;
    expect(timers).toBe(true);
    await e.pollTick(true); await e.pollTick(true);
    expect((e as any).retryStep).toBe(1); // un seul rendez-vous programmé malgré plusieurs ticks
    srv.down = false;
    await e.retryNow();
    expect(e.getState().conn).toBe("online");
  });

  describe("révision du catalogue : on ne retélécharge le catalogue que s'il a changé", () => {
    const withCat = (mut: (c: Catalog) => Catalog) => { srv.cat = mut(srv.cat); srv.catalogRev = (srv.catalogRev ?? 0) + 1; };

    it("10 relectures sans changement : le catalogue n'est téléchargé qu'une fois, la liste à chaque fois", async () => {
      srv.catalogRev = 1;
      const e = await boot();
      let lists = 0; const orig = srv.api.activeList; srv.api.activeList = async () => { lists++; return orig(); };
      expect(srv.catalogCalls).toBe(1);
      for (let i = 0; i < 10; i++) await e.pollTick(true);
      expect(srv.catalogCalls).toBe(1);
      expect(lists).toBe(10);
    });

    it("ajout, modification et désactivation d'un article : repris à la relecture suivante, une seule fois chacun", async () => {
      srv.catalogRev = 1;
      const e = await boot();
      const names = () => e.getState().catalog!.categories.flatMap((c) => c.products.map((p) => p.name)).sort();
      expect(names()).toEqual(["LAIT", "RIZ", "SUCRE"]);
      withCat((c) => ({ categories: c.categories.map((k) => ({ ...k, products: [...k.products, product("khobz")] })) })); // ajout
      await e.pollTick(true);
      expect(names()).toEqual(["KHOBZ", "LAIT", "RIZ", "SUCRE"]);
      expect(srv.catalogCalls).toBe(2);
      withCat((c) => ({ categories: c.categories.map((k) => ({ ...k, products: k.products.map((p) => (p.id === "riz" ? { ...p, name: "Riz basmati" } : p)) })) })); // modification
      await e.pollTick(true);
      expect(names()).toContain("Riz basmati");
      expect(srv.catalogCalls).toBe(3);
      withCat((c) => ({ categories: c.categories.map((k) => ({ ...k, products: k.products.filter((p) => p.id !== "sucre") })) })); // désactivation (disparaît du catalogue du personnel)
      await e.pollTick(true);
      expect(names()).not.toContain("SUCRE");
      expect(srv.catalogCalls).toBe(4);
      for (let i = 0; i < 5; i++) await e.pollTick(true); // plus rien ne change
      expect(srv.catalogCalls).toBe(4);
    });

    it("un événement catalog.updated du flux temps réel passe par le même contrôle de révision", async () => {
      srv.catalogRev = 1;
      const es = new FakeEventSource();
      const e = new Engine({ db, api: srv.api, newId, eventSource: () => es });
      await e.start(); es.emit("ready"); await wait(200);
      const before = srv.catalogCalls;
      es.emit("list.updated"); await wait(300); // pas de changement de catalogue : pas de téléchargement
      expect(srv.catalogCalls).toBe(before);
      withCat((c) => ({ categories: c.categories.map((k) => ({ ...k, products: [...k.products, product("miel")] })) }));
      es.emit("catalog.updated"); await wait(300);
      expect(srv.catalogCalls).toBe(before + 1);
      expect(e.getState().catalog!.categories[0]!.products.map((p) => p.id)).toContain("miel");
    });

    it("ancien serveur sans révision : comportement d'avant (le catalogue est relu à chaque fois)", async () => {
      srv.catalogRev = undefined;
      const e = await boot();
      for (let i = 0; i < 3; i++) await e.pollTick(true);
      expect(srv.catalogCalls).toBe(4);
    });
  });
});
