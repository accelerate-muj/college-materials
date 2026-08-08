'use strict';

/**
 * Tests for src/pyq.js — the rules every other part of the archive defers to.
 *
 * Runs under `node tests/run.js` and in a browser via tests/index.html.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) factory(require('./harness.js'), require('../src/pyq.js'));
  else factory(root.TestHarness, root.PYQ);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (harness, PYQ) {
  const describe = harness.describe;
  const it = harness.it;
  const assert = harness.assert;

  const CATALOGUE = {
    years: [
      { id: 'first-year', name: 'First Year', semesters: [1, 2], branched: false },
      { id: 'second-year', name: 'Second Year', semesters: [3, 4], branched: true },
    ],
    branchGroups: [{ id: 'computing', name: 'Computing & IT' }],
    branches: [
      { id: 'cse', short: 'CSE', name: 'Computer Science & Engineering', group: 'computing' },
      { id: 'it', short: 'IT', name: 'Information Technology', group: 'computing' },
    ],
    examTypes: [{ id: 'MTE', name: 'Mid-Term' }, { id: 'ETE', name: 'End-Term' }],
  };

  const SECOND_YEAR = CATALOGUE.years[1];

  function validPaper(overrides) {
    return Object.assign(
      {
        id: 'cse-2024-mte-cs2001',
        subject: 'Data Structures and Algorithms',
        code: 'CS2001',
        semester: 3,
        exam: 'MTE',
        year: 2024,
        url: 'https://example.org/papers/cs2001-mte-2024.pdf',
      },
      overrides || {}
    );
  }

  function errorsFor(paper, context) {
    return PYQ.validatePaper(paper, Object.assign({ catalogue: CATALOGUE, year: SECOND_YEAR, currentYear: 2026 }, context || {}));
  }

  describe('collection keys', function () {
    it('names a branched collection year/branch', function () {
      assert.equal(PYQ.collectionKey('second-year', 'cse'), 'second-year/cse');
    });

    it('falls back to the common collection for an unbranched year', function () {
      assert.equal(PYQ.collectionKey('first-year', null), 'first-year/common');
    });

    it('derives the data path from the same key', function () {
      assert.equal(PYQ.collectionPath('second-year', 'it'), 'data/pyq/second-year/it.json');
    });
  });

  describe('expectedCollections', function () {
    const collections = PYQ.expectedCollections(CATALOGUE);

    it('gives an unbranched year exactly one collection', function () {
      const firstYear = collections.filter((collection) => collection.yearId === 'first-year');
      assert.equal(firstYear.length, 1);
      assert.equal(firstYear[0].key, 'first-year/common');
    });

    it('gives a branched year one collection per branch', function () {
      const secondYear = collections.filter((collection) => collection.yearId === 'second-year');
      assert.equal(secondYear.length, CATALOGUE.branches.length);
      assert.deepEqual(secondYear.map((collection) => collection.key), ['second-year/cse', 'second-year/it']);
    });
  });

  describe('validatePaper', function () {
    it('accepts a well-formed paper', function () {
      assert.deepEqual(errorsFor(validPaper()), []);
    });

    it('accepts a paper that ships a committed PDF instead of a link', function () {
      const paper = validPaper({ url: undefined, file: 'papers/second-year/cse/cs2001-mte-2024.pdf' });
      delete paper.url;
      assert.deepEqual(errorsFor(paper), []);
    });

    PYQ.REQUIRED_FIELDS.forEach(function (field) {
      it('rejects a paper missing ' + field, function () {
        const paper = validPaper();
        delete paper[field];
        const errors = errorsFor(paper);
        assert.ok(
          errors.some((error) => error.indexOf('"' + field + '"') !== -1),
          'expected an error naming ' + field + ', got: ' + errors.join('; ')
        );
      });
    });

    it('rejects an unknown field rather than silently dropping it', function () {
      const errors = errorsFor(validPaper({ uploadedBy: 'someone' }));
      assert.ok(errors.some((error) => error.indexOf('uploadedBy') !== -1), errors.join('; '));
    });

    it('rejects an id that is not a lowercase slug', function () {
      assert.ok(errorsFor(validPaper({ id: 'CSE 2024 MTE' })).length > 0);
      assert.ok(errorsFor(validPaper({ id: 'cse--2024' })).length > 0);
    });

    it('rejects an exam type the catalogue does not define', function () {
      const errors = errorsFor(validPaper({ exam: 'Viva' }));
      assert.ok(errors.some((error) => error.indexOf('Viva') !== -1), errors.join('; '));
    });

    it('rejects a semester that does not belong to the year', function () {
      const errors = errorsFor(validPaper({ semester: 5 }));
      assert.ok(errors.some((error) => error.indexOf('semester 5') !== -1), errors.join('; '));
    });

    it('rejects a year outside the plausible range', function () {
      assert.ok(errorsFor(validPaper({ year: 199 })).length > 0);
      assert.ok(errorsFor(validPaper({ year: 2099 })).length > 0);
    });

    it('accepts next year, because papers land before the calendar catches up', function () {
      assert.deepEqual(errorsFor(validPaper({ year: 2027 })), []);
    });

    it('requires either a url or a file', function () {
      const paper = validPaper();
      delete paper.url;
      const errors = errorsFor(paper);
      assert.ok(errors.some((error) => error.indexOf('url') !== -1 && error.indexOf('file') !== -1), errors.join('; '));
    });

    it('rejects a plain-http url', function () {
      assert.ok(errorsFor(validPaper({ url: 'http://example.org/paper.pdf' })).length > 0);
    });

    it('rejects a javascript: url', function () {
      assert.ok(errorsFor(validPaper({ url: 'javascript:alert(1)' })).length > 0);
    });

    it('rejects a file path that escapes the papers directory', function () {
      const paper = validPaper({ file: 'papers/../.github/workflows/ci.yml' });
      delete paper.url;
      assert.ok(errorsFor(paper).length > 0);
    });

    it('rejects a file path outside papers/', function () {
      const paper = validPaper({ file: 'src/pyq.js' });
      delete paper.url;
      assert.ok(errorsFor(paper).length > 0);
    });

    it('rejects a contributor that is not a GitHub handle', function () {
      assert.ok(errorsFor(validPaper({ contributor: 'someone@example.org' })).length > 0);
      assert.deepEqual(errorsFor(validPaper({ contributor: '@octocat' })), []);
    });

    it('reports every problem at once rather than stopping at the first', function () {
      const errors = errorsFor({ id: 'BAD ID', exam: 'Viva', year: 'last year' });
      assert.ok(errors.length >= 3, 'expected several errors, got: ' + errors.join('; '));
    });

    it('rejects a non-object', function () {
      assert.deepEqual(errorsFor(null), ['not an object']);
      assert.deepEqual(errorsFor([]), ['not an object']);
    });
  });

  describe('sortPapers', function () {
    it('puts the newest year first', function () {
      const sorted = PYQ.sortPapers([
        validPaper({ id: 'a', year: 2022 }),
        validPaper({ id: 'b', year: 2025 }),
        validPaper({ id: 'c', year: 2024 }),
      ]);
      assert.deepEqual(sorted.map((paper) => paper.id), ['b', 'c', 'a']);
    });

    it('breaks a tie on semester, then subject', function () {
      const sorted = PYQ.sortPapers([
        validPaper({ id: 'b', year: 2024, semester: 4, subject: 'Operating Systems' }),
        validPaper({ id: 'c', year: 2024, semester: 3, subject: 'Discrete Mathematics' }),
        validPaper({ id: 'a', year: 2024, semester: 3, subject: 'Algorithms' }),
      ]);
      assert.deepEqual(sorted.map((paper) => paper.id), ['a', 'c', 'b']);
    });

    it('does not mutate its input', function () {
      const papers = [validPaper({ id: 'a', year: 2022 }), validPaper({ id: 'b', year: 2025 })];
      PYQ.sortPapers(papers);
      assert.deepEqual(papers.map((paper) => paper.id), ['a', 'b']);
    });
  });

  describe('groupBySubject', function () {
    it('collects every paper for one subject under a single entry', function () {
      const groups = PYQ.groupBySubject([
        validPaper({ id: 'a', code: 'CS2001', year: 2024, exam: 'MTE' }),
        validPaper({ id: 'b', code: 'CS2001', year: 2023, exam: 'ETE' }),
        validPaper({ id: 'c', code: 'CS2002', subject: 'Operating Systems', year: 2024 }),
      ]);

      assert.equal(groups.length, 2);
      assert.equal(groups[0].code, 'CS2001');
      assert.equal(groups[0].papers.length, 2);
    });

    it('matches subject codes that differ only by whitespace', function () {
      const groups = PYQ.groupBySubject([
        validPaper({ id: 'a', code: 'CS 2001' }),
        validPaper({ id: 'b', code: 'CS2001', year: 2023 }),
      ]);
      assert.equal(groups.length, 1);
    });

    it('falls back to the subject name when there is no code', function () {
      const papers = [validPaper({ id: 'a', subject: 'Engineering Physics' }), validPaper({ id: 'b', subject: 'engineering physics', year: 2023 })];
      papers.forEach((paper) => delete paper.code);
      assert.equal(PYQ.groupBySubject(papers).length, 1);
    });
  });

  describe('paperHref', function () {
    it('prefers an external url', function () {
      assert.equal(PYQ.paperHref(validPaper(), '../'), 'https://example.org/papers/cs2001-mte-2024.pdf');
    });

    it('resolves a committed file against the site root', function () {
      const paper = validPaper({ file: 'papers/second-year/cse/x.pdf' });
      delete paper.url;
      assert.equal(PYQ.paperHref(paper, '../'), '../papers/second-year/cse/x.pdf');
    });
  });
});
