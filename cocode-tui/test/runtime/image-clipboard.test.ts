import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  ClipboardImageError,
  MAX_CLIPBOARD_IMAGE_BYTES,
  clipboardImageCommands,
  detectImageMediaType,
  parseClipboardImagePaths,
  pastedImagePath,
  readClipboardImage,
} from '../../src/runtime/image-clipboard.ts'

const PNG = Buffer.from('iVBORw0KGgo=', 'base64')

describe('image clipboard', () => {
  it('detects supported raster signatures', () => {
    expect(detectImageMediaType(PNG)).toBe('image/png')
    expect(detectImageMediaType(Uint8Array.of(0xff, 0xd8, 0xff, 0x00))).toBe('image/jpeg')
    expect(detectImageMediaType(Buffer.from('GIF89a'))).toBe('image/gif')
    expect(detectImageMediaType(Buffer.from('not-an-image'))).toBeUndefined()
  })

  it('decodes the macOS base64 clipboard contract', async () => {
    const image = await readClipboardImage({
      platform: 'darwin',
      run: async () => Buffer.from(`image/png\n${PNG.toString('base64')}`),
    })
    expect(image.mediaType).toBe('image/png')
    expect(Buffer.from(image.data)).toEqual(PNG)
  })

  it('falls through Linux clipboard commands until an image is found', async () => {
    const calls: string[] = []
    const image = await readClipboardImage({
      platform: 'linux',
      run: async (command, args) => {
        calls.push(`${command} ${args.join(' ')}`)
        if (args.includes('image/png') && command === 'xclip') return PNG
        throw new Error('clipboard target unavailable')
      },
    })
    expect(image.mediaType).toBe('image/png')
    expect(calls[0]).toContain('text/uri-list')
    expect(calls.at(-1)).toContain('xclip -selection clipboard -t image/png -o')
  })

  it('reads an image file referenced by a Linux URI-list clipboard', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cocode-uri-image-'))
    const imagePath = join(directory, 'photo one.png')
    await writeFile(imagePath, PNG)
    try {
      const image = await readClipboardImage({
        platform: 'linux',
        run: async (command, args) => {
          if (command === 'wl-paste' && args.includes('text/uri-list')) {
            return Buffer.from(pathToFileURL(imagePath).href)
          }
          throw new Error('clipboard target unavailable')
        },
      })
      expect(image.mediaType).toBe('image/png')
      expect(Buffer.from(image.data)).toEqual(PNG)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('does not fall back to a bitmap when a Linux file list is present', async () => {
    await expect(readClipboardImage({
      platform: 'linux',
      run: async (command, args) => {
        if (command === 'wl-paste' && args.includes('text/uri-list')) {
          return Buffer.from('file:///tmp/missing-photo.png')
        }
        if (command === 'wl-paste' && args.includes('image/png')) return PNG
        throw new Error('clipboard target unavailable')
      },
    })).rejects.toMatchObject<Partial<ClipboardImageError>>({ code: 'empty' })
  })

  it('keeps the xsel binary fallback for image-only clipboards', async () => {
    const image = await readClipboardImage({
      platform: 'linux',
      run: async (command, _args, maxOutputBytes) => {
        if (command === 'xsel' && maxOutputBytes === MAX_CLIPBOARD_IMAGE_BYTES + 1) return PNG
        throw new Error('clipboard target unavailable')
      },
    })
    expect(image.mediaType).toBe('image/png')
    expect(Buffer.from(image.data)).toEqual(PNG)
  })

  it('recognizes image paths pasted by terminal image integrations', () => {
    expect(pastedImagePath('/tmp/screenshot.png', '/tmp')).toBe('/tmp/screenshot.png')
    expect(pastedImagePath('"/tmp/screenshot one.jpg"', '/tmp')).toBe('/tmp/screenshot one.jpg')
    expect(pastedImagePath('notes.txt', '/tmp')).toBeUndefined()
    expect(pastedImagePath('/tmp/missing.png\n', '/tmp')).toBe('/tmp/missing.png')
  })

  it('parses URI-list comments, GNOME actions, and URL-encoded image paths', () => {
    expect(parseClipboardImagePaths(Buffer.from('# comment\ncopy\nhttps://example.com/icon.png\nfile:///tmp/photo%20one\nfile:///tmp/photo%20one\n')))
      .toEqual(['/tmp/photo one'])
  })

  it('reports an unavailable clipboard implementation', async () => {
    await expect(readClipboardImage({
      platform: 'freebsd',
      run: async () => Buffer.alloc(0),
    })).rejects.toMatchObject<Partial<ClipboardImageError>>({ code: 'unavailable' })
  })

  it('defines native readers for macOS, Windows, and Linux', () => {
    const macos = clipboardImageCommands('darwin')[0]
    expect(macos?.command).toBe('osascript')
    const script = macos?.args.join('\n') ?? ''
    expect(script).toContain('public.tiff')
    expect(script).toContain('public.file-url')
    expect(script).toContain('pasteboard.pasteboardItems')
    expect(script).toContain("item.stringForType('public.file-url')")
    expect(script.indexOf('pasteboard.pasteboardItems')).toBeLessThan(script.indexOf('for (const [type'))
    expect(script).toContain('fileHandleWithStandardOutput.writeData')
    expect(clipboardImageCommands('win32').map((entry) => entry.command)).toEqual([
      'powershell.exe',
      'pwsh',
    ])
    const windowsScript = clipboardImageCommands('win32')[0]?.args.join('\n') ?? ''
    expect(windowsScript).toContain('ContainsFileDropList')
    expect(windowsScript).toContain('GetFileDropList')
    expect(windowsScript.indexOf('ContainsFileDropList')).toBeLessThan(windowsScript.indexOf('Clipboard]::GetImage'))
    expect(windowsScript).toContain('} else {')
    const linuxCommands = clipboardImageCommands('linux')
    expect(linuxCommands).toContainEqual({
      command: 'wl-paste',
      args: ['--no-newline', '--type', 'text/uri-list'],
      output: 'paths',
    })
    expect(linuxCommands).toContainEqual({
      command: 'wl-paste',
      args: ['--no-newline', '--type', 'x-special/gnome-copied-files'],
      output: 'paths',
    })
    expect(linuxCommands.findIndex((entry) => entry.output === 'paths'))
      .toBeLessThan(linuxCommands.findIndex((entry) => entry.output === 'binary'))
    expect(linuxCommands).toContainEqual({
      command: 'xsel',
      args: ['--clipboard', '--output'],
      output: 'binary',
    })
  })
})
