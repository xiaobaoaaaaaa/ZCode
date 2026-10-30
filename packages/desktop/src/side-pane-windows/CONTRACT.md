# Side pane window host

Main owns only native windows keyed by an opaque renderer UUID. Only the opener may close its windows. An auxiliary close requests docking first; a subsequent opener ACK closes the empty window. Opener destruction destroys all children. No Host, service attachment, session or terminal is created.

Renderer adapter owns the DOM window and styling mirror; content remains in the opener React tree and retains its service context. The `unknown` content parameter in IPlatformService is validated as an HTMLElement locally and never crosses IPC. See docs/ui/side-pane-windows.md.

Browser tabs mount once into a same-origin WebContentsView document. Moving the native view between the opener and a BaseWindow preserves the document, webview guest and CDP connection. The original renderer remains the logical service/permission owner. Main resolves presentation separately for screenshot capture; a carrier cannot authorize a different owner. Native view commands validate the original IPC sender, UUID, action and finite geometry. The existing webview security installer applies to every carrier.

BaseWindow close requests docking and waits for its ACK. True tab close or opener destruction disposes the carrier; unexpected carrier destruction also closes its empty window. Cleanup uses a stable WebContents reference because the view getter becomes unavailable after destruction. Theme/style/language mirroring and DOM-overlay occlusion change presentation without remounting the page.
