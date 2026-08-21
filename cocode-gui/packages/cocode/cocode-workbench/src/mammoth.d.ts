/**
 * Ambient declarations for mammoth (pure-JS DOCX -> HTML fallback when
 * LibreOffice is absent). Covers exactly the surface word-document.ts uses;
 * keep in sync with the real package API if usage grows.
 */
declare module "mammoth" {
  namespace images {
    interface ImageElement {
      readonly contentType: string
      readAsBase64String(): Promise<string>
    }

    interface ImageConverter {
      [key: string]: unknown
    }

    function imgElement(
      handler: (image: ImageElement) => Promise<{ readonly src: string }>,
    ): ImageConverter
  }

  interface ConvertToHtmlOptions {
    readonly styleMap?: string
    readonly includeDefaultStyleMap?: boolean
    readonly includeEmbeddedStyleMap?: boolean
    readonly ignoreEmptyParagraphs?: boolean
    readonly externalFileAccess?: boolean
    readonly convertImage?: images.ImageConverter
  }

  interface ConvertResult {
    readonly value: string
    readonly messages: readonly { readonly message: string }[]
  }

  function convertToHtml(
    input: { readonly buffer: Buffer },
    options?: ConvertToHtmlOptions,
  ): Promise<ConvertResult>

  const mammoth: {
    convertToHtml: typeof convertToHtml
    images: typeof images
  }

  export default mammoth
}
