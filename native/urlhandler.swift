// AgentCursor.app: background app registered for agent-cursor:// URLs.
// Hands each URL to `bin/run.sh url <url>` (validated there) and quits.
// Lives at <plugin root>/native/AgentCursor.app.

import AppKit

class Handler: NSObject, NSApplicationDelegate {
    let root = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent()

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Launched without a URL (e.g. double-clicked): nothing to do.
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { NSApp.terminate(nil) }
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls { run(url.absoluteString) }
        NSApp.terminate(nil)
    }

    func run(_ url: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = [root.appendingPathComponent("bin/run.sh").path, "url", url]
        process.currentDirectoryURL = root
        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            NSLog("agent-cursor: failed to run \(url): \(error)")
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let handler = Handler()
app.delegate = handler
app.run()
