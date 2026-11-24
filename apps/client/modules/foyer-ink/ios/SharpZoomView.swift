import ExpoModulesCore
import UIKit

/// Laid over a page inside the scroll view that zooms it, whose pixels iOS only scales. Once the page
/// is still for two frames, as iOS reports none of the bounce after a pinch, it says where the page
/// rests and draws the text on screen again at that zoom.
class SharpZoomView: ExpoView {
  let onRest = EventDispatcher()

  private weak var scroll: UIScrollView?
  private weak var sheet: UIView?
  private var link: CADisplayLink?
  private var stillTicks = 0
  private var reported: Viewport?
  private let sharpened = NSHashTable<UIView>.weakObjects()

  private static let textViewClass: AnyClass? = NSClassFromString("RCTParagraphTextView")
  private static let ticksBetweenTextChecks = 30

  override func didMoveToWindow() {
    super.didMoveToWindow()
    link?.invalidate()
    link = nil
    reported = nil
    guard window != nil else {
      for view in sharpened.allObjects { draw(view, atScale: screenScale) }
      return
    }
    scroll = ancestors.lazy.compactMap { $0 as? UIScrollView }.first
    sheet = scroll.flatMap { scroll in ancestors.first { $0.superview === scroll } }
    let link = CADisplayLink(target: self, selector: #selector(tick))
    link.add(to: .main, forMode: .common)
    self.link = link
  }

  /// Takes no touches: they go to what's under it.
  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    nil
  }

  private var ancestors: [UIView] {
    sequence(first: self as UIView, next: { $0.superview }).dropFirst().map { $0 }
  }

  private var screenScale: CGFloat {
    window?.screen.scale ?? traitCollection.displayScale
  }

  // MARK: Where the page rests

  private struct Viewport {
    var shown: CGRect
    var zoom: CGFloat

    func isSame(as other: Viewport) -> Bool {
      abs(zoom - other.zoom) < 1e-6 && abs(shown.minX - other.shown.minX) < 1e-3
        && abs(shown.minY - other.shown.minY) < 1e-3
        && abs(shown.width - other.shown.width) < 1e-3
        && abs(shown.height - other.shown.height) < 1e-3
    }
  }

  private func currentViewport() -> Viewport? {
    guard let scroll, scroll.bounds.width > 0 else { return nil }
    let shown = scroll.convert(scroll.bounds, to: self)
    guard shown.width > 0 else { return nil }
    return Viewport(shown: shown, zoom: scroll.bounds.width / shown.width)
  }

  @objc private func tick() {
    guard let scroll else { return }
    let zoomed = scroll.delegate?.viewForZooming?(in: scroll)
    let moving = scroll.isTracking || scroll.isDragging || scroll.isZooming || scroll.isDecelerating
      || scroll.isZoomBouncing || isAnimating(scroll.layer) || isAnimating(zoomed?.layer)
    stillTicks = moving ? 0 : stillTicks + 1
    guard stillTicks >= 2, let viewport = currentViewport() else { return }
    if reported.map({ !$0.isSame(as: viewport) }) ?? true {
      reported = viewport
      onRest([
        "x": Double(viewport.shown.minX), "y": Double(viewport.shown.minY),
        "width": Double(viewport.shown.width), "height": Double(viewport.shown.height),
        "zoom": Double(viewport.zoom),
      ])
      drawText(at: viewport)
    } else if stillTicks % Self.ticksBetweenTextChecks == 0 {
      drawText(at: viewport)
    }
  }

  private func isAnimating(_ layer: CALayer?) -> Bool {
    !(layer?.animationKeys() ?? []).isEmpty
  }

  // MARK: Text

  private func drawText(at viewport: Viewport) {
    guard let sheet, let textViewClass = Self.textViewClass else { return }
    let normal = screenScale
    let zoomed = normal * max(1, viewport.zoom)
    var onPage = Set<ObjectIdentifier>()
    visit(sheet) { view in
      guard view.isKind(of: textViewClass) else { return }
      onPage.insert(ObjectIdentifier(view))
      let onScreen = view.convert(view.bounds, to: self).intersects(viewport.shown)
      draw(view, atScale: onScreen ? zoomed : normal)
    }
    for view in sharpened.allObjects where !onPage.contains(ObjectIdentifier(view)) {
      draw(view, atScale: normal)
    }
  }

  private func visit(_ view: UIView, _ body: (UIView) -> Void) {
    body(view)
    for subview in view.subviews { visit(subview, body) }
  }

  private func draw(_ view: UIView, atScale scale: CGFloat) {
    if scale > screenScale { sharpened.add(view) } else { sharpened.remove(view) }
    guard abs(view.contentScaleFactor - scale) > 0.01 else { return }
    view.contentScaleFactor = scale
    view.setNeedsDisplay()
  }
}
