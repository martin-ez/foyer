import ExpoModulesCore
import PencilKit
import UIKit
import UIKit.UIGestureRecognizerSubclass

/// What the Pencil does: writes with a pen whose width follows pressure, a line of even width, or
/// erases whole strokes.
enum PencilTool: String {
  case pen, monoline, eraser
}

/// A view laid over a page, in the page's own points, inside the scroll view that zooms the page.
/// PencilKit draws only the stroke being written, at the screen's resolution; when the pen lifts,
/// the stroke goes to JavaScript, and PencilKit lets go of it a few frames after Skia drew it.
class PencilView: ExpoView, PKCanvasViewDelegate {
  let onStrokeDrawn = EventDispatcher()
  let onErase = EventDispatcher()

  var tool = PencilTool.pen { didSet { applyTool() } }
  var colour = 0x1a1a1a { didSet { applyTool() } }
  var size = 1.4 { didSet { applyTool() } }
  var mouseDraws = false { didSet { applyMouse() } }

  private let canvas = PKCanvasView()
  private let pencilTouches = PencilTouchRecognizer()
  private weak var scroll: UIScrollView?
  private weak var sheet: UIView?
  private var link: CADisplayLink?
  private var ticks = 0
  private var stillTicks = 0
  private var placedAt: Viewport?
  private var writing = false
  private var knownStrokes = 0
  private var nextHandoff = 0
  private var handedOff: [(handoff: Int, drawnAt: Int?)] = []

  private static let ticksToKeepDrawnStrokes = 4
  private static let pencilMaximumForce = 4.166666666666667

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    canvas.layer.anchorPoint = .zero
    canvas.backgroundColor = .clear
    canvas.isOpaque = false
    canvas.overrideUserInterfaceStyle = .light
    canvas.contentInsetAdjustmentBehavior = .never
    canvas.showsVerticalScrollIndicator = false
    canvas.showsHorizontalScrollIndicator = false
    canvas.isScrollEnabled = false
    canvas.bounces = false
    canvas.bouncesZoom = false
    canvas.minimumZoomScale = 0.01
    canvas.maximumZoomScale = 100
    canvas.drawingPolicy = .pencilOnly
    canvas.delegate = self
    addSubview(canvas)
    pencilTouches.onTouch = { [weak self] phase, touch in self?.pencilTouched(phase, touch) }
    applyTool()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    link?.invalidate()
    link = nil
    guard window != nil else {
      sheet?.removeGestureRecognizer(pencilTouches)
      canvas.addGestureRecognizer(canvas.drawingGestureRecognizer)
      return
    }
    scroll = enclosingScrollView()
    sheet = scroll.flatMap { scroll in ancestors.first { $0.superview === scroll } }
    for recognizer in [scroll?.panGestureRecognizer, scroll?.pinchGestureRecognizer] {
      recognizer?.allowedTouchTypes = Self.touchTypesExceptPencil
    }
    sheet?.addGestureRecognizer(canvas.drawingGestureRecognizer)
    sheet?.addGestureRecognizer(pencilTouches)
    applyMouse()
    let link = CADisplayLink(target: self, selector: #selector(tick))
    link.add(to: .main, forMode: .common)
    self.link = link
  }

  // MARK: Touches

