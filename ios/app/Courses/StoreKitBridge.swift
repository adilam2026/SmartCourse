import StoreKit
import UIKit
import CoursesShared

/// Achats « Mes Courses Famille » (StoreKit 2) pour l'écran commun (Kotlin). Aucune décision ici : le serveur vérifie chaque
/// transaction signée par Apple et décide du déblocage ; une transaction n'est terminée (finish) qu'après acceptation par le serveur.
final class StoreKitBridge: NSObject, IosStoreKit {
    private var updates: Task<Void, Never>?

    override init() {
        super.init()
        // Transactions conclues hors du parcours d'achat (accord parental, renouvellement, achat sur un autre appareil).
        updates = Task.detached {
            for await result in Transaction.updates {
                guard case .verified(let t) = result else { continue }
                let jws = result.jwsRepresentation
                await MainActor.run { CoursesIos.shared.onStoreTransaction(jws: jws, transactionId: String(t.id)) }
            }
        }
    }

    func products(ids: [String], callback: IosProductsCallback) {
        Task { @MainActor in
            let list = (try? await Product.products(for: ids)) ?? []
            callback.done(products: list.map { p in
                IosStoreProduct(id: p.id, title: p.displayName, displayPrice: p.displayPrice, periodText: p.subscription == nil ? nil : "par an")
            })
        }
    }

    func purchase(productId: String, accountToken: String, callback: IosPurchaseCallback) {
        Task { @MainActor in
            guard let product = try? await Product.products(for: [productId]).first, let token = UUID(uuidString: accountToken) else {
                callback.done(status: "failed", jws: nil, transactionId: nil)
                return
            }
            do {
                switch try await product.purchase(options: [.appAccountToken(token)]) {
                case .success(let result):
                    if case .verified(let t) = result {
                        callback.done(status: "purchased", jws: result.jwsRepresentation, transactionId: String(t.id))
                    } else {
                        callback.done(status: "failed", jws: nil, transactionId: nil)
                    }
                case .pending: callback.done(status: "pending", jws: nil, transactionId: nil)
                case .userCancelled: callback.done(status: "cancelled", jws: nil, transactionId: nil)
                @unknown default: callback.done(status: "failed", jws: nil, transactionId: nil)
                }
            } catch {
                callback.done(status: "failed", jws: nil, transactionId: nil)
            }
        }
    }

    func entitlements(sync: Bool, callback: IosEntitlementsCallback) {
        Task { @MainActor in
            if sync { try? await AppStore.sync() }
            var jws: [String] = []
            var ids: [String] = []
            for await result in Transaction.currentEntitlements {
                guard case .verified(let t) = result else { continue }
                jws.append(result.jwsRepresentation)
                ids.append(String(t.id))
            }
            // Transactions restées non terminées (serveur injoignable lors d'un achat précédent).
            for await result in Transaction.unfinished {
                guard case .verified(let t) = result, !ids.contains(String(t.id)) else { continue }
                jws.append(result.jwsRepresentation)
                ids.append(String(t.id))
            }
            callback.done(jws: jws, transactionIds: ids)
        }
    }

    func finish(transactionId: String) {
        Task {
            for await result in Transaction.unfinished {
                if case .verified(let t) = result, String(t.id) == transactionId { await t.finish() }
            }
        }
    }

    func manageSubscriptions() {
        Task { @MainActor in
            guard let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene else { return }
            try? await AppStore.showManageSubscriptions(in: scene)
        }
    }
}
