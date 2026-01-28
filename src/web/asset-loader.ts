// Asset Loader Utility - Common functionality for loading game assets
// Shared between audio, sprites, and future asset types

import { addConsoleEntry } from "./console-panel.js";

export type AssetDescriptor = {
  id: string;
  format: string;
  info: string;
  filename: string;
  url: string;
};

type ParsedAsset = {
  id: string;
  format: string;
  info: string;
};

type IdCollection = { has(id: string): boolean };

/**
 * Utility class for loading assets with ID-based naming
 */
export class AssetLoader {
  public static readonly MAX_ID_LENGTH = 16;
  /**
   * Parse asset filename into id/format/info parts.
   * Filename format: {id}~{format}-{info}.ext
   * Only id is required.
   */
  public static parseAssetFilename(filename: string): ParsedAsset | null {
    const basename = filename.split(/[\/\\]/).pop();
    if (!basename) return null;
    let decoded = basename;
    try {
      decoded = decodeURIComponent(basename);
    } catch {
      // Keep original if decoding fails
    }
    const name = decoded.replace(/\.[^/.]+$/, '');

    let id = name;
    let format = '';
    let info = '';

    const tildeIndex = name.indexOf('~');
    const dashIndex = name.indexOf('-');

    if (tildeIndex >= 0) {
      id = name.slice(0, tildeIndex);
      const remainder = name.slice(tildeIndex + 1);
      const remainderDash = remainder.indexOf('-');
      if (remainderDash >= 0) {
        format = remainder.slice(0, remainderDash);
        info = remainder.slice(remainderDash + 1);
      } else {
        format = remainder;
      }
    } else if (dashIndex >= 0) {
      id = name.slice(0, dashIndex);
      info = name.slice(dashIndex + 1);
    }

    if (!id) return null;
    return { id, format, info };
  }

  /**
   * Parse directory listing HTML to extract filenames
   * @param html - HTML content from directory listing
   * @param pattern - Regex pattern to filter files (e.g., /\.(png|jpg)$/i)
   * @returns Array of matching filenames
   */
  public static parseDirectoryListing(html: string, pattern: RegExp): string[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const links = Array.from(doc.querySelectorAll('a'));
    return links
      .map((a) => a.getAttribute('href'))
      .filter((href): href is string => Boolean(href && pattern.test(href)))
      .map((href) => href.split(/[\/\\]/).pop())
      .filter((href): href is string => Boolean(href)); // Remove path, keep only filename
  }

  /**
   * Check for duplicate IDs and log warning
   * @param collection - Map or Set containing existing IDs
   * @param id - ID to check
   * @param url - URL of the asset being loaded
   * @param type - Type of asset (for logging, e.g., 'Sprite', 'SFX')
   * @returns true if duplicate detected
   */
  public static checkDuplicate(collection: IdCollection, id: string, url: string, type: string): boolean {
    if (collection.has(id)) {
      addConsoleEntry('WARN', `${type} ID ${id} already loaded, overwriting with ${url}`);
      return true;
    }
    return false;
  }

  /**
   * Load files from a directory with ID extraction and filtering
   * @param dirUrl - Directory URL to scan
   * @param filePattern - Regex pattern for file extensions
   * @param minId - Minimum allowed numeric ID (optional)
   * @param maxId - Maximum allowed numeric ID (optional)
   * @returns Array of {id, format, info, filename, url} objects
   */
  public static async scanDirectory(
    dirUrl: string,
    filePattern: RegExp,
    minId: number | null = null,
    maxId: number | null = null
  ): Promise<AssetDescriptor[]> {
    try {
      const response = await fetch(dirUrl);
      if (!response.ok) {
        return [];
      }

      const html = await response.text();
      const files = this.parseDirectoryListing(html, filePattern);
      
      const assets: AssetDescriptor[] = [];
      for (const file of files) {
        const parsed = this.parseAssetFilename(file);
        if (!parsed) continue;
        if (parsed.id.length > this.MAX_ID_LENGTH) {
          addConsoleEntry('WARN', `Asset ID "${parsed.id}" exceeds ${this.MAX_ID_LENGTH} characters, skipping ${file}`);
          continue;
        }

        if (minId !== null || maxId !== null) {
          const numericId = parseInt(parsed.id, 10);
          if (Number.isNaN(numericId)) continue;
          if (minId !== null && numericId < minId) continue;
          if (maxId !== null && numericId > maxId) continue;
        }

        assets.push({
          id: parsed.id,
          format: parsed.format,
          info: parsed.info,
          filename: file,
          url: `${dirUrl}${file}`
        });
      }
      
      return assets;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      addConsoleEntry('WARN', `Failed to scan directory ${dirUrl}: ${message}`);
      return [];
    }
  }

  /**
   * Load an image as a promise
   * @param url - Image URL
   * @returns Promise that resolves to HTMLImageElement
   */
  public static loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
      img.src = url;
    });
  }

  /**
   * Fetch binary data from URL
   * @param url - Resource URL
   * @returns Promise that resolves to ArrayBuffer
   */
  public static async fetchBinary(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.arrayBuffer();
  }
}
