'use strict';

/** Tests for src/pdf.js. */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) factory(require('./harness.js'), require('../src/pdf.js'));
  else factory(root.TestHarness, root.PDFWriter);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (harness, PDFWriter) {
  const describe = harness.describe;
  const it = harness.it;
  const assert = harness.assert;

  /** Not a real JPEG — the writer embeds bytes verbatim and never decodes them. */
  function fakeJpeg(length) {
    const data = new Uint8Array(length || 32);
    data[0] = 0xff;
    data[1] = 0xd8;
    for (let i = 2; i < data.length; i += 1) data[i] = i & 0xff;
    return data;
  }

  function page(width, height, length) {
    return { data: fakeJpeg(length), width: width || 1000, height: height || 1400 };
  }

  function asText(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
    return out;
  }

  describe('build', function () {
    it('produces something that starts and ends like a PDF', function () {
      const text = asText(PDFWriter.build([page()]));
      assert.equal(text.slice(0, 8), '%PDF-1.4');
      assert.ok(/%%EOF\n$/.test(text), 'should end with %%EOF');
    });

    it('rejects an empty page list', function () {
      assert.throws(function () {
        PDFWriter.build([]);
      }, /at least one page/);
    });

    it('rejects a page with no image data', function () {
      assert.throws(function () {
        PDFWriter.build([{ data: new Uint8Array(0), width: 10, height: 10 }]);
      }, /no image data/);
    });

    it('rejects a page with no dimensions', function () {
      assert.throws(function () {
        PDFWriter.build([{ data: fakeJpeg(), width: 0, height: 10 }]);
      }, /no dimensions/);
    });

    it('declares one page object per image', function () {
      const text = asText(PDFWriter.build([page(), page(), page()]));
      assert.equal(text.match(/\/Type \/Page[^s]/g).length, 3);
      assert.ok(text.indexOf('/Count 3') !== -1, 'page tree should count 3');
    });

    it('embeds the JPEG bytes verbatim with DCTDecode', function () {
      const data = fakeJpeg(64);
      const text = asText(PDFWriter.build([{ data: data, width: 100, height: 100 }]));
      assert.ok(text.indexOf('/Filter /DCTDecode') !== -1, 'should use DCTDecode');
      assert.ok(text.indexOf('/Length ' + data.length) !== -1, 'stream length should match the JPEG');
      assert.ok(text.indexOf(asText(data)) !== -1, 'the JPEG bytes should appear unchanged');
    });

    /*
     * The xref table is a list of byte offsets. If one is wrong the file opens
     * as a blank page or not at all, and nothing else in the output looks
     * suspicious — so it is worth checking the offsets actually point at the
     * objects they claim.
     */
    it('writes an xref table whose offsets land on their objects', function () {
      const bytes = PDFWriter.build([page(), page()]);
      const text = asText(bytes);

      // Match the table keyword on its own line — a bare lastIndexOf('xref')
      // finds the one inside "startxref" instead.
      const xrefMatch = /\nxref\n/.exec(text);
      assert.ok(xrefMatch, 'should contain an xref table');
      const xrefStart = xrefMatch.index + 1;

      const startxref = Number(text.match(/startxref\n(\d+)\n/)[1]);
      assert.equal(startxref, xrefStart, 'startxref should point at the xref table');

      const entries = text.slice(xrefStart).match(/^(\d{10}) 00000 n $/gm) || [];
      assert.equal(entries.length, 8, 'two pages means eight objects');

      entries.forEach(function (entry, index) {
        const offset = Number(entry.slice(0, 10));
        const declared = text.slice(offset, offset + 20);
        assert.ok(
          declared.indexOf(index + 1 + ' 0 obj') === 0,
          'entry ' + (index + 1) + ' should point at object ' + (index + 1) + ', found ' + JSON.stringify(declared)
        );
      });
    });

    it('adds an Info object only when a title is given', function () {
      assert.ok(asText(PDFWriter.build([page()])).indexOf('/Info') === -1);
      const titled = asText(PDFWriter.build([page()], { title: 'CS2001 MTE 2024' }));
      assert.ok(titled.indexOf('/Info') !== -1);
      assert.ok(titled.indexOf('(CS2001 MTE 2024)') !== -1);
    });

    it('escapes parentheses in the title rather than corrupting the object', function () {
      const text = asText(PDFWriter.build([page()], { title: 'Maths (Set A)' }));
      assert.ok(text.indexOf('(Maths \\(Set A\\))') !== -1, 'parentheses should be escaped');
    });
  });

  describe('placement', function () {
    it('fits a portrait image to the page height', function () {
      const box = PDFWriter.placement(1000, 2000);
      assert.ok(Math.abs(box.height - PDFWriter.PAGE_HEIGHT) < 0.01, 'should be full height');
      assert.ok(box.width <= PDFWriter.PAGE_WIDTH + 0.01, 'should fit the width');
    });

    it('fits a landscape image to the page width', function () {
      const box = PDFWriter.placement(2000, 500);
      assert.ok(Math.abs(box.width - PDFWriter.PAGE_WIDTH) < 0.01, 'should be full width');
      assert.ok(box.height <= PDFWriter.PAGE_HEIGHT + 0.01, 'should fit the height');
    });

    it('centres what it scales', function () {
      const box = PDFWriter.placement(1000, 500);
      assert.ok(Math.abs(box.x * 2 + box.width - PDFWriter.PAGE_WIDTH) < 0.01, 'equal side margins');
      assert.ok(Math.abs(box.y * 2 + box.height - PDFWriter.PAGE_HEIGHT) < 0.01, 'equal top/bottom margins');
    });

    it('never scales an image beyond the page', function () {
      const box = PDFWriter.placement(20000, 20000);
      assert.ok(box.width <= PDFWriter.PAGE_WIDTH + 0.01);
      assert.ok(box.height <= PDFWriter.PAGE_HEIGHT + 0.01);
    });
  });
});
