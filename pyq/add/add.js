'use strict';

/**
 * The contribution flow: place it, describe it, scan it, submit it.
 *
 * Everything happens in the browser. The camera frames go to a canvas, the
 * canvas to JPEG, the JPEGs to a PDF via src/pdf.js — no upload, no server, no
 * third party. The only thing that ever leaves the device is the file the
 * contributor themselves attaches to a GitHub issue, signed in as themselves.
 *
 * The submission format lives in src/submission.js, shared with the workflow
 * that reads the issue back.
 */

(function () {
  const PYQ = window.PYQ;
  const DATA = window.PYQ_DATA;
  const Submission = window.Submission;
  const PDFWriter = window.PDFWriter;

  const REPO = 'accelerate-muj/college-materials';

  /** Big enough to read a question, small enough to attach and to store. */
  const MAX_EDGE = 1800;
  const JPEG_QUALITY = 0.72;

  const $ = function (id) {
    return document.getElementById(id);
  };

  if (!DATA || !DATA.catalogue) {
    $('main').textContent = 'The archive data failed to load.';
    return;
  }

  const catalogue = DATA.catalogue;

  /* --- State -------------------------------------------------------------- */

  const state = {
    step: 'place',
    pages: [], // { blob, url, width, height }
    existingPdf: null, // a file the contributor already had
    pdfBlob: null,
    fileName: null,
  };

  const STEPS = ['place', 'details', 'pages', 'submit'];

  /* --- Populate the form from the catalogue -------------------------------- */

  function option(value, label) {
    const el = document.createElement('option');
    el.value = value;
    el.textContent = label;
    return el;
  }

  catalogue.years
    .slice()
    .sort(function (a, b) {
      return a.ordinal - b.ordinal;
    })
    .forEach(function (year) {
      $('year').appendChild(option(year.id, year.name));
    });

  catalogue.branchGroups.forEach(function (group) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group.name;
    catalogue.branches
      .filter(function (branch) {
        return branch.group === group.id;
      })
      .forEach(function (branch) {
        optgroup.appendChild(option(branch.id, branch.short + ' — ' + branch.name));
      });
    $('branch').appendChild(optgroup);
  });

  catalogue.examTypes.forEach(function (type) {
    $('exam').appendChild(option(type.id, type.id + ' — ' + type.name));
  });

  $('paper-year').max = String(new Date().getFullYear() + 1);
  $('paper-year').min = String(PYQ.EARLIEST_YEAR);
  $('paper-year').value = String(new Date().getFullYear());

  function currentYear() {
    return catalogue.years.find(function (year) {
      return year.id === $('year').value;
    });
  }

  function currentBranch() {
    const year = currentYear();
    if (!year || !year.branched) return null;
    return catalogue.branches.find(function (branch) {
      return branch.id === $('branch').value;
    });
  }

  /** First year has no branch, and its semesters differ — both follow the year. */
  function syncYear() {
    const year = currentYear();
    if (!year) return;

    $('branch-field').hidden = !year.branched;
    $('branch-hint').textContent = year.branched ? '' : '';

    syncSubjects();
  }

  /*
   * The picker is the union of the curated catalogue for this collection and
   * every subject already filed in it. The curated lists are still being copied
   * out of the curriculum, so the second half is what makes this useful today:
   * a subject is typed once, by whoever files the first paper for it, and is
   * offered to everyone afterwards.
   */
  function syncSubjects() {
    const year = currentYear();
    const branch = currentBranch();
    if (!year) return;

    const key = PYQ.collectionKey(year.id, branch ? branch.id : null);
    const curated = (DATA.subjects || {})[key] || [];
    const filed = (DATA.collections || {})[key] || [];
    const subjects = PYQ.subjectsFor(curated, filed);

    const pick = $('subject-pick');
    const previous = pick.value;
    pick.textContent = '';
    pick.appendChild(option('', subjects.length ? 'Choose a subject…' : 'No subjects listed yet'));

    subjects.forEach(function (subject) {
      pick.appendChild(option(subject.code || subject.name, subject.code ? subject.code + ' — ' + subject.name : subject.name));
    });

    pick.appendChild(option(OTHER, "It's not in this list"));
    if (previous) pick.value = previous;

    $('subject-hint').textContent = subjects.length
      ? 'Not listed? Pick the last option and type it — it will be offered to everyone next time.'
      : 'Nothing filed here yet. Choose the last option and type the subject.';

    // Remember what each option means so the record can be rebuilt from it.
    subjectIndex = subjects;
    syncSubjectOther();
  }

  const OTHER = '__other__';
  let subjectIndex = [];

  function syncSubjectOther() {
    const other = $('subject-pick').value === OTHER;
    $('subject-other-field').hidden = !other;
    if (other) $('subject').focus();
  }

  $('year').addEventListener('change', syncYear);
  $('branch').addEventListener('change', syncSubjects);
  $('subject-pick').addEventListener('change', syncSubjectOther);

  /*
   * The archive links here carrying whatever the reader was already looking at.
   * Someone who pressed "Add" from inside Third Year › CSE (AI & ML) has
   * answered "where does this go" by navigating there, and asking again is a
   * form standing between them and the thing they came to do.
   *
   * So: every question the URL answers is filled in and its step is skipped,
   * and the flow opens on the first step that still needs something. A caller
   * that supplies year, branch, subject and exam lands straight on the camera.
   *
   * Everything here is a URL, so nothing is trusted: each value has to resolve
   * against the catalogue or it is dropped and the step is asked normally.
   */
  const params = new URLSearchParams(window.location.search);

  const wantedYear = catalogue.years.find(function (year) {
    return year.id === params.get('year');
  });
  if (wantedYear) $('year').value = wantedYear.id;

  syncYear();

  const wantedBranch = catalogue.branches.find(function (branch) {
    return branch.id === params.get('branch');
  });
  if (wantedBranch && wantedYear && wantedYear.branched) {
    $('branch').value = wantedBranch.id;
    // syncYear() ran above with the default branch still selected, so the
    // picker was built for the wrong collection. Rebuild it now.
    syncSubjects();
  }

  const wantedExam = catalogue.examTypes.find(function (type) {
    return type.id === params.get('exam');
  });
  if (wantedExam) $('exam').value = wantedExam.id;

  const wantedSubject = (params.get('subject') || '').trim().slice(0, 120);
  const wantedCode = (params.get('code') || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 12);
  const codeOk = Boolean(wantedCode) && /^[A-Z]{2,4}\d{3,4}$/.test(wantedCode);

  if (wantedSubject) {
    // Prefer the catalogue entry, so the record picks up a code the link may
    // not have carried. Fall back to the free-text field for a subject the
    // archive has never seen.
    const match = subjectIndex.find(function (subject) {
      return (codeOk && subject.code === wantedCode) || subject.name.toLowerCase() === wantedSubject.toLowerCase();
    });
    if (match) {
      $('subject-pick').value = match.code || match.name;
    } else {
      $('subject-pick').value = OTHER;
      $('subject').value = wantedSubject;
      if (codeOk) $('code').value = wantedCode;
    }
    syncSubjectOther();
  }

  /** True once the URL has fully answered "where does this paper go". */
  const placeKnown = Boolean(wantedYear) && (!wantedYear.branched || Boolean(wantedBranch));

  /** True once it has also answered "what is it" well enough to skip the form. */
  const detailsKnown = placeKnown && Boolean(wantedSubject) && Boolean(wantedExam);

  const prefilled = { place: placeKnown, details: detailsKnown };

  /* --- Step navigation ------------------------------------------------------ */

  function showStep(name) {
    state.step = name;

    STEPS.forEach(function (step) {
      $('step-' + step).hidden = step !== name;
    });

    const active = STEPS.indexOf(name);
    Array.prototype.forEach.call($('steps').children, function (item, index) {
      const el = item;
      if (index < active) el.dataset.state = 'done';
      else if (index === active) el.dataset.state = 'active';
      else delete el.dataset.state;
      if (index === active) el.setAttribute('aria-current', 'step');
      else el.removeAttribute('aria-current');
    });

    renderContext(name);

    if (name === 'submit') renderSummary();

    // Focus the new step's heading so a screen reader announces the move.
    const heading = $('step-' + name).querySelector('h2');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus();
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  /**
   * A skipped step is still a decision that was made on the contributor's
   * behalf, so it is shown back to them with a way to change it. Silently
   * filing a paper somewhere they did not choose is worse than one extra click.
   */
  function renderContext(step) {
    const bar = $('context');
    bar.textContent = '';

    const parts = [];
    if (prefilled.place && step !== 'place') {
      const year = currentYear();
      const branch = currentBranch();
      parts.push({ text: branch ? year.name + ' › ' + branch.short : year.name, step: 'place' });
    }
    if (prefilled.details && step !== 'details' && $('subject').value.trim()) {
      const code = $('code').value.trim();
      parts.push({ text: (code ? code + ' — ' : '') + $('subject').value.trim() + ' · ' + $('exam').value, step: 'details' });
    }

    bar.hidden = parts.length === 0;
    if (!parts.length) return;

    parts.forEach(function (part, index) {
      if (index > 0) bar.appendChild(document.createTextNode(' · '));
      const span = document.createElement('span');
      span.className = 'context-value';
      span.textContent = part.text;
      bar.appendChild(span);
      const change = document.createElement('button');
      change.type = 'button';
      change.className = 'context-change';
      change.textContent = 'change';
      change.setAttribute('aria-label', 'Change ' + part.text);
      change.addEventListener('click', function () {
        showStep(part.step);
      });
      bar.appendChild(change);
    });
  }

  document.addEventListener('click', function (event) {
    const back = event.target.closest('[data-back]');
    if (back) {
      // Walking back into a step the URL answered is fine — they asked for it —
      // but the default Back button should skip it, or "Back" from the camera
      // would land on a form they never filled in.
      let target = back.dataset.back;
      if (target === 'details' && prefilled.details) target = 'place';
      if (target === 'place' && prefilled.place) return;
      showStep(target);
      return;
    }

    const next = event.target.closest('[data-next]');
    if (next && validateStep(state.step)) showStep(next.dataset.next);
  });

  function showError(id, message) {
    const el = $(id);
    if (!message) {
      el.hidden = true;
      return false;
    }
    el.textContent = message;
    el.hidden = false;
    return true;
  }

  function validateStep(step) {
    if (step === 'details') {
      const picked = $('subject-pick').value;
      if (!picked) {
        showError('details-error', 'Pick a subject, or choose the last option and type it.');
        return false;
      }
      if (picked === OTHER && !$('subject').value.trim()) {
        showError('details-error', 'Type the subject name.');
        return false;
      }

      const paper = buildPaper();
      const errors = PYQ.validatePaper(Object.assign({}, paper, { file: 'papers/x.pdf' }), {
        catalogue: catalogue,
        year: currentYear(),
      });
      if (errors.length > 0) {
        showError('details-error', errors[0]);
        return false;
      }
      showError('details-error', null);
      return true;
    }

    if (step === 'pages') {
      if (state.existingPdf) return !showError('pages-error', null);
      if (state.pages.length === 0) {
        showError('pages-error', 'Scan at least one page, or choose a PDF you already have.');
        return false;
      }
      showError('pages-error', null);
      return true;
    }

    return true;
  }

  /* --- The paper record ------------------------------------------------------ */

  function slug(text) {
    return String(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  }

  /**
   * Ids must be unique across the archive and match src/pyq.js's pattern. The
   * workflow appends a suffix if this one is already taken, so a collision is
   * not the contributor's problem.
   */
  function buildId(paper) {
    const branch = currentBranch();
    const parts = [
      branch ? branch.id : 'fy',
      String(paper.year),
      String(paper.exam).toLowerCase(),
      paper.code ? slug(paper.code) : slug(paper.subject),
    ];
    return slug(parts.join('-'));
  }

  /**
   * The record, from as few answers as possible.
   *
   * No contributor field: the bot credits whoever opens the issue, which is
   * more reliable than a typed handle and one less thing to fill in. No
   * semester and no notes — both were optional and neither earned its place in
   * front of someone holding a paper. The year defaults to now and is
   * corrigible on the review step.
   */
  function buildPaper() {
    const picked = $('subject-pick').value;
    const custom = picked === OTHER || !picked;
    const entry = custom ? null : subjectIndex.find(function (subject) {
      return (subject.code || subject.name) === picked;
    });

    const paper = {
      subject: entry ? entry.name : $('subject').value.trim(),
      exam: $('exam').value,
      year: Number($('paper-year').value) || new Date().getFullYear(),
    };

    const code = entry ? entry.code : $('code').value.trim().toUpperCase().replace(/\s+/g, '');
    if (code) paper.code = code;

    paper.id = buildId(paper);
    return paper;
  }

  function buildSubmission() {
    const year = currentYear();
    const branch = currentBranch();
    return {
      year: year.id,
      branch: branch ? branch.id : null,
      yearName: year.name,
      branchName: branch ? branch.name : null,
      paper: buildPaper(),
    };
  }

  /* --- Image capture --------------------------------------------------------- */

  let stream = null;

  async function openCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 2400 }, height: { ideal: 2400 } },
        audio: false,
      });
    } catch (error) {
      // No camera, no permission, or an insecure origin. The file picker on a
      // phone opens the camera anyway, so this is a nudge rather than a wall.
      showError('pages-error', 'Could not open the camera (' + error.name + '). Use "Choose photos" — on a phone that offers the camera too.');
      return;
    }

    $('video').srcObject = stream;
    await $('video').play();
    $('capture').hidden = false;
    // Hide the whole card, not just the button, or the grid keeps a gap.
    $('camera-open').closest('li').hidden = true;
    updateCaptureCount();
  }

  function closeCamera() {
    if (stream) {
      stream.getTracks().forEach(function (track) {
        track.stop();
      });
      stream = null;
    }
    $('video').srcObject = null;
    $('capture').hidden = true;
    $('camera-open').closest('li').hidden = false;
  }

  function updateCaptureCount() {
    $('capture-count').textContent = state.pages.length === 1 ? '1 page' : state.pages.length + ' pages';
  }

  /**
   * Downscale, optionally clean up, and encode as JPEG.
   *
   * The clean-up is deliberately simple: desaturate, then push a contrast curve
   * so paper goes white and ink goes black. Anything cleverer (deskew, adaptive
   * thresholding) is a research project, and a legible grey scan beats a
   * badly-corrected one.
   */
  function process(source, width, height) {
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0, w, h);

    if ($('enhance').checked) {
      const image = ctx.getImageData(0, 0, w, h);
      const px = image.data;
      for (let i = 0; i < px.length; i += 4) {
        const grey = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
        // Lift above mid-grey towards white, push below towards black.
        let value = (grey - 128) * 1.45 + 128 + 12;
        value = value < 0 ? 0 : value > 255 ? 255 : value;
        px[i] = value;
        px[i + 1] = value;
        px[i + 2] = value;
      }
      ctx.putImageData(image, 0, 0);
    }

    return new Promise(function (resolve) {
      canvas.toBlob(
        function (blob) {
          resolve({ blob: blob, url: URL.createObjectURL(blob), width: w, height: h });
        },
        'image/jpeg',
        JPEG_QUALITY
      );
    });
  }

  async function addFromVideo() {
    const video = $('video');
    if (!video.videoWidth) return;
    state.pages.push(await process(video, video.videoWidth, video.videoHeight));
    renderThumbs();
    updateCaptureCount();
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = function () {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Could not read ' + file.name));
      };
      image.src = url;
    });
  }

  async function addFromFiles(files) {
    showError('pages-error', null);
    for (let i = 0; i < files.length; i += 1) {
      try {
        const image = await loadImage(files[i]);
        state.pages.push(await process(image, image.naturalWidth, image.naturalHeight));
      } catch (error) {
        showError('pages-error', error.message);
      }
    }
    renderThumbs();
    updateCaptureCount();
  }

  function renderThumbs() {
    const list = $('thumbs');
    list.textContent = '';

    state.pages.forEach(function (page, index) {
      const item = document.createElement('li');
      item.className = 'thumb';

      const badge = document.createElement('span');
      badge.className = 'thumb-index';
      badge.textContent = String(index + 1);

      const img = document.createElement('img');
      img.src = page.url;
      img.alt = 'Scanned page ' + (index + 1);

      const tools = document.createElement('div');
      tools.className = 'thumb-tools';

      function tool(label, title, handler) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.title = title;
        button.setAttribute('aria-label', title + ' page ' + (index + 1));
        button.addEventListener('click', handler);
        return button;
      }

      tools.appendChild(
        tool('↑', 'Move up', function () {
          if (index === 0) return;
          const swap = state.pages[index - 1];
          state.pages[index - 1] = state.pages[index];
          state.pages[index] = swap;
          renderThumbs();
        })
      );
      tools.appendChild(
        tool('↓', 'Move down', function () {
          if (index === state.pages.length - 1) return;
          const swap = state.pages[index + 1];
          state.pages[index + 1] = state.pages[index];
          state.pages[index] = swap;
          renderThumbs();
        })
      );
      tools.appendChild(
        tool('✕', 'Remove', function () {
          URL.revokeObjectURL(state.pages[index].url);
          state.pages.splice(index, 1);
          renderThumbs();
          updateCaptureCount();
        })
      );

      item.appendChild(badge);
      item.appendChild(img);
      item.appendChild(tools);
      list.appendChild(item);
    });
  }

  $('camera-open').addEventListener('click', openCamera);
  $('camera-close').addEventListener('click', closeCamera);
  $('shutter').addEventListener('click', addFromVideo);

  $('pick-images').addEventListener('click', function () {
    $('file-images').click();
  });
  $('file-images').addEventListener('change', function (event) {
    // Copy before clearing: FileList is live, so resetting the input empties
    // it mid-loop and every file after the first is silently dropped.
    const files = Array.prototype.slice.call(event.target.files);
    event.target.value = '';
    addFromFiles(files);
  });

  $('pick-pdf').addEventListener('click', function () {
    $('file-pdf').click();
  });
  /**
   * A ready-made PDF replaces the scans rather than joining them: merging pages
   * into an existing PDF would mean parsing one, and this repository is not
   * going to grow a PDF parser to save a step nobody has asked for. Say so
   * plainly instead of silently dropping either.
   */
  $('file-pdf').addEventListener('change', function (event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;

    const replaced = state.pages.length;
    state.pages.forEach(function (page) {
      URL.revokeObjectURL(page.url);
    });
    state.pages = [];
    renderThumbs();
    updateCaptureCount();

    state.existingPdf = file;
    $('pdf-chosen').hidden = false;
    $('pdf-chosen').textContent =
      'Using ' + file.name + ' (' + Math.round(file.size / 1024) + ' KB).' +
      (replaced ? ' The ' + replaced + ' scanned page' + (replaced === 1 ? '' : 's') + ' were discarded — a PDF is used as-is.' : '');
    $('clear-pdf').hidden = false;
    showError('pages-error', null);
  });

  $('clear-pdf').addEventListener('click', function () {
    state.existingPdf = null;
    $('pdf-chosen').hidden = true;
    $('clear-pdf').hidden = true;
  });

  /* --- Summary and submission ------------------------------------------------ */

  function renderSummary() {
    const submission = buildSubmission();
    const rows = [
      ['Subject', submission.paper.subject],
      ['Code', submission.paper.code || '—'],
      ['Exam', submission.paper.exam],
      ['Year', submission.yearName],
      ['Branch', submission.branchName || 'Common to all branches'],
      ['Pages', state.existingPdf ? state.existingPdf.name : state.pages.length + ' scanned'],
    ];

    const dl = document.createElement('dl');
    rows.forEach(function (row) {
      const dt = document.createElement('dt');
      dt.textContent = row[0];
      const dd = document.createElement('dd');
      dd.textContent = row[1];
      dl.appendChild(dt);
      dl.appendChild(dd);
    });

    $('summary').textContent = '';
    $('summary').appendChild(dl);

    $('year-display').textContent = submission.paper.exam + ' ' + submission.paper.year;

    // The do-it-yourself route needs the same paths the workflow would use.
    const resolved = {
      year: currentYear(),
      branch: currentBranch(),
      paper: submission.paper,
    };
    $('diy-pdf-path').textContent = Submission.filePath(resolved);
    $('diy-json-path').textContent = PYQ.collectionPath(resolved.year.id, resolved.branch ? resolved.branch.id : null);
    $('diy-json').textContent = JSON.stringify(
      Object.assign({}, submission.paper, { file: Submission.filePath(resolved) }),
      null,
      2
    );

    state.fileName = submission.paper.id + '.pdf';
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Revoking immediately can cancel the download in some browsers.
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 30000);
  }

  async function blobBytes(blob) {
    return new Uint8Array(await blob.arrayBuffer());
  }

  $('build-pdf').addEventListener('click', async function () {
    const button = $('build-pdf');
    button.disabled = true;
    button.textContent = 'Building…';

    try {
      const submission = buildSubmission();

      if (state.existingPdf) {
        state.pdfBlob = state.existingPdf;
      } else {
        const pages = [];
        for (let i = 0; i < state.pages.length; i += 1) {
          pages.push({
            data: await blobBytes(state.pages[i].blob),
            width: state.pages[i].width,
            height: state.pages[i].height,
          });
        }
        const bytes = PDFWriter.build(pages, { title: Submission.buildTitle(submission) });
        state.pdfBlob = new Blob([bytes], { type: 'application/pdf' });
      }

      download(state.pdfBlob, state.fileName);

      $('pdf-ready').hidden = false;
      $('pdf-ready').textContent =
        'Saved ' + state.fileName + ' (' + Math.round(state.pdfBlob.size / 1024) + ' KB). Check your downloads — you will attach it next.';

      // The GitHub link is a plain anchor with a real href, so the click that
      // opens it is a direct user gesture and no popup blocker touches it.
      const link = $('open-issue');
      link.href = Submission.issueUrl(REPO, submission);
      link.removeAttribute('aria-disabled');
      $('handoff').classList.remove('dimmed');

      button.textContent = 'Rebuild the PDF';
    } catch (error) {
      showError('pages-error', 'Could not build the PDF: ' + error.message);
      button.textContent = 'Build and save the PDF';
    } finally {
      button.disabled = false;
    }
  });

  // Changing the year changes the record id and so the filename; re-derive
  // rather than leaving the summary and the download disagreeing.
  $('paper-year').addEventListener('change', function () {
    if (state.step === 'submit') renderSummary();
  });

  $('diy-link').href = 'https://github.com/' + REPO;

  window.addEventListener('beforeunload', closeCamera);

  /*
   * Open on the first unanswered step. detailsKnown implies placeKnown, so the
   * order here is the order of the flow. A caller that supplied everything
   * lands on 'pages' — the camera — which is the whole point.
   */
  showStep(detailsKnown ? 'pages' : placeKnown ? 'details' : 'place');
})();
