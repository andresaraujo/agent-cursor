// agent-cursor-overlay: transparent click-through window that follows the cursor
// and renders HTML pushed by the daemon. Window/spring behaviour adapted from
// Glimpse (MIT, https://github.com/HazAT/glimpse).
//
// stdin (NDJSON):  {type:"html", html:<base64>} {type:"eval", js} {type:"watch-cursor"}
//                  {type:"activate", bundleId} {type:"close"}
// stdout (NDJSON): {type:"ready"} {type:"cursor-moved"} {type:"hotkey"} {type:"frontmost", hidden}
// args: --width N --height N [--hide-when-frontmost BUNDLE_ID] [--hotkey ctrl+opt+j]
// Exits when stdin closes, so the window never outlives the daemon.

import AppKit
import Carbon.HIToolbox
import WebKit

func emit(_ dict: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: dict),
          let line = String(data: data, encoding: .utf8) else { return }
    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
}

func log(_ message: String) {
    FileHandle.standardError.write("[overlay] \(message)\n".data(using: .utf8)!)
}

// MARK: - Config

struct Config {
    var width: CGFloat = 520
    var height: CGFloat = 320
    var hideBundleId: String? = nil
    var hotkey: String? = nil
}

func parseArgs() -> Config {
    var config = Config()
    var args = CommandLine.arguments.dropFirst().makeIterator()
    while let arg = args.next() {
        switch arg {
        case "--width": config.width = CGFloat(Double(args.next() ?? "") ?? 520)
        case "--height": config.height = CGFloat(Double(args.next() ?? "") ?? 320)
        case "--hide-when-frontmost": config.hideBundleId = args.next()
        case "--hotkey": config.hotkey = args.next()
        default: log("unknown arg \(arg)")
        }
    }
    return config
}

// MARK: - Hotkey ("ctrl+opt+j")

let keyCodes: [String: Int] = [
    "a": kVK_ANSI_A, "b": kVK_ANSI_B, "c": kVK_ANSI_C, "d": kVK_ANSI_D, "e": kVK_ANSI_E,
    "f": kVK_ANSI_F, "g": kVK_ANSI_G, "h": kVK_ANSI_H, "i": kVK_ANSI_I, "j": kVK_ANSI_J,
    "k": kVK_ANSI_K, "l": kVK_ANSI_L, "m": kVK_ANSI_M, "n": kVK_ANSI_N, "o": kVK_ANSI_O,
    "p": kVK_ANSI_P, "q": kVK_ANSI_Q, "r": kVK_ANSI_R, "s": kVK_ANSI_S, "t": kVK_ANSI_T,
    "u": kVK_ANSI_U, "v": kVK_ANSI_V, "w": kVK_ANSI_W, "x": kVK_ANSI_X, "y": kVK_ANSI_Y,
    "z": kVK_ANSI_Z, "0": kVK_ANSI_0, "1": kVK_ANSI_1, "2": kVK_ANSI_2, "3": kVK_ANSI_3,
    "4": kVK_ANSI_4, "5": kVK_ANSI_5, "6": kVK_ANSI_6, "7": kVK_ANSI_7, "8": kVK_ANSI_8,
    "9": kVK_ANSI_9, "space": kVK_Space, "return": kVK_Return, "escape": kVK_Escape,
    ";": kVK_ANSI_Semicolon, "'": kVK_ANSI_Quote, ",": kVK_ANSI_Comma, ".": kVK_ANSI_Period,
    "/": kVK_ANSI_Slash, "`": kVK_ANSI_Grave,
]

func parseHotkey(_ spec: String) -> (UInt32, UInt32)? {
    var mods: UInt32 = 0
    var key: Int? = nil
    for part in spec.lowercased().split(separator: "+").map(String.init) {
        switch part {
        case "ctrl", "control": mods |= UInt32(controlKey)
        case "opt", "option", "alt": mods |= UInt32(optionKey)
        case "cmd", "command": mods |= UInt32(cmdKey)
        case "shift": mods |= UInt32(shiftKey)
        default: key = keyCodes[part]
        }
    }
    guard let key, mods != 0 else { return nil }
    return (UInt32(key), mods)
}

var hotKeyRef: EventHotKeyRef?

// Carbon hotkeys need no Accessibility permission.
func registerHotkey(_ spec: String) {
    guard let (code, mods) = parseHotkey(spec) else {
        log("invalid hotkey \(spec)")
        return
    }
    var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
    InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in
        emit(["type": "hotkey"])
        return noErr
    }, 1, &eventType, nil, nil)
    let id = EventHotKeyID(signature: OSType(0x41435552), id: 1) // "ACUR"
    let status = RegisterEventHotKey(code, mods, id, GetApplicationEventTarget(), 0, &hotKeyRef)
    if status != noErr { log("hotkey \(spec) unavailable (\(status))") }
}

// MARK: - App

