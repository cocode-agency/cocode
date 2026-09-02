import { clientBundle } from "../tsdown.client.ts"

export default clientBundle("cocode-workbench", ["src/index.ts", "src/file-search-worker.ts"], {
  // The Host runtime stages plugins into a self-contained package tree. Keep
  // Word conversion inside the plugin artifact so production does not depend
  // on package-manager hoisting or a system Office installation.
  lib: {
    deps: {
      alwaysBundle: ["html-to-docx", "mammoth"],
    },
  },
})
