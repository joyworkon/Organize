// Read-only display diagnostics for the macOS notch compatibility review.
// Run: swift scripts/diagnostics/macos-screen-snapshot.swift > /tmp/organize-screens.json
// Does not capture screen contents, window titles, display serials, or account data.
import AppKit
import CoreGraphics

_ = NSApplication.shared

func rect(_ value: NSRect) -> [String: Double] {
    ["x": value.origin.x, "y": value.origin.y,
     "width": value.width, "height": value.height]
}

let screens = NSScreen.screens
let screenValues = screens.enumerated().map { index, screen -> [String: Any] in
    // NSScreen.CGDirectDisplayID requires macOS 26; use the older device dictionary.
    let displayID = (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")]
        as? NSNumber)?.uint32Value ?? 0
    var value: [String: Any] = [
        "index": index,
        "runtimeDisplayID": displayID,
        "builtIn": CGDisplayIsBuiltin(displayID) != 0,
        "framePoints": rect(screen.frame),
        "visibleFramePoints": rect(screen.visibleFrame),
        "backingScale": screen.backingScaleFactor,
        "isPrimary": index == 0,
        "isKeyboardFocusScreen": screen == NSScreen.main,
    ]
    if #available(macOS 12.0, *) {
        let inset = screen.safeAreaInsets
        value["safeAreaAPIAvailable"] = true
        value["safeAreaInsetsPoints"] = [
            "top": inset.top, "left": inset.left,
            "bottom": inset.bottom, "right": inset.right,
        ]
        value["auxiliaryTopLeftPoints"] = screen.auxiliaryTopLeftArea.map(rect) ?? [:]
        value["auxiliaryTopRightPoints"] = screen.auxiliaryTopRightArea.map(rect) ?? [:]
    } else {
        value["safeAreaAPIAvailable"] = false
    }
    return value
}

let output: [String: Any] = [
    "schemaVersion": 1,
    "capturedAtUTC": ISO8601DateFormatter().string(from: Date()),
    "operatingSystem": ProcessInfo.processInfo.operatingSystemVersionString,
    "coordinates": "AppKit global points; origin at primary display bottom-left",
    "separateSpaces": NSScreen.screensHaveSeparateSpaces,
    "screens": screenValues,
]
let data = try JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys])
print(String(data: data, encoding: .utf8)!)