class Overlay: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    let config: Config
    var window: NSWindow!
    var webView: WKWebView!
    var ready = false
    var pending: [String] = []

    // Spring follow (same constants as Glimpse's "spring" mode).
    var target = NSPoint.zero, pos = NSPoint.zero, vel = NSPoint.zero
    var springTimer: DispatchSourceTimer?
    var springRunning = false
    let stiffness: CGFloat = 400, damping: CGFloat = 28, dt: CGFloat = 1.0 / 120.0

    var cursorBaseline: NSPoint? = nil
    var hiddenByFrontmost = false

    init(config: Config) { self.config = config }

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: config.width, height: config.height),
                          styleMask: [.borderless], backing: .buffered, defer: false)
        window.level = .floating
        window.ignoresMouseEvents = true
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]

        webView = WKWebView(frame: window.contentView!.bounds)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.underPageBackgroundColor = .clear
        webView.setValue(false, forKey: "drawsBackground")
        window.contentView?.addSubview(webView)

        pos = targetFor(NSEvent.mouseLocation)
        target = pos
        window.setFrameOrigin(pos)
        window.orderFrontRegardless()

        NSEvent.addGlobalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged, .rightMouseDragged]) { [weak self] _ in
            self?.mouseMoved()
        }
        NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved]) { [weak self] event in
            self?.mouseMoved()
            return event
        }

        if config.hideBundleId != nil {
            NSWorkspace.shared.notificationCenter.addObserver(
                self, selector: #selector(appActivated(_:)),
                name: NSWorkspace.didActivateApplicationNotification, object: nil)
            // frontmostApplication can be stale during launch; check again shortly after.
            updateFrontmost(NSWorkspace.shared.frontmostApplication?.bundleIdentifier)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                self?.updateFrontmost(NSWorkspace.shared.frontmostApplication?.bundleIdentifier)
            }
        }
        if let hotkey = config.hotkey { registerHotkey(hotkey) }

        readStdin()
    }

    // Window sits above-right of the cursor; content is bottom-aligned by the page.
    func targetFor(_ mouse: NSPoint) -> NSPoint {
        NSPoint(x: mouse.x + 47, y: mouse.y - 5)
    }

    func mouseMoved() {
        let mouse = NSEvent.mouseLocation
        target = targetFor(mouse)
        wakeSpring()
        if let base = cursorBaseline, hypot(mouse.x - base.x, mouse.y - base.y) >= 24 {
            cursorBaseline = nil
            emit(["type": "cursor-moved"])
        }
    }

    func wakeSpring() {
        if springTimer == nil {
            let timer = DispatchSource.makeTimerSource(queue: .main)
            timer.schedule(deadline: .now(), repeating: .milliseconds(8))
            timer.setEventHandler { [weak self] in self?.springStep() }
            springTimer = timer
        }
        if !springRunning {
            springTimer!.resume()
            springRunning = true
        }
    }

    func springStep() {
        let fx = stiffness * (target.x - pos.x) - damping * vel.x
        let fy = stiffness * (target.y - pos.y) - damping * vel.y
        vel.x += fx * dt; vel.y += fy * dt
        pos.x += vel.x * dt; pos.y += vel.y * dt
        let dist = hypot(target.x - pos.x, target.y - pos.y)
        if dist < 0.5 && hypot(vel.x, vel.y) < 0.5 {
            pos = target
            vel = .zero
            springTimer?.suspend()
            springRunning = false
        }
        window.setFrameOrigin(pos)
    }

    @objc func appActivated(_ note: Notification) {
        let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
        updateFrontmost(app?.bundleIdentifier)
    }

    func updateFrontmost(_ bundleId: String?) {
        let hide = bundleId != nil && bundleId == config.hideBundleId
        guard hide != hiddenByFrontmost else { return }
        hiddenByFrontmost = hide
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.2
            window.animator().alphaValue = hide ? 0 : 1
        }
        emit(["type": "frontmost", "hidden": hide])
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !ready else { return }
        ready = true
        for js in pending { webView.evaluateJavaScript(js) }
        pending.removeAll()
        emit(["type": "ready"])
    }

    func handle(_ msg: [String: Any]) {
        switch msg["type"] as? String {
        case "html":
            guard let b64 = msg["html"] as? String, let data = Data(base64Encoded: b64),
                  let html = String(data: data, encoding: .utf8) else { return }
            ready = false
            webView.loadHTMLString(html, baseURL: nil)
        case "eval":
            guard let js = msg["js"] as? String else { return }
            if ready { webView.evaluateJavaScript(js) } else { pending.append(js) }
        case "watch-cursor":
            cursorBaseline = NSEvent.mouseLocation
        case "activate":
            guard let id = msg["bundleId"] as? String,
                  let app = NSRunningApplication.runningApplications(withBundleIdentifier: id).first else { return }
            app.activate()
        case "close":
            NSApp.terminate(nil)
        default:
            break
        }
    }

    func readStdin() {
        DispatchQueue.global(qos: .userInitiated).async {
            while let line = readLine() {
                guard let data = line.data(using: .utf8),
                      let msg = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
                DispatchQueue.main.async { self.handle(msg) }
            }
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let overlay = Overlay(config: parseArgs())
app.delegate = overlay
app.run()
