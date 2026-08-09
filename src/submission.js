'use strict';

/**
 * The contribution format, as pure functions.
 *
 * A submission travels as a GitHub issue: the site writes the body, a workflow
 * reads it back. Those two live in different processes on different machines
 * and can only agree if they share this file — the same reason src/pyq.js
 * exists.
 *
 * The body carries a fenced JSON block for the machine and prose for the
 * human, because a contributor will read the issue they just opened and a
 * maintainer will read it again during review.
 */

(function (root, factory) {
  const api = factory(
    typeof module !== 'undefined' && module.exports ? require('./pyq.js') : root.PYQ
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Submission = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (PYQ) {
  /** Bumped if the body format ever changes shape, so old issues stay parseable. */
  const MARKER = 'accelerate:pyq-submission:v1';

  const LABEL = 'paper-submission';

  /**
   * Hosts GitHub serves issue attachments from. A submission's file is
   * downloaded by a workflow with a write token, so the URL it points at is
   * the security boundary: anything not on this list is refused rather than
   * fetched.
   */
  const ATTACHMENT_HOSTS = ['github.com', 'user-images.githubusercontent.com', 'raw.githubusercontent.com', 'objects.githubusercontent.com'];

  const MAX_BYTES = 10 * 1024 * 1024;

  /**
   * Fields the site sends. `year` and `branch` place the paper; the rest is the
   * paper record itself, minus `file`, which only the workflow can know.
   */
  function buildBody(submission) {
    const payload = {
      programme: submission.programme,
      year: submission.year,
      branch: submission.branch || null,
      paper: submission.paper,
    };

    return [
      '### Paper submission',
      '',
      'Submitted from the [scanner](https://accelerate-muj.github.io/college-materials/pyq/add/).',
      'A bot checks this issue, commits the paper and opens a pull request.',
      '',
      '| | |',
      '|---|---|',
      '| **Subject** | ' + escapeCell(submission.paper.subject) + ' |',
      '| **Code** | ' + escapeCell(submission.paper.code || '—') + ' |',
      '| **Exam** | ' + escapeCell(submission.paper.exam) + ' ' + escapeCell(submission.paper.year) + ' |',
      '| **Programme** | ' + escapeCell(submission.programmeName || submission.programme) + ' |',
      '| **Year** | ' + escapeCell(submission.yearName || ('Year ' + submission.year)) + ' |',
      '| **Branch** | ' + escapeCell(submission.branchName || submission.branch || 'Not split by specialisation') + ' |',
      '',
      '---',
      '',
      '## ⬇️ Attach the PDF below',
      '',
      'Drag the scanned PDF into this box, or click the attach button. **The submission is not',
      'complete without it** — the bot has nothing to commit until a file is attached.',
      '',
      '',
      '',
      '---',
      '',
      '<details><summary>Submission data (do not edit)</summary>',
      '',
      '<!-- ' + MARKER + ' -->',
      '',
      '```json',
      JSON.stringify(payload, null, 2),
      '```',
      '',
      '</details>',
      '',
    ].join('\n');
  }

  /** Pipes would break out of the summary table; nothing else in a cell can. */
  function escapeCell(value) {
    return String(value === undefined || value === null ? '' : value).replace(/\|/g, '\\|');
  }

  function buildTitle(submission) {
    const parts = [submission.paper.code || submission.paper.subject, submission.paper.exam, submission.paper.year];
    return 'Paper: ' + parts.join(' ');
  }

  /**
   * The URL that opens a prefilled issue. The user is already signed in to
   * GitHub, so this is the whole of "authentication" — they press Submit as
   * themselves and the issue is theirs.
   */
  function issueUrl(repo, submission) {
    const params = new URLSearchParams({
      title: buildTitle(submission),
      body: buildBody(submission),
      labels: LABEL,
    });
    return 'https://github.com/' + repo + '/issues/new?' + params.toString();
  }

  /**
   * Reads a submission back out of an issue body.
   *
   * Returns { ok: true, submission } or { ok: false, errors }. Never throws:
   * the caller is a workflow reacting to arbitrary text that anyone on the
   * internet can write, and a crash there is a failed run with no explanation
   * for the contributor.
   */
  function parseBody(body, context) {
    const errors = [];
    const text = String(body || '');

    if (text.indexOf(MARKER) === -1) {
      return { ok: false, errors: ['This issue does not contain a submission block.'] };
    }

    const match = text.match(/```json\s*([\s\S]*?)```/);
    if (!match) {
      return { ok: false, errors: ['The submission block is missing its JSON.'] };
    }

    let payload;
    try {
      payload = JSON.parse(match[1]);
    } catch (error) {
      return { ok: false, errors: ['The submission block is not valid JSON — ' + error.message] };
    }

    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      return { ok: false, errors: ['The submission block is not an object.'] };
    }

    const catalogue = (context && context.catalogue) || { programmes: [], examTypes: [] };

    const programme = PYQ.findProgramme(catalogue, payload.programme);
    if (!programme) {
      return { ok: false, errors: ['Unknown programme "' + payload.programme + '".'] };
    }

    const year = Number(payload.year);
    if (!Number.isInteger(year) || year < 1 || year > programme.years) {
      errors.push('Year ' + payload.year + ' is not part of ' + programme.short + ', which runs ' + programme.years + ' years.');
    }

    let branch = null;
    const branched = Number.isInteger(year) && PYQ.isBranched(programme, year);
    if (branched) {
      branch = PYQ.findBranch(programme, payload.branch);
      if (!branch) errors.push('Unknown ' + programme.short + ' specialisation "' + payload.branch + '".');
    } else if (payload.branch) {
      errors.push(programme.short + ' year ' + payload.year + ' is not split by specialisation, so it takes no branch.');
    }

    const paper = payload.paper;
    if (typeof paper !== 'object' || paper === null || Array.isArray(paper)) {
      errors.push('The submission has no paper record.');
      return { ok: false, errors: errors };
    }

    // `file` is set by the workflow from the attachment, never by the
    // submitter — otherwise an issue could name any path in the repository.
    if (paper.file !== undefined) errors.push('A submission may not set "file".');
    if (paper.url !== undefined) errors.push('A submission may not set "url".');

    // validatePaper insists on a url or a file; the attachment supplies one
    // later, so a placeholder stands in while the rest is checked.
    const candidate = Object.assign({}, paper, { file: 'papers/placeholder.pdf' });
    PYQ.validatePaper(candidate, { catalogue: catalogue, year: year, currentYear: context && context.currentYear }).forEach(
      function (problem) {
        if (problem.indexOf('placeholder') !== -1) return;
        errors.push(problem);
      }
    );

    if (errors.length > 0) return { ok: false, errors: errors };

    return {
      ok: true,
      submission: { programme: programme, year: year, branch: branch, paper: paper },
    };
  }

  /**
   * Finds the attached PDF.
   *
   * GitHub rewrites an upload into a markdown link pointing at its own asset
   * hosts. Only those hosts are accepted: the workflow that fetches this URL
   * holds a write token, so an arbitrary URL here would be a request forgery
   * with the repository's credentials attached.
   */
  function findAttachment(body) {
    const text = String(body || '');
    const urls = text.match(/https?:\/\/[^\s)\]"'<>]+/g) || [];

    for (let i = 0; i < urls.length; i += 1) {
      const raw = urls[i];
      let parsed;
      try {
        parsed = new URL(raw);
      } catch (error) {
        continue;
      }

      if (parsed.protocol !== 'https:') continue;
      if (ATTACHMENT_HOSTS.indexOf(parsed.hostname) === -1) continue;

      // github.com hosts the whole site, so narrow it to the upload paths.
      if (parsed.hostname === 'github.com' && !/^\/user-attachments\/(assets|files)\//.test(parsed.pathname)) {
        continue;
      }

      return { ok: true, url: parsed.toString() };
    }

    return { ok: false, errors: ['No attached file found. Drag the scanned PDF into the issue and the bot will retry.'] };
  }

  /**
   * Where a submission's PDF lands. Built only from validated ids and a
   * sanitised paper id, so a submission cannot steer the write anywhere else.
   */
  function filePath(submission) {
    const safeId = String(submission.paper.id).replace(/[^a-z0-9-]/g, '');
    const parts = ['papers', String(submission.programme.id).replace(/[^a-z0-9-]/g, ''), PYQ.yearId(submission.year)];
    if (submission.branch) parts.push(submission.branch.id);
    parts.push(safeId + '.pdf');
    return parts.join('/');
  }

  function branchName(submission) {
    return 'paper/' + String(submission.paper.id).replace(/[^a-z0-9-]/g, '');
  }

  return {
    MARKER: MARKER,
    LABEL: LABEL,
    MAX_BYTES: MAX_BYTES,
    ATTACHMENT_HOSTS: ATTACHMENT_HOSTS,
    buildBody: buildBody,
    buildTitle: buildTitle,
    issueUrl: issueUrl,
    parseBody: parseBody,
    findAttachment: findAttachment,
    filePath: filePath,
    branchName: branchName,
  };
});
