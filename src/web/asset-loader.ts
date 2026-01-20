// Asset Loader Utility - Common functionality for loading game assets
// Shared between audio, sprites, and future asset types

import { addConsoleEntry } from "./console-panel.js";

/**
 * Utility class for loading assets with ID-based naming
 */
export class AssetLoader {
  static MAX_ID_LENGTH = 16;
  /**
   * Parse asset filename into id/format/info parts.
   * Filename format: {id}~{format}-{info}.ext
   * Only id is required.
   */
  static parseAssetFilename(filename) {
    const basename = filename.split(/[\/\\]/).pop();
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
  static parseDirectoryListing(html, pattern) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const links = Array.from(doc.querySelectorAll('a'));
    return links
      .map(a => a.getAttribute('href'))
      .filter(href => href && pattern.test(href))
      .map(href => href.split(/[\/\\]/).pop()); // Remove path, keep only filename
  }

  /**
   * Check for duplicate IDs and log warning
   * @param collection - Map or Set containing existing IDs
   * @param id - ID to check
   * @param url - URL of the asset being loaded
   * @param type - Type of asset (for logging, e.g., 'Sprite', 'SFX')
   * @returns true if duplicate detected
   */
  static checkDuplicate(collection, id, url, type) {
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
  static async scanDirectory(dirUrl, filePattern, minId = null, maxId = null) {
    try {
      const response = await fetch(dirUrl);
      if (!response.ok) {
        return [];
      }

      const html = await response.text();
      const files = this.parseDirectoryListing(html, filePattern);
      
      const assets = [];
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
      addConsoleEntry('WARN', `Failed to scan directory ${dirUrl}: ${e.message}`);
      return [];
    }
  }

  /**
   * Load an image as a promise
   * @param url - Image URL
   * @returns Promise that resolves to HTMLImageElement
   */
  static loadImage(url) {
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
  static async fetchBinary(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.arrayBuffer();
  }
}
