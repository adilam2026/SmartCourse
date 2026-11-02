import SwiftUI
import Courses

/// Coquille iPhone : affiche les écrans communs (Kotlin, Compose Multiplatform). Aucune logique ni aucun écran propre ici.
@main
struct CoursesApp: App {
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
