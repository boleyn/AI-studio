import AppKit

// Original linked-window mark: two open rounded frames share a diagonal bridge.
// Vector drawing keeps the application and monochrome menu glyph consistent.
func mark(_ size: CGFloat, color: NSColor) {
    color.setStroke()
    let path = NSBezierPath()
    path.lineWidth = size * 0.085
    path.lineCapStyle = .round
    path.lineJoinStyle = .round
    path.move(to: NSPoint(x: size * 0.43, y: size * 0.68))
    path.line(to: NSPoint(x: size * 0.30, y: size * 0.68))
    path.curve(to: NSPoint(x: size * 0.18, y: size * 0.56), controlPoint1: NSPoint(x: size * 0.21, y: size * 0.68), controlPoint2: NSPoint(x: size * 0.18, y: size * 0.65))
    path.line(to: NSPoint(x: size * 0.18, y: size * 0.30))
    path.curve(to: NSPoint(x: size * 0.30, y: size * 0.18), controlPoint1: NSPoint(x: size * 0.18, y: size * 0.21), controlPoint2: NSPoint(x: size * 0.21, y: size * 0.18))
    path.line(to: NSPoint(x: size * 0.56, y: size * 0.18))
    path.curve(to: NSPoint(x: size * 0.68, y: size * 0.30), controlPoint1: NSPoint(x: size * 0.65, y: size * 0.18), controlPoint2: NSPoint(x: size * 0.68, y: size * 0.21))
    path.line(to: NSPoint(x: size * 0.68, y: size * 0.43))
    path.stroke()
    let transform = AffineTransform(translationByX: size, byY: size)
    var rotate = transform
    rotate.scale(-1)
    path.transform(using: rotate)
    path.stroke()
    let bridge = NSBezierPath()
    bridge.lineWidth = size * 0.085; bridge.lineCapStyle = .round
    bridge.move(to: NSPoint(x: size * 0.39, y: size * 0.39))
    bridge.line(to: NSPoint(x: size * 0.61, y: size * 0.61)); bridge.stroke()
}
func render(_ target: String, tray: Bool) {
    let size: CGFloat = tray ? 64 : 1024
    let image = NSImage(size: NSSize(width: size, height: size))
    image.lockFocus()
    if !tray {
        let rect = NSRect(x: 48, y: 48, width: 928, height: 928)
        let base = NSBezierPath(roundedRect: rect, xRadius: 208, yRadius: 208)
        NSGradient(starting: NSColor(calibratedRed: 0.25, green: 0.56, blue: 1, alpha: 1), ending: NSColor(calibratedRed: 0.10, green: 0.28, blue: 0.84, alpha: 1))!.draw(in: base, angle: -80)
        let transform = NSAffineTransform(); transform.translateX(by: 122, yBy: 122); transform.scale(by: 0.76); transform.concat()
    }
    mark(size, color: tray ? .black : .white)
    image.unlockFocus()
    let rep = NSBitmapImageRep(data: image.tiffRepresentation!)!
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: target))
}
render(CommandLine.arguments[1], tray: false)
render(CommandLine.arguments[2], tray: true)
