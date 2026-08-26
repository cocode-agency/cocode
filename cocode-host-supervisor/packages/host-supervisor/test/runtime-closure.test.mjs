import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
	copyRuntimeDependencyClosure,
	resolveRuntimeDependencyClosure,
	restoreRuntimeNodePtyHelpers,
} from '../lib/runtime-closure.mjs'

function writePackage(root, destination, manifest) {
	const packageRoot = path.join(root, ...destination.split('/'))
	mkdirSync(packageRoot, { recursive: true })
	writeFileSync(path.join(packageRoot, 'package.json'), `${JSON.stringify(manifest)}\n`)
	writeFileSync(path.join(packageRoot, 'index.js'), '')
	return packageRoot
}

function fixture() {
	const root = mkdtempSync(path.join(os.tmpdir(), 'cocode-runtime-closure-'))
	const source = path.join(root, 'source')
	const output = path.join(root, 'output')
	writePackage(source, 'root-package', {
		name: 'root-package',
		version: '1.0.0',
		dependencies: {
			'node-pty': '1.1.0',
			'plugin-local': '1.0.0',
		},
	})
	writePackage(source, 'node_modules/node-pty', {
		name: 'node-pty',
		version: '1.1.0',
	})
	writePackage(source, 'node_modules/plugin-local', {
		name: 'plugin-local',
		version: '1.0.0',
		dependencies: { 'node-pty': '1.2.0-beta.15' },
	})
	writePackage(source, 'node_modules/plugin-local/node_modules/node-pty', {
		name: 'node-pty',
		version: '1.2.0-beta.15',
	})
	return { root, source, output }
}

test('retains same-name dependencies at their resolved nested destinations', () => {
	const { root, source, output } = fixture()
	try {
		const records = resolveRuntimeDependencyClosure({
			roots: [{ root: path.join(source, 'root-package'), destinationSegments: [], copy: false }],
		})
		const nodePtyVersions = records
			.filter((record) => record.name === 'node-pty')
			.map((record) => `${record.destinationSegments.join('/')}=${record.version}`)
			.sort()
		assert.deepEqual(nodePtyVersions, [
			'node-pty=1.1.0',
			'plugin-local/node_modules/node-pty=1.2.0-beta.15',
		])

		copyRuntimeDependencyClosure({ records, targetModules: path.join(output, 'node_modules') })
		assert.equal(
			JSON.parse(readFileSync(path.join(output, 'node_modules/node-pty/package.json'))).version,
			'1.1.0',
		)
		assert.equal(
			JSON.parse(
				readFileSync(
					path.join(output, 'node_modules/plugin-local/node_modules/node-pty/package.json'),
				),
			).version,
			'1.2.0-beta.15',
		)

		const rootRequire = createRequire(path.join(output, 'package.json'))
		assert.equal(rootRequire.resolve('node-pty'), realpathSync(path.join(output, 'node_modules/node-pty/index.js')))
		const pluginRequire = createRequire(
			path.join(output, 'node_modules/plugin-local/package.json'),
		)
		assert.equal(
			pluginRequire.resolve('node-pty'),
			realpathSync(path.join(output, 'node_modules/plugin-local/node_modules/node-pty/index.js')),
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test('fails when two different packages claim the same destination', () => {
	const { root, source } = fixture()
	try {
		const first = path.join(source, 'node_modules/node-pty')
		assert.throws(
			() =>
				resolveRuntimeDependencyClosure({
					roots: [
						{ root: first, destinationSegments: ['node-pty'], copy: true },
						{ root: path.join(source, 'node_modules/plugin-local/node_modules/node-pty'), destinationSegments: ['node-pty'], copy: true },
					],
				}),
			/conflicting runtime closure destination/i,
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test('restores every node-pty helper only when active native files match the target architecture', () => {
	const root = mkdtempSync(path.join(os.tmpdir(), 'cocode-runtime-node-pty-helper-'))
	try {
		const packageRoot = writePackage(root, 'node_modules/node-pty', {
			name: 'node-pty',
			version: '1.1.0',
		})
		const nativeRoot = path.join(packageRoot, 'prebuilds', 'darwin-arm64')
		mkdirSync(nativeRoot, { recursive: true })
		writeFileSync(path.join(nativeRoot, 'pty.node'), machoThin(0x0100000c))
		writeFileSync(path.join(nativeRoot, 'spawn-helper'), machoThin(0x01000007))

		assert.throws(
			() => restoreRuntimeNodePtyHelpers(root, { platform: 'darwin', arch: 'arm64' }),
			/architecture mismatch.*darwin\/arm64/,
		)
		assert.equal(statSync(path.join(nativeRoot, 'spawn-helper')).mode & 0o111, 0o111)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

function machoThin(cputype) {
	const bytes = Buffer.alloc(32)
	bytes.writeUInt32LE(0xfeedfacf, 0)
	bytes.writeInt32LE(cputype, 4)
	return bytes
}
