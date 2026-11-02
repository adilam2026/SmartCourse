import SwiftUI
import UserNotifications
import CoursesShared

/// Notifications : jeton APNs transmis aux écrans communs ; notifications affichées aussi quand l'application est ouverte
/// (comme sur Android) ; un toucher ouvre simplement l'application sur la liste.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        CoursesIos.shared.onApnsToken(hex: deviceToken.map { String(format: "%02x", $0) }.joined())
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NSLog("[CoursesNotif] jeton APNs refusé : %@", error.localizedDescription)
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        completionHandler()
    }
}

/// Coquille iPhone : affiche les écrans communs (Kotlin, Compose Multiplatform). Aucune logique ni aucun écran propre ici.
@main
struct CoursesApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            ComposeView()
                .ignoresSafeArea()
                .onChange(of: phase) { p in
                    // Équivalent de onStart / onStop sur Android : flux en direct ouvert au premier plan, fermé en arrière-plan.
                    if p == .active { CoursesIos.shared.onForeground() }
                    if p == .background { CoursesIos.shared.onBackground() }
                }
        }
    }
}

struct ComposeView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> UIViewController { MainViewControllerKt.MainViewController() }
    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}
}