  /// Takes no touches itself: the Pencil's reach it through recognizers on the zoomed page, and
  /// every other touch goes to what's under the page's ink.
  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    nil
  }

  private func pencilTouched(_ phase: PencilTouchRecognizer.Phase, _ touch: UITouch) {
    let at = touch.location(in: self)
    switch phase {
    case .began:
      stopScrolling()
      if let viewport = currentViewport(), placedAt.map({ !$0.isSame(as: viewport) }) ?? true {
        place(at: viewport)
      }
      DispatchQueue.main.async { [weak self] in self?.cancelReactNativeTouches() }
      if tool == .eraser {
        writing = true
        erase("start", at: at)
      }
    case .moved:
      if tool == .eraser { erase("move", at: at) }
    case .ended:
      if tool == .eraser {
        writing = false
        erase("end", at: at)
      }
    }
  }

  /// Ends the touches React Native is following, as when a native gesture takes over, so that the
  /// Pencil never also taps or drags what's on the page.
  private func cancelReactNativeTouches() {
    guard let touchHandler = NSClassFromString("RCTSurfaceTouchHandler") else { return }
    for view in ancestors {
      for recognizer in view.gestureRecognizers ?? [] where recognizer.isKind(of: touchHandler) {
        recognizer.isEnabled = false
        recognizer.isEnabled = true
      }
    }
  }

  private var ancestors: [UIView] {
    sequence(first: self as UIView, next: { $0.superview }).dropFirst().map { $0 }
  }

  private static let touchTypesExceptPencil = [
    UITouch.TouchType.direct, .indirect, .indirectPointer,
  ].map { NSNumber(value: $0.rawValue) }

  private var drawsWithMouse: Bool {
    #if targetEnvironment(simulator)
      return mouseDraws
    #else
      return false
    #endif
  }

  private func applyMouse() {
    canvas.drawingPolicy = drawsWithMouse ? .anyInput : .pencilOnly
    scroll?.panGestureRecognizer.isEnabled = !drawsWithMouse
    var pens = [UITouch.TouchType.pencil]
    if drawsWithMouse { pens.append(.direct) }
    let types = pens.map { NSNumber(value: $0.rawValue) }
    canvas.drawingGestureRecognizer.allowedTouchTypes = types
    pencilTouches.allowedTouchTypes = types
  }

  private func stopScrolling() {
    guard let scroll, scroll.isDecelerating else { return }
    scroll.setContentOffset(scroll.contentOffset, animated: false)
  }

  private func erase(_ phase: String, at point: CGPoint) {
    onErase([
      "phase": phase, "x": Double(point.x), "y": Double(point.y),
      "zoom": Double(currentViewport()?.zoom ?? 1),
    ])
  }

  // MARK: Where PencilKit draws

  /// The part of the page the screen shows: where, in the page's points, and how many screen
  /// points one page point takes.
  private struct Viewport {
    var origin: CGPoint
    var screen: CGSize
    var zoom: CGFloat

    func isSame(as other: Viewport) -> Bool {
      abs(zoom - other.zoom) < 1e-6 && abs(origin.x - other.origin.x) < 1e-3
        && abs(origin.y - other.origin.y) < 1e-3 && screen == other.screen
    }
  }

  private func enclosingScrollView() -> UIScrollView? {
    ancestors.lazy.compactMap { $0 as? UIScrollView }.first
  }

  private func currentViewport() -> Viewport? {
    guard let scroll, scroll.bounds.width > 0 else { return nil }
    let shown = scroll.convert(scroll.bounds, to: self)
    guard shown.width > 0 else { return nil }
    return Viewport(origin: shown.origin, screen: scroll.bounds.size, zoom: scroll.bounds.width / shown.width)
  }

  /// Covers what the screen shows with PencilKit, drawing at the screen's resolution in the page's
  /// points.
  private func place(at viewport: Viewport) {
    canvas.setZoomScale(viewport.zoom, animated: false)
    canvas.contentSize = CGSize(width: bounds.width * viewport.zoom, height: bounds.height * viewport.zoom)
    let margin = max(viewport.screen.width, viewport.screen.height) * 2
    canvas.contentInset = UIEdgeInsets(top: margin, left: margin, bottom: margin, right: margin)
    canvas.transform = .identity
    canvas.bounds.size = viewport.screen
    canvas.layer.position = viewport.origin
    canvas.transform = CGAffineTransform(scaleX: 1 / viewport.zoom, y: 1 / viewport.zoom)
    canvas.pinchGestureRecognizer?.isEnabled = false
    canvas.panGestureRecognizer.isEnabled = false
    canvas.contentOffset = CGPoint(x: viewport.origin.x * viewport.zoom, y: viewport.origin.y * viewport.zoom)
    placedAt = viewport
  }

  @objc private func tick() {
    ticks += 1
    guard let scroll else { return }
    let zoomed = scroll.delegate?.viewForZooming?(in: scroll)
    let moving = scroll.isTracking || scroll.isDragging || scroll.isZooming || scroll.isDecelerating
      || scroll.isZoomBouncing || isAnimating(scroll.layer) || isAnimating(zoomed?.layer)
    stillTicks = moving ? 0 : stillTicks + 1
    if stillTicks >= 2, !writing, handedOff.isEmpty, let viewport = currentViewport(),
      placedAt.map({ !$0.isSame(as: viewport) }) ?? true
    {
      place(at: viewport)
    }
    letGoOfDrawnStrokes()
  }

  private func isAnimating(_ layer: CALayer?) -> Bool {
    !(layer?.animationKeys() ?? []).isEmpty
  }

  // MARK: Strokes

  private func applyTool() {
    canvas.drawingGestureRecognizer.isEnabled = tool != .eraser
    guard tool != .eraser else { return }
    var ink = PKInk.InkType.pen
    if #available(iOS 17.0, *), tool == .monoline { ink = .monoline }
    canvas.tool = PKInkingTool(ink, color: Self.color(colour), width: size / 2 + 2)
  }

  func canvasViewDidBeginUsingTool(_ canvasView: PKCanvasView) {
    writing = true
  }

  func canvasViewDidEndUsingTool(_ canvasView: PKCanvasView) {
    writing = false
  }

  func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
    let strokes = canvasView.drawing.strokes
    defer { knownStrokes = strokes.count }
    guard strokes.count > knownStrokes else { return }
    for stroke in strokes[knownStrokes...] {
      nextHandoff += 1
      handedOff.append((nextHandoff, nil))
      onStrokeDrawn(event(for: stroke, handoff: nextHandoff))
    }
  }

  /// Skia drew every stroke up to hand-off `handoff`.
  func strokeDrawn(_ handoff: Int) {
    for index in handedOff.indices where handedOff[index].handoff <= handoff {
      if handedOff[index].drawnAt == nil { handedOff[index].drawnAt = ticks }
    }
  }

  private func letGoOfDrawnStrokes() {
    guard !writing else { return }
    let drawn = handedOff.prefix { entry in
      entry.drawnAt.map { ticks - $0 > Self.ticksToKeepDrawnStrokes } ?? false
    }
    guard !drawn.isEmpty else { return }
    var drawing = canvas.drawing
    drawing.strokes.removeFirst(min(drawn.count, drawing.strokes.count))
    knownStrokes = drawing.strokes.count
    canvas.drawing = drawing
    handedOff.removeFirst(drawn.count)
  }

  private func event(for stroke: PKStroke, handoff: Int) -> [String: Any] {
    var x: [Double] = [], y: [Double] = [], time: [Double] = []
    var force: [Double] = [], altitude: [Double] = [], azimuth: [Double] = []
    for point in stroke.path {
      let location = point.location.applying(stroke.transform)
      x.append(Double(location.x))
      y.append(Double(location.y))
      time.append(point.timeOffset * 1000)
      force.append(min(1, Double(point.force) / Self.pencilMaximumForce))
      altitude.append(Double(point.altitude))
      azimuth.append(Double(point.azimuth))
    }
    var monoline = false
    if #available(iOS 17.0, *) { monoline = stroke.ink.inkType == .monoline }
    let byPencil = !drawsWithMouse
    return [
      "handoff": handoff,
      "drawnAt": stroke.path.creationDate.timeIntervalSince1970 * 1000,
      "input": byPencil ? "pencil" : "finger",
      "tool": monoline ? "monoline" : "pen",
      "colour": colour,
      "size": size,
      "x": x, "y": y, "time": time,
      "force": byPencil ? force : [], "altitude": byPencil ? altitude : [],
      "azimuth": byPencil ? azimuth : [],
    ]
  }

  private static func color(_ rgb: Int) -> UIColor {
    UIColor(
      red: CGFloat((rgb >> 16) & 0xff) / 255, green: CGFloat((rgb >> 8) & 0xff) / 255,
      blue: CGFloat(rgb & 0xff) / 255, alpha: 1)
  }
}

/// Follows the Pencil's touches on the page without ever taking them from anything else: it stays
/// undecided until they end.
private class PencilTouchRecognizer: UIGestureRecognizer {
  enum Phase { case began, moved, ended }

  var onTouch: (Phase, UITouch) -> Void = { _, _ in }

  override init(target: Any?, action: Selector?) {
    super.init(target: target, action: action)
    cancelsTouchesInView = false
    delaysTouchesBegan = false
    delaysTouchesEnded = false
  }

  convenience init() {
    self.init(target: nil, action: nil)
  }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
    if let touch = touches.first { onTouch(.began, touch) }
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
    if let touch = touches.first { onTouch(.moved, touch) }
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
    if let touch = touches.first { onTouch(.ended, touch) }
    state = .failed
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
    touchesEnded(touches, with: event)
  }

  override func canPrevent(_ preventedGestureRecognizer: UIGestureRecognizer) -> Bool {
    false
  }

  override func canBePrevented(by preventingGestureRecognizer: UIGestureRecognizer) -> Bool {
    false
  }
}
