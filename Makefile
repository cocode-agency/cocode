# Local dev shortcuts — run from the cocode repository root.

DSH_DIR ?= cocode-host-supervisor

.PHONY: help dev gui gui-dev gui-build gui-web tui tui-preflight dsh install-gui install-tui install-dsh benchmark-terminal

.DEFAULT_GOAL := help

help:
	@echo "GUI dev:         make gui-dev      → desktop client + Vite on :5273"
	@echo "                 make dev gui      → alias for make gui-dev"
	@echo "GUI build:       make gui-build    → Electron Forge distributables"
	@echo "GUI (browser):   make dev gui-web  → http://localhost:5273 (DSH runtime auto-started)"
	@echo "GUI cache:       make dev gui reuses the OS cache directory"
	@echo "                 DSH_FORCE_RESTAGE=1 make dev gui  → refresh runtime cache"
	@echo "                 DSH_DISABLE_RUNTIME_CACHE=1 make dev gui  → isolated runtime"
	@echo "TUI:             make dev tui       → terminal client (requires TTY)"
	@echo "TUI checks:      make tui-preflight → install deps and refresh Host runtime when needed"
	@echo "DSH:             make dev dsh        → @deepseek-ai/dsh web"
	@echo "Install GUI:     make install-gui"
	@echo "Install TUI:     make install-tui"
	@echo "Install DSH:     make install-dsh    → install @deepseek-ai/dsh dependencies"
	@echo "Benchmark:       make benchmark-terminal → run Cocode through Harbor / Terminal-Bench"

# Anchor target so `make dev gui` runs the GUI dev server.
dev:
	@:

gui: gui-dev

gui-dev:
	cd cocode-gui && pnpm run dev

gui-build:
	cd cocode-gui && pnpm run make

gui-web:
	cd cocode-gui && pnpm run dev:web

tui:
	@$(MAKE) --no-print-directory tui-preflight
	cd cocode-tui && pnpm run dev

tui-preflight:
	@node cocode-tui/scripts/dev-preflight.mjs

dsh:
	cd $(DSH_DIR) && pnpm exec dsh web

install-gui:
	cd cocode-gui && pnpm install

install-tui:
	cd cocode-tui && pnpm install

install-dsh:
	cd $(DSH_DIR) && pnpm install

benchmark-terminal:
	bash benchmarks/harbor/run-terminal-bench.sh $(ARGS)
