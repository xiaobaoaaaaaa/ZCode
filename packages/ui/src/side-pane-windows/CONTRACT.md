# Side pane windows

This module owns display placement only. A tab keeps one stable portal host and one service context. Opening, docking and closing serialize per tab. Stale async opens close their empty window rather than resurrecting an unmounted tab. Only the original window's in-memory controller admits a drag-back key.

The platform port creates native auxiliary windows; this module never calls Electron or window.zcode. Business session, PTY and workspace ownership remain unchanged. See docs/ui/side-pane-windows.md.

Browser content uses NativeSidePaneWindowSurface from its first mount. Its portal document never moves; the platform moves the native carrier instead. Placement publishes only after the platform ACK. Dispose handles outstanding async docking failures. A shared layout observer coordinates bounds and original-window DOM overlays; temporary captured frames conceal the same live carrier without recreating it. Screenshot preparation temporarily admits the requested viewport and uses the existing original-owner ready handshake.
