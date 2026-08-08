'use strict';

/**
 * The PYQ archive's rules, as pure functions.
 *
 * Nothing here touches the DOM, the filesystem, or any global state, which is
 * what lets the same file be the single source of truth for four callers that
 * otherwise share nothing:
 *
 *   build.js                     bakes data/ into pyq/data.js
 *   .github/scripts/validate-data.js   the CI gate over committed data
 *   tests/pyq.test.js            runs in Node and in a browser
 *   pyq/app.js                   the site itself
 *
 * Restating "what a valid paper looks like" in each of those would let them
 * drift, and the copy that guards contributions is the one that must not.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PYQ = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DATA_DIR = 'data/pyq';
  const COMMON_COLLECTION = 'common';

  /** Fields a paper record may carry. Anything else is rejected, not ignored. */
  const KNOWN_FIELDS = ['id', 'subject', 'code', 'semester', 'exam', 'year', 'url', 'file', 'pages', 'contributor', 'notes'];
  const REQUIRED_FIELDS = ['id', 'subject', 'exam', 'year'];

  /**
   * The oldest paper year we will accept. Papers predate the archive, but a
   * three-digit year is a typo rather than a genuinely old paper.
   */
  const EARLIEST_YEAR = 2010;

  /** Ids are used in URLs and as filenames, so keep them boring. */
  const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  /** Contributor handles are rendered as links to github.com/<handle>. */
  const HANDLE_PATTERN = /^@[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

  /**
   * Repo-relative paths only, and only under the archive's own directory.
   * Without the containment check a record could point the site at any file in
   * the repository, and `..` segments would let it escape entirely.
   */
  const FILE_PATTERN = /^papers\/[A-Za-z0-9._/-]+\.pdf$/;

  function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function isInteger(value) {
    return typeof value === 'number' && Number.isInteger(value);
  }

  /**
   * The storage key for one collection of papers: "second-year/cse", or
   * "first-year/common" for an unbranched year. Also the path under data/pyq,
   * minus the .json — one concept, so it is derived in one place.
   */
  function collectionKey(yearId, branchId) {
    return yearId + '/' + (branchId || COMMON_COLLECTION);
  }

  function collectionPath(yearId, branchId) {
    return DATA_DIR + '/' + collectionKey(yearId, branchId) + '.json';
  }

  /** Every collection the catalogue implies, whether or not a file exists yet. */
  function expectedCollections(catalogue) {
    const collections = [];
    catalogue.years.forEach(function (year) {
      if (!year.branched) {
        collections.push({ yearId: year.id, branchId: null, key: collectionKey(year.id, null) });
        return;
      }
      catalogue.branches.forEach(function (branch) {
        collections.push({ yearId: year.id, branchId: branch.id, key: collectionKey(year.id, branch.id) });
      });
    });
    return collections;
  }

  /**
   * Checks one paper record against the catalogue it belongs to.
   *
   * Returns an array of human-readable problems — empty means valid. Returning
   * every problem at once rather than throwing on the first keeps a contributor
   * from playing whack-a-mole across repeated CI runs.
   */
  function validatePaper(paper, context) {
    const errors = [];
    const catalogue = (context && context.catalogue) || { examTypes: [] };
    const year = context && context.year;

    if (!isPlainObject(paper)) return ['not an object'];

    REQUIRED_FIELDS.forEach(function (field) {
      if (paper[field] === undefined || paper[field] === null || paper[field] === '') {
        errors.push('missing required field "' + field + '"');
      }
    });

    Object.keys(paper).forEach(function (field) {
      if (KNOWN_FIELDS.indexOf(field) === -1) {
        errors.push('unknown field "' + field + '" (allowed: ' + KNOWN_FIELDS.join(', ') + ')');
      }
    });

    if (paper.id !== undefined && !ID_PATTERN.test(String(paper.id))) {
      errors.push('id "' + paper.id + '" must be lowercase letters, digits and single hyphens');
    }

    if (paper.subject !== undefined && typeof paper.subject !== 'string') {
      errors.push('subject must be a string');
    } else if (typeof paper.subject === 'string' && paper.subject.trim().length > 120) {
      errors.push('subject is longer than 120 characters');
    }

    if (paper.code !== undefined && !/^[A-Z]{2,4}\s?\d{3,4}$/.test(String(paper.code))) {
      errors.push('code "' + paper.code + '" does not look like a subject code (e.g. "CS2001")');
    }

    const examIds = (catalogue.examTypes || []).map(function (type) {
      return type.id;
    });
    if (paper.exam !== undefined && examIds.indexOf(paper.exam) === -1) {
      errors.push('exam "' + paper.exam + '" is not one of: ' + examIds.join(', '));
    }

    const currentYear = (context && context.currentYear) || new Date().getUTCFullYear();
    if (paper.year !== undefined) {
      if (!isInteger(paper.year)) {
        errors.push('year must be a whole number');
      } else if (paper.year < EARLIEST_YEAR || paper.year > currentYear + 1) {
        errors.push('year ' + paper.year + ' is outside ' + EARLIEST_YEAR + '–' + (currentYear + 1));
      }
    }

    if (paper.semester !== undefined) {
      if (!isInteger(paper.semester)) {
        errors.push('semester must be a whole number');
      } else if (year && year.semesters && year.semesters.indexOf(paper.semester) === -1) {
        errors.push('semester ' + paper.semester + ' is not part of ' + year.name + ' (expected ' + year.semesters.join(' or ') + ')');
      }
    }

    if (paper.url === undefined && paper.file === undefined) {
      errors.push('needs either "url" (a link to the paper) or "file" (a PDF committed under papers/)');
    }

    if (paper.url !== undefined && !/^https:\/\/[^\s]+$/.test(String(paper.url))) {
      errors.push('url must be an https:// link');
    }

    if (paper.file !== undefined && !FILE_PATTERN.test(String(paper.file))) {
      errors.push('file "' + paper.file + '" must be a .pdf path under papers/');
    }

    if (paper.pages !== undefined && (!isInteger(paper.pages) || paper.pages < 1)) {
      errors.push('pages must be a positive whole number');
    }

    if (paper.contributor !== undefined && !HANDLE_PATTERN.test(String(paper.contributor))) {
      errors.push('contributor "' + paper.contributor + '" must be a GitHub handle like "@octocat"');
    }

    if (paper.notes !== undefined && String(paper.notes).length > 280) {
      errors.push('notes is longer than 280 characters');
    }

    return errors;
  }

  /**
   * Newest first, then by semester, then alphabetically — the order a student
   * scanning for "last year's paper" actually wants.
   */
  function sortPapers(papers) {
    return papers.slice().sort(function (a, b) {
      if (a.year !== b.year) return b.year - a.year;
      const semesterA = a.semester || 0;
      const semesterB = b.semester || 0;
      if (semesterA !== semesterB) return semesterA - semesterB;
      return String(a.subject).localeCompare(String(b.subject));
    });
  }

  /** Groups papers by subject, for the per-subject cards the site renders. */
  function groupBySubject(papers) {
    const order = [];
    const bySubject = new Map();

    sortPapers(papers).forEach(function (paper) {
      const key = paper.code ? String(paper.code).replace(/\s+/g, '') : String(paper.subject).toLowerCase();
      if (!bySubject.has(key)) {
        bySubject.set(key, { key: key, subject: paper.subject, code: paper.code || null, papers: [] });
        order.push(key);
      }
      bySubject.get(key).papers.push(paper);
    });

    return order.map(function (key) {
      return bySubject.get(key);
    });
  }

  /** Where a paper actually lives, resolved relative to the site root. */
  function paperHref(paper, rootPrefix) {
    if (paper.url) return paper.url;
    return (rootPrefix || '') + paper.file;
  }

  return {
    DATA_DIR: DATA_DIR,
    COMMON_COLLECTION: COMMON_COLLECTION,
    EARLIEST_YEAR: EARLIEST_YEAR,
    KNOWN_FIELDS: KNOWN_FIELDS,
    REQUIRED_FIELDS: REQUIRED_FIELDS,
    collectionKey: collectionKey,
    collectionPath: collectionPath,
    expectedCollections: expectedCollections,
    validatePaper: validatePaper,
    sortPapers: sortPapers,
    groupBySubject: groupBySubject,
    paperHref: paperHref,
  };
});
