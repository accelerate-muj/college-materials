'use strict';

/**
 * A minimal PDF writer: JPEG pages in, one PDF out.
 *
 * The scanner produces JPEGs from a canvas and the archive stores PDFs, so
 * something has to join them. Every library that does this is a CDN script or
 * an npm install, and this repository has neither by design — so here is the
 * ~1% of the PDF spec that the job actually needs.
 *
 * A JPEG can be embedded in a PDF verbatim: the /DCTDecode filter means "this
 * stream is a JPEG, decode it yourself". No re-encoding, no pixel handling, no
 * quality loss. What is left is bookkeeping — objects, byte offsets, an xref
 * table — which is what this file is.
 *
 * Pages are A4, with each image scaled to fit and centred.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PDFWriter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // A4 at 72 points per inch.
  const PAGE_WIDTH = 595.28;
  const PAGE_HEIGHT = 841.89;

  /**
   * PDF strings are byte strings, not Unicode. Everything this file writes is
   * ASCII, so latin1 is exact and avoids dragging in a TextEncoder.
   */
  function latin1(text) {
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i += 1) {
      bytes[i] = text.charCodeAt(i) & 0xff;
    }
    return bytes;
  }

  /** Trailing zeros in a PDF number are legal but noisy; 2dp is plenty at 72dpi. */
  function num(value) {
    return (Math.round(value * 100) / 100).toString();
  }

  /**
   * Collects chunks and tracks the running byte offset, because the xref table
   * at the end of a PDF is a list of byte positions and getting one wrong makes
   * the whole file unreadable.
   */
  function ByteBuilder() {
    this.chunks = [];
    this.length = 0;
  }

  ByteBuilder.prototype.push = function (chunk) {
    const bytes = typeof chunk === 'string' ? latin1(chunk) : chunk;
    this.chunks.push(bytes);
    this.length += bytes.length;
    return this;
  };

  ByteBuilder.prototype.toUint8Array = function () {
    const out = new Uint8Array(this.length);
    let offset = 0;
    this.chunks.forEach(function (chunk) {
      out.set(chunk, offset);
      offset += chunk.length;
    });
    return out;
  };

  /** Scale to fit the page, preserving aspect, centred. */
  function placement(width, height) {
    const scale = Math.min(PAGE_WIDTH / width, PAGE_HEIGHT / height);
    const drawWidth = width * scale;
    const drawHeight = height * scale;
    return {
      width: drawWidth,
      height: drawHeight,
      x: (PAGE_WIDTH - drawWidth) / 2,
      y: (PAGE_HEIGHT - drawHeight) / 2,
    };
  }

  /**
   * Builds a PDF from JPEG pages.
   *
   * `pages` is an array of { data: Uint8Array, width, height } — data being the
   * raw JPEG bytes, width/height its pixel dimensions.
   *
   * Returns a Uint8Array. Throws on an empty or malformed page list rather than
   * emitting a PDF that no reader will open.
   */
  function build(pages, options) {
    if (!Array.isArray(pages) || pages.length === 0) {
      throw new Error('A PDF needs at least one page.');
    }

    pages.forEach(function (page, index) {
      if (!page || !(page.data instanceof Uint8Array) || page.data.length === 0) {
        throw new Error('Page ' + (index + 1) + ' has no image data.');
      }
      if (!(page.width > 0) || !(page.height > 0)) {
        throw new Error('Page ' + (index + 1) + ' has no dimensions.');
      }
    });

    const settings = options || {};

    // Object 1 is the catalog, 2 the page tree, then three objects per page.
    const objectCount = 2 + pages.length * 3 + (settings.title ? 1 : 0);
    const offsets = new Array(objectCount + 1).fill(0);
    const out = new ByteBuilder();

    function beginObject(id) {
      offsets[id] = out.length;
      out.push(id + ' 0 obj\n');
    }

    function endObject() {
      out.push('endobj\n');
    }

    out.push('%PDF-1.4\n');
    // A comment with high bytes marks the file as binary, so tools that guess
    // at text-vs-binary do not mangle the JPEG streams.
    out.push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

    const infoId = settings.title ? objectCount : 0;

    beginObject(1);
    out.push('<< /Type /Catalog /Pages 2 0 R >>\n');
    endObject();

    const kids = pages
      .map(function (_, index) {
        return 3 + index * 3 + ' 0 R';
      })
      .join(' ');

    beginObject(2);
    out.push('<< /Type /Pages /Kids [' + kids + '] /Count ' + pages.length + ' >>\n');
    endObject();

    pages.forEach(function (page, index) {
      const pageId = 3 + index * 3;
      const contentsId = pageId + 1;
      const imageId = pageId + 2;
      const box = placement(page.width, page.height);

      beginObject(pageId);
      out.push(
        '<< /Type /Page /Parent 2 0 R ' +
          '/MediaBox [0 0 ' + num(PAGE_WIDTH) + ' ' + num(PAGE_HEIGHT) + '] ' +
          '/Resources << /XObject << /Im0 ' + imageId + ' 0 R >> >> ' +
          '/Contents ' + contentsId + ' 0 R >>\n'
      );
      endObject();

      // "cm" sets the transform; an image XObject draws into the unit square,
      // so the matrix is literally the on-page width, height and position.
      const content =
        'q\n' +
        num(box.width) + ' 0 0 ' + num(box.height) + ' ' + num(box.x) + ' ' + num(box.y) + ' cm\n' +
        '/Im0 Do\n' +
        'Q\n';

      beginObject(contentsId);
      out.push('<< /Length ' + content.length + ' >>\nstream\n');
      out.push(content);
      out.push('endstream\n');
      endObject();

      beginObject(imageId);
      out.push(
        '<< /Type /XObject /Subtype /Image ' +
          '/Width ' + page.width + ' /Height ' + page.height + ' ' +
          '/ColorSpace /DeviceRGB /BitsPerComponent 8 ' +
          '/Filter /DCTDecode /Length ' + page.data.length + ' >>\nstream\n'
      );
      out.push(page.data);
      out.push('\nendstream\n');
      endObject();
    });

    if (infoId) {
      // Parentheses and backslashes are the only characters that need escaping
      // inside a PDF literal string.
      const title = String(settings.title).replace(/([\\()])/g, '\\$1');
      beginObject(infoId);
      out.push('<< /Title (' + title + ') /Producer (accelerate-muj/college-materials) >>\n');
      endObject();
    }

    const xrefOffset = out.length;

    out.push('xref\n0 ' + (objectCount + 1) + '\n');
    out.push('0000000000 65535 f \n');
    for (let id = 1; id <= objectCount; id += 1) {
      // Exactly 20 bytes per entry, or readers lose their place.
      out.push(String(offsets[id]).padStart(10, '0') + ' 00000 n \n');
    }

    out.push(
      'trailer\n<< /Size ' + (objectCount + 1) + ' /Root 1 0 R' +
        (infoId ? ' /Info ' + infoId + ' 0 R' : '') +
        ' >>\n'
    );
    out.push('startxref\n' + xrefOffset + '\n%%EOF\n');

    return out.toUint8Array();
  }

  return {
    PAGE_WIDTH: PAGE_WIDTH,
    PAGE_HEIGHT: PAGE_HEIGHT,
    build: build,
    placement: placement,
    _latin1: latin1,
  };
});
