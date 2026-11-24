import ExpoModulesCore

/// The Apple Pencil's view over a page, which draws the stroke being written.
public class FoyerInkModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FoyerInk")

    Constant("isSimulator") { () -> Bool in
      #if targetEnvironment(simulator)
        return true
      #else
        return false
      #endif
    }

    View(PencilView.self) {
      Events("onStrokeDrawn", "onErase")

      Prop("tool") { (view: PencilView, tool: String) in
        view.tool = PencilTool(rawValue: tool) ?? .pen
      }
      Prop("colour") { (view: PencilView, colour: Int) in
        view.colour = colour
      }
      Prop("size") { (view: PencilView, size: Double) in
        view.size = size
      }
      Prop("mouseDraws") { (view: PencilView, mouseDraws: Bool) in
        view.mouseDraws = mouseDraws
      }

      AsyncFunction("strokeDrawn") { (view: PencilView, handoff: Int) in
        view.strokeDrawn(handoff)
      }
    }

    View(SharpZoomView.self) {
      Events("onRest")
    }
  }
}
