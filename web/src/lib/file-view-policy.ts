export const MARKDOWN_FILE_EXTENSION = ".md";
export const PREVIEW_FILE_EXTENSIONS = [".txt", ".json", ".yaml", ".yml"] as const;
export const METADATA_FILE_EXTENSIONS = [".pdf", ".docx", ".pptx", ".xlsx"] as const;

const PREVIEW_EXTENSION_SET = new Set<string>([
  MARKDOWN_FILE_EXTENSION,
  ...PREVIEW_FILE_EXTENSIONS,
]);
const METADATA_EXTENSION_SET = new Set<string>(METADATA_FILE_EXTENSIONS);

export function getFileExtension(relativePath: string): string {
  const segments = relativePath.split(/[\\/]/);
  const lastSegment = segments[segments.length - 1] ?? "";
  const extensionStart = lastSegment.lastIndexOf(".");

  if (extensionStart === -1) {
    return "";
  }

  return lastSegment.slice(extensionStart).toLowerCase();
}

export function isMarkdownFileExtension(extension: string): boolean {
  return extension === MARKDOWN_FILE_EXTENSION;
}

export function isPreviewFileExtension(extension: string): boolean {
  return PREVIEW_EXTENSION_SET.has(extension);
}

export function isMetadataFileExtension(extension: string): boolean {
  return METADATA_EXTENSION_SET.has(extension);
}
