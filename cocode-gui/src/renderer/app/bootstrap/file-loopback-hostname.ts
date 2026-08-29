const FILE_LOOPBACK_HOSTNAME = "127.0.0.1"

type HostnameCarrier = {
	protocol: string
	hostname: string
}

/**
 * Packaged Electron renders the client from `file://`, which has an empty
 * hostname. DSH connection treats only loopback hostnames as local, so the
 * desktop page must present as 127.0.0.1 before that plugin reads location.
 */
export function spoofFileLoopbackHostname(location: HostnameCarrier = window.location): void {
	if (location.protocol !== "file:") return
	const prototype = Object.getPrototypeOf(location) as object
	const descriptor =
		Object.getOwnPropertyDescriptor(prototype, "hostname") ??
		Object.getOwnPropertyDescriptor(location, "hostname")
	if (descriptor?.get === undefined) {
		Object.defineProperty(location, "hostname", {
			configurable: true,
			enumerable: true,
			get: () => FILE_LOOPBACK_HOSTNAME,
		})
		return
	}
	Object.defineProperty(prototype, "hostname", {
		configurable: true,
		enumerable: descriptor.enumerable ?? true,
		get(this: HostnameCarrier) {
			if (this.protocol === "file:") return FILE_LOOPBACK_HOSTNAME
			return descriptor.get!.call(this)
		},
	})
}
