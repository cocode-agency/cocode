/**
 * Host half: no host-side behavior — the entry exists so DSH mounts it and
 * the client-modules node half can scan this package's dsh.client declaration
 * into the web boot roster.
 */
export const name = "cocode-input-history"

export function apply(_ctx: unknown): void {
  // Nothing to do on the host; the feature lives in the browser client half.
}
