'use strict';

/**
 * Tests for src/submission.js.
 *
 * These matter more than most: parseBody and findAttachment read text that
 * anyone on the internet can write into an issue, and the workflow that acts
 * on the result holds a token with write access.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) factory(require('./harness.js'), require('../src/submission.js'));
  else factory(root.TestHarness, root.Submission);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (harness, Submission) {
  const describe = harness.describe;
  const it = harness.it;
  const assert = harness.assert;

  const CATALOGUE = {
    years: [
      { id: 'first-year', name: 'First Year', semesters: [1, 2], branched: false },
      { id: 'second-year', name: 'Second Year', semesters: [3, 4], branched: true },
    ],
    branchGroups: [{ id: 'computing', name: 'Computing & IT' }],
    branches: [{ id: 'cse', short: 'CSE', name: 'Computer Science & Engineering', group: 'computing' }],
    examTypes: [{ id: 'MTE', name: 'Mid-Term' }, { id: 'ETE', name: 'End-Term' }],
  };

  const CONTEXT = { catalogue: CATALOGUE, currentYear: 2026 };

  function submission(overrides) {
    return Object.assign(
      {
        year: 'second-year',
        branch: 'cse',
        yearName: 'Second Year',
        branchName: 'Computer Science & Engineering',
        paper: {
          id: 'cse-2024-mte-cs2001',
          subject: 'Data Structures and Algorithms',
          code: 'CS2001',
          semester: 3,
          exam: 'MTE',
          year: 2024,
          contributor: '@octocat',
        },
      },
      overrides || {}
    );
  }

  describe('buildBody / parseBody round trip', function () {
    it('reads back what it wrote', function () {
      const result = Submission.parseBody(Submission.buildBody(submission()), CONTEXT);
      assert.ok(result.ok, JSON.stringify(result.errors));
      assert.equal(result.submission.year.id, 'second-year');
      assert.equal(result.submission.branch.id, 'cse');
      assert.equal(result.submission.paper.code, 'CS2001');
    });

    it('round trips an unbranched year', function () {
      const body = Submission.buildBody(submission({ year: 'first-year', branch: null, paper: {
        id: 'fy-2024-mte-ph1001', subject: 'Engineering Physics', code: 'PH1001',
        semester: 1, exam: 'MTE', year: 2024,
      } }));
      const result = Submission.parseBody(body, CONTEXT);
      assert.ok(result.ok, JSON.stringify(result.errors));
      assert.equal(result.submission.branch, null);
    });

    it('tells a human what the paper is without reading the JSON', function () {
      const body = Submission.buildBody(submission());
      assert.ok(body.indexOf('Data Structures and Algorithms') !== -1);
      assert.ok(body.indexOf('Attach the PDF below') !== -1);
    });

    it('escapes a pipe so it cannot break out of the summary table', function () {
      const body = Submission.buildBody(submission({ paper: Object.assign(submission().paper, { subject: 'A | B' }) }));
      assert.ok(body.indexOf('A \\| B') !== -1);
    });

    it('titles the issue after the paper', function () {
      assert.equal(Submission.buildTitle(submission()), 'Paper: CS2001 MTE 2024');
    });
  });

  describe('parseBody rejections', function () {
    it('ignores an issue with no submission block', function () {
      const result = Submission.parseBody('Just a normal bug report.', CONTEXT);
      assert.ok(!result.ok);
      assert.ok(result.errors[0].indexOf('does not contain a submission') !== -1);
    });

    it('reports malformed JSON instead of throwing', function () {
      const body = '<!-- ' + Submission.MARKER + ' -->\n```json\n{ not json\n```';
      const result = Submission.parseBody(body, CONTEXT);
      assert.ok(!result.ok);
      assert.ok(result.errors[0].indexOf('not valid JSON') !== -1);
    });

    it('rejects an unknown year', function () {
      const body = Submission.buildBody(submission({ year: 'fifth-year' }));
      const result = Submission.parseBody(body, CONTEXT);
      assert.ok(!result.ok);
      assert.ok(result.errors.join(' ').indexOf('fifth-year') !== -1);
    });

    it('rejects an unknown branch', function () {
      const body = Submission.buildBody(submission({ branch: 'wizardry' }));
      const result = Submission.parseBody(body, CONTEXT);
      assert.ok(!result.ok);
      assert.ok(result.errors.join(' ').indexOf('wizardry') !== -1);
    });

    it('rejects a branch on a year that has none', function () {
      const body = Submission.buildBody(submission({ year: 'first-year', branch: 'cse' }));
      const result = Submission.parseBody(body, CONTEXT);
      assert.ok(!result.ok);
      assert.ok(result.errors.join(' ').indexOf('common to every branch') !== -1);
    });

    /*
     * The submitter must not be able to choose where their file lands, or an
     * issue could overwrite a workflow file.
     */
    it('refuses a submission that sets its own file path', function () {
      const body = Submission.buildBody(
        submission({ paper: Object.assign(submission().paper, { file: '.github/workflows/ci.yml' }) })
      );
      const result = Submission.parseBody(body, CONTEXT);
      assert.ok(!result.ok);
      assert.ok(result.errors.join(' ').indexOf('may not set "file"') !== -1);
    });

    it('refuses a submission that sets its own url', function () {
      const body = Submission.buildBody(
        submission({ paper: Object.assign(submission().paper, { url: 'https://evil.example/x.pdf' }) })
      );
      const result = Submission.parseBody(body, CONTEXT);
      assert.ok(!result.ok);
      assert.ok(result.errors.join(' ').indexOf('may not set "url"') !== -1);
    });

    it('applies the ordinary paper rules', function () {
      const body = Submission.buildBody(
        submission({ paper: Object.assign(submission().paper, { exam: 'Viva', semester: 7 }) })
      );
      const result = Submission.parseBody(body, CONTEXT);
      assert.ok(!result.ok);
      const joined = result.errors.join(' ');
      assert.ok(joined.indexOf('Viva') !== -1, joined);
      assert.ok(joined.indexOf('semester 7') !== -1, joined);
    });
  });

  describe('findAttachment', function () {
    it('finds a GitHub asset link', function () {
      const result = Submission.findAttachment('here you go\n\n[paper.pdf](https://github.com/user-attachments/files/123/paper.pdf)');
      assert.ok(result.ok, JSON.stringify(result.errors));
      assert.ok(result.url.indexOf('user-attachments/files/123') !== -1);
    });

    it('finds a legacy user-images link', function () {
      const result = Submission.findAttachment('https://user-images.githubusercontent.com/1/2.pdf');
      assert.ok(result.ok);
    });

    it('reports when nothing is attached', function () {
      const result = Submission.findAttachment('I forgot to attach it, sorry');
      assert.ok(!result.ok);
      assert.ok(result.errors[0].indexOf('No attached file') !== -1);
    });

    /*
     * The workflow fetches this URL with a write token in its environment. An
     * arbitrary host here is a request forgery, so the host allowlist is the
     * control that matters most in this file.
     */
    it('refuses a link to somewhere that is not GitHub', function () {
      assert.ok(!Submission.findAttachment('https://evil.example/payload.pdf').ok);
      assert.ok(!Submission.findAttachment('https://github.com.evil.example/user-attachments/assets/1').ok);
    });

    it('refuses a non-upload path on github.com', function () {
      assert.ok(!Submission.findAttachment('https://github.com/accelerate-muj/college-materials/settings').ok);
    });

    it('refuses plain http', function () {
      assert.ok(!Submission.findAttachment('http://user-images.githubusercontent.com/1/2.pdf').ok);
    });

    it('skips a bad link and takes a good one', function () {
      const result = Submission.findAttachment('see https://evil.example/x.pdf and https://github.com/user-attachments/assets/abc');
      assert.ok(result.ok);
      assert.ok(result.url.indexOf('user-attachments/assets/abc') !== -1);
    });
  });

  describe('filePath', function () {
    const parsed = Submission.parseBody(Submission.buildBody(submission()), CONTEXT).submission;

    it('derives the path from validated ids', function () {
      assert.equal(Submission.filePath(parsed), 'papers/second-year/cse/cse-2024-mte-cs2001.pdf');
    });

    it('drops the branch segment for an unbranched year', function () {
      const body = Submission.buildBody(submission({ year: 'first-year', branch: null, paper: {
        id: 'fy-2024-mte-ph1001', subject: 'Physics', exam: 'MTE', year: 2024,
      } }));
      const first = Submission.parseBody(body, CONTEXT).submission;
      assert.equal(Submission.filePath(first), 'papers/first-year/fy-2024-mte-ph1001.pdf');
    });

    it('strips anything that could escape the directory', function () {
      const hostile = { year: { id: 'second-year' }, branch: { id: 'cse' }, paper: { id: '../../etc/passwd' } };
      assert.equal(Submission.filePath(hostile), 'papers/second-year/cse/etcpasswd.pdf');
    });

    it('names the branch after the paper, safely', function () {
      assert.equal(Submission.branchName(parsed), 'paper/cse-2024-mte-cs2001');
      assert.equal(Submission.branchName({ paper: { id: '../evil' } }), 'paper/evil');
    });
  });

  describe('issueUrl', function () {
    it('points at the repository and carries the label', function () {
      const url = Submission.issueUrl('accelerate-muj/college-materials', submission());
      assert.ok(url.indexOf('https://github.com/accelerate-muj/college-materials/issues/new?') === 0);
      assert.ok(url.indexOf('labels=' + Submission.LABEL) !== -1);
    });

    it('survives a round trip through the query string', function () {
      const url = Submission.issueUrl('a/b', submission());
      const body = new URL(url).searchParams.get('body');
      assert.ok(Submission.parseBody(body, CONTEXT).ok);
    });
  });
});
