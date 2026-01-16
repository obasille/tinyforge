// Asset Loader Utility - Common functionality for loading game assets
// Shared between audio, sprites, and future asset types

/**
 * Utility class for loading assets with ID-based naming
 */
export class AssetLoader {
  /**
   * Extract numeric ID from filename (e.g., "0-player.png" -> 0)
   * Supports various separators: dash, underscore, space
   * Handles paths by extracting basename first
   */
  static extractId(filename) {
    // Extract basename from path (handle both / and \ separators)
    const basename = filename.split(/[\/\\]/).pop();
    const match = basename.match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : null;
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
      console.warn(`${type} ID ${id} already loaded, overwriting with ${url}`);
      return true;
    }
    return false;
  }

  /**
   * Load files from a directory with ID extraction and filtering
   * @param dirUrl - Directory URL to scan
   * @param filePattern - Regex pattern for file extensions
   * @param minId - Minimum allowed ID (default: 0)
   * @param maxId - Maximum allowed ID (default: 255)
   * @returns Array of {id, filename, url} objects
   */
  static async scanDirectory(dirUrl, filePattern, minId = 0, maxId = 255) {
    try {
      const response = await fetch(dirUrl);
      if (!response.ok) {
        return [];
      }

      const html = await response.text();
      const files = this.parseDirectoryListing(html, filePattern);
      
      const assets = [];
      for (const file of files) {
        const id = this.extractId(file);
        if (id !== null && id >= minId && id <= maxId) {
          assets.push({
            id,
            filename: file,
            url: `${dirUrl}${file}`
          });
        }
      }
      
      return assets;
    } catch (e) {
      console.warn(`Failed to scan directory ${dirUrl}:`, e.message);
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
