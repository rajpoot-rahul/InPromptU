"use strict";

const $ = (sel) => document.querySelector(sel);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SHORT_MODE = { plain: "Plain", json_mode: "Plain + JSON", template: "Template", harness: "Harness" };
const STEP_ORDER = ["task", "clean", "prompt", "ai", "checks", "result"];
const TRICK_LABELS = {
  customer_first: "customer named before vendor", due_date_early: "due date listed first",
  discount: "discount", previous_balance: "previous balance", noise: "messy spacing",
};

let overview = null;
let tryDocView = "cleaned";
let tryDocData = null;

async function api(path, options) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail || `Request failed (${response.status})`);
  return body;
}

function option(value, label, selected = false) {
  const el = document.createElement("option");
  el.value = value; el.textContent = label; el.selected = selected;
  return el;
}

function fill(select, items, selectedValue) {
  const previous = selectedValue ?? select.value;
  select.replaceChildren(...items.map(([value, label]) => option(value, label, value === previous)));
}

function docLabel(doc) {
  const tricks = (doc.tricks || []).map((t) => TRICK_LABELS[t] || t).join(", ");
  return `${doc.doc_id} · ${doc.locale || ""}${tricks ? " · " + tricks : ""}`;
}

function money(value) {
  if (value === null || value === undefined) return "n/a";
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") return '<span class="small">(empty)</span>';
  if (typeof value === "boolean") return `<span class="mono">${value ? "yes" : "no"}</span>`;
  if (Array.isArray(value)) {
    if (!value.length) return '<span class="small">(none)</span>';
    return value.map((item) => {
      if (item && typeof item === "object" && "quantity" in item && "description" in item) {
        return `<div class="mono">${esc(item.description)} — ${esc(item.quantity)} × ${esc(item.unit_price)} = ${esc(item.amount)}</div>`;
      }
      if (item && typeof item === "object") {
        return `<div class="item">${Object.entries(item).map(([k, v]) => `<span class="small">${esc(k)}:</span> ${esc(v ?? "—")}`).join("<br>")}</div>`;
      }
      return `<div class="mono">• ${esc(item)}</div>`;
    }).join("");
  }
  if (typeof value === "object") return `<span class="mono">${esc(JSON.stringify(value))}</span>`;
  return `<span class="mono">${esc(value)}</span>`;
}

function showRawWithMarkers(text) {
  return esc(text)
    .replace(/ +(?=\r?$)/gm, (spaces) => `<span class="tag" title="trailing spaces">${"·".repeat(spaces.length)}</span>`)
    .replace(/\r/g, '<span class="tag" title="carriage return">␍</span>')
    .replace(/\u00a0/g, '<span class="tag" title="non-breaking space">⍽</span>')
    .replace(/\u200b/g, '<span class="tag" title="zero-width space">‸</span>');
}

/* ---------- routing ---------- */
function route() {
  const known = ["problem", "try", "compare", "results", "roadmap"];
  let screen = (location.hash || "#problem").slice(1);
  if (!known.includes(screen)) screen = "problem";
  document.querySelectorAll(".screen").forEach((s) => { s.hidden = s.id !== `screen-${screen}`; });
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active", a.dataset.screen === screen));
  if (screen === "results") loadResults();
  if (screen === "compare") refreshDifferences();
}

/* ---------- shared rendering ---------- */
const STATUS_TEXT = {
  passed: ["✅ Passed every check", "Answer delivered automatically."],
  fixed_on_retry: ["🔁 Fixed on retry", "The first answer failed a check. The AI corrected it after automatic feedback."],
  flagged: ["⚠️ Sent for human review", "Still failing checks after one retry, so it is not passed on silently."],
  rejected: ["⚠️ Document rejected", "Too large to process safely; it was not silently cut short."],
  unchecked: ["📤 Delivered without checks", "This mode passes the AI's answer on exactly as it came back."],
  parse_error: ["❌ Answer was not readable", "The AI's reply could not be read as JSON."],
  api_error: ["❌ The AI call failed", "Network, login or service problem."],
};

function friendlyIssue(message) {
  const missing = message.match(/'(\w+)' is a required property/);
  if (missing) return `Missing invoice field: ${missing[1]}`;
  const extra = message.match(/Additional properties are not allowed \((.*) (?:was|were) unexpected\)/);
  if (extra) return `The AI added fields that are not part of an invoice: ${extra[1]}`;
  const field = message.match(/^([\w.\[\]]+): (''|\[\]|None|null) (?:should be non-empty|does not match|is not of type)/);
  if (field) return `Empty field: ${field[1]}`;
  const format = message.match(/^([\w.\[\]]+): .* (?:does not match|is not of type|is less than)/);
  if (format) return `Wrong format: ${format[1]}`;
  return message;
}

const STEP_TARGET = { task: "#try-prompt-panel", clean: "#try-doc-panel", prompt: "#try-prompt-panel",
  ai: "#try-ai-panel", checks: "#try-checks-panel", result: "#try-result" };

function jumpToStep(step) {
  const li = document.querySelector(`#try-steps li[data-step="${step}"]`);
  const target = document.querySelector(STEP_TARGET[step]);
  if (!li?.classList.contains("done") || !target) return;
  const panel = target.closest(".panel") || target;
  if (step === "task" || step === "prompt") panel.querySelector("details")?.setAttribute("open", "");
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
  panel.classList.add("flash");
  setTimeout(() => panel.classList.remove("flash"), 1200);
}

function currentTask() {
  const task = overview?.tasks.find((t) => t.id === $("#try-task").value) || overview?.tasks[0];
  if (task && !task.title) task.title = task.task.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  return task;
}

function whyBlock(view) {
  if (!["flagged", "parse_error", "rejected"].includes(view.status)) return "";
  const task = currentTask();
  const isInvoice = task?.task === "invoice_extraction";
  const empty = (v) => v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length);
  const missing = view.fields.filter((f) => empty(f.got)).length;
  const reasons = [];
  if (view.status === "rejected") {
    const size = (view.issues || []).map((i) => i.message).join(" ");
    return `<div class="why"><b>Why was it sent for review?</b><ul><li>${esc(size || "The document is too long to process safely.")}</li>
      <li>It was not sent to the AI and was not cut short. Split it into smaller parts and try again.</li></ul></div>`;
  }
  if (isInvoice && missing >= Math.ceil(view.fields.length / 2)) {
    reasons.push(`The AI could not find invoice details: ${missing} of ${view.fields.length} invoice fields are empty. `
      + "This document probably is not an invoice, so nothing was passed on.");
  } else {
    const grounding = view.checks.filter((c) => c.group === "grounding");
    const notFound = grounding.filter((c) => c.passed === false).length;
    if (grounding.length && notFound >= Math.ceil(grounding.length / 2)) {
      reasons.push(`${notFound} of ${grounding.length} groups of values the AI gave do not appear in the document `
        + `(it filled in placeholders or guesses). ${isInvoice ? "This document probably is not an invoice, so nothing" : "Nothing"} was passed on.`);
    }
  }
  const last = view.attempts.at(-1);
  try {
    const reply = JSON.parse(last?.raw_output || "");
    const said = reply && (reply.message || reply.reason || (typeof reply.error === "string" ? reply.error : ""));
    if (said) reasons.push(`The AI said: "${said}"`);
  } catch { /* reply was not JSON; the raw reply is shown below */ }
  const issues = [...new Set((last?.issues || []).map((i) => friendlyIssue(i.message)))];
  return `<div class="why"><b>Why was it sent for review?</b><ul>
    ${reasons.map((r) => `<li>${esc(r)}</li>`).join("")}
    ${issues.slice(0, 6).map((i) => `<li>${esc(i)}</li>`).join("")}
    ${issues.length > 6 ? `<li>…and ${issues.length - 6} more (see Automatic checks)</li>` : ""}</ul>
    <p class="small">${isInvoice
      ? "Tip: the task decides what the AI looks for. With <b>invoice extraction</b>, any text that is not an invoice is correctly sent to a person instead of getting a made-up answer. To test general text, choose the task <b>Key facts from any text</b>."
      : `Tip: the selected task is <b>${esc(task?.title || "")}</b>. Anything the AI says must be backed by the text; otherwise it is retried once and then sent to a person.`}</p></div>`;
}

function statusBlock(view) {
  const [title, sub] = STATUS_TEXT[view.status] || [view.status, ""];
  const wrong = view.fields.filter((f) => f.correct === false).length;
  let truth;
  if (view.all_correct === null || view.all_correct === undefined) {
    truth = `<div class="truth neutral">No answer key for your document: compare the AI answer with the document yourself. The automatic checks show what the harness could verify.</div>`;
  } else if (view.all_correct) {
    truth = `<div class="truth ok">Compared with the correct answer: all ${view.fields.length} fields right${view.schema_ok ? "" : ", but not in the required format"}.</div>`;
  } else {
    const warned = view.status === "flagged" || view.status === "rejected";
    truth = `<div class="truth bad">Compared with the correct answer: ${wrong} field${wrong === 1 ? "" : "s"} wrong${warned ? ", but it was flagged, so a person would catch it." : ". Nobody was warned (a silent error)."}</div>`;
  }
  const apiError = view.status === "api_error"
    ? `<p class="small">${esc(view.attempts.at(-1)?.error || "")}</p>` : "";
  return `<div class="status ${esc(view.status)}"><div>${title}<small>${sub}</small></div></div>${apiError}${whyBlock(view)}${truth}
    <div class="metrics"><span>Model <b>${esc(view.model_label)}</b></span><span>Mode <b>${esc(view.mode_label)}</b></span>
    <span>Time <b>${(view.latency_ms / 1000).toFixed(1)} s</b></span>
    <span>Tokens <b>${view.prompt_tokens} in / ${view.completion_tokens} out</b></span>
    <span>Est. cost <b>${money(view.cost_usd)}</b></span>
    <span>Source <b>${view.source === "live" ? "live call" : "saved run"}</b></span></div>`;
}

function fieldsTable(view) {
  if (!view.has_answer_key) {
    const rows = view.fields.map((f) => `<tr><td><b>${esc(f.name)}</b></td><td>${formatValue(f.got)}</td></tr>`).join("");
    return `<table><thead><tr><th>Field</th><th>AI answer</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  const rows = view.fields.map((f) => `<tr class="${f.correct ? "" : "badrow"}">
      <td><b>${esc(f.name)}</b></td><td>${formatValue(f.got)}</td><td>${formatValue(f.expected)}</td>
      <td class="${f.correct ? "ok" : "bad"}">${f.correct ? "✓" : "✗"}</td></tr>`).join("");
  return `<table><thead><tr><th>Field</th><th>AI answer</th><th>Correct answer</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

function rawReplies(view) {
  const replies = view.attempts.filter((a) => a.raw_output !== undefined);
  if (!replies.length) return "";
  return `<details class="raw"><summary>What the AI actually replied (${replies.length} attempt${replies.length === 1 ? "" : "s"})</summary>
    ${replies.map((a) => `<div class="msg"><span class="role">Attempt ${a.attempt}</span><pre>${esc(a.raw_output)}</pre></div>`).join("")}</details>`;
}

function checksList(view) {
  const icon = (c) => (c.passed === true ? "✅" : c.passed === false ? "❌" : "➖");
  return `<ul class="checks ${view.checks_run ? "" : "dim"}">${view.checks.map((c) => `
    <li><span class="${c.passed === false ? "bad" : "ok"}">${icon(c)}</span> ${esc(c.name)}<span class="group">${esc(c.group)}${c.passed === null ? " · skipped" : ""}</span>
    ${c.passed === false ? c.details.map((d) => `<span class="detail">${esc(d)}</span>`).join("") : ""}</li>`).join("")}</ul>`;
}

/* ---------- 2. Try it ---------- */
const OWN_DOC = "__own__";
const isOwnDoc = () => $("#try-doc").value === OWN_DOC;

function applyOwnDocMode() {
  const own = isOwnDoc();
  $("#own-panel").hidden = !own;
  const task = currentTask();
  if (task) {
    $("#own-task-name").textContent = task.title;
    $("#own-task-hint").textContent = task.task === "invoice_extraction"
      ? "The AI will look for invoice details; anything that is not an invoice should be sent for human review. To try general text, choose the task \"Key facts from any text\"."
      : "Works on any text: it writes a short summary and lists key points, names, dates, numbers and action items, each of which must be backed by the text.";
    $("#own-text").placeholder = task.task === "invoice_extraction" ? "Paste invoice text here" : "Paste any text here: an email, meeting notes, an article…";
  }
  const replayRadio = document.querySelector('input[name="try-source"][value="replay"]');
  const liveOnly = own || $("#try-doc").value.startsWith("ex_");
  replayRadio.disabled = liveOnly;
  if (liveOnly && replayRadio.checked) {
    document.querySelector('input[name="try-source"][value="live"]').checked = true;
    refreshTryModels();
  }
}

async function readOwnText() {
  const file = $("#own-file").files[0];
  if (file) {
    if (file.size > 400_000) throw new Error("That file is too large. Use a text file under about 200,000 characters.");
    return { text: await file.text(), filename: file.name };
  }
  return { text: $("#own-text").value, filename: "pasted_text.txt" };
}

function sourceLabel(s, withMode) {
  const extras = [];
  if (!s.complete) extras.push(`partial: ${s.docs} docs`);
  if (s.retries) extras.push(`${s.retries} fixed on retry`);
  if (s.mode !== "harness" && s.wrong_docs.length) extras.push(`${s.wrong_docs.length} wrong`);
  return `${s.model_label}${withMode ? ` · ${SHORT_MODE[s.mode]}` : ""} · run ${s.run_label}${extras.length ? ` (${extras.join(", ")})` : ""}`;
}

function selectedTrySource() {
  const [model, run] = $("#try-model").value.split("|");
  return overview.sources.find((s) => s.model === model && s.run === run && s.mode === $("#try-mode").value);
}

function refreshTryDocs() {
  const source = document.querySelector('input[name="try-source"]:checked').value;
  const s = source === "replay" ? selectedTrySource() : null;
  const task = currentTask();
  const examples = task?.has_examples !== false;
  const mark = (id) => (s && s.retried_docs.includes(id) ? "🔁 " : s && s.wrong_docs.includes(id) ? "✗ " : "");
  const preferred = !examples || isOwnDoc() ? OWN_DOC : s && (s.retried_docs[0] || s.wrong_docs[0]);
  const current = $("#try-doc").value;
  fill($("#try-doc"), [[OWN_DOC, "📄 Your own document (upload or paste)…"],
    ...(overview.examples || []).map((e) => [e.doc_id, `📝 Example text: ${e.name}`]),
    ...(examples ? overview.documents.map((d) => [d.doc_id, `${mark(d.doc_id)}${docLabel(d)}`]) : [])],
    current.startsWith("ex_") ? current : preferred || undefined);
  if (!preferred && $("#try-doc").value === OWN_DOC && overview.documents.length) $("#try-doc").value = overview.documents[0].doc_id;
  applyOwnDocMode();
}

function refreshTryModels() {
  const source = document.querySelector('input[name="try-source"]:checked').value;
  const mode = $("#try-mode").value;
  let items;
  if (source === "live") {
    items = overview.live_models.map((m) => [m.model, m.model_label]);
    $("#try-note").textContent = "Live calls Claude through the approved AWS account right now. Needs a valid AWS sign-in; Opus can take ~10 seconds.";
  } else {
    const matching = overview.sources.filter((s) => s.mode === mode)
      .sort((a, b) => (b.retries || 0) - (a.retries || 0) || b.wrong_docs.length - a.wrong_docs.length);
    items = matching.map((s) => [`${s.model}|${s.run}`, sourceLabel(s, false)]);
    $("#try-note").textContent = items.length
      ? "Saved run: replays the exact answer recorded earlier, so the demo works without a network connection. In the document list, ✗ = this setup got it wrong, 🔁 = the harness fixed it on retry."
      : "No saved run for this mode yet. Switch to Live or choose another mode.";
  }
  fill($("#try-model"), items, items[0]?.[0]);
  refreshTryDocs();
}

function setSteps(done) {
  $("#steps-hint").hidden = done < STEP_ORDER.length;
  document.querySelectorAll("#try-steps li").forEach((li) => li.classList.toggle("done", STEP_ORDER.indexOf(li.dataset.step) < done));
  document.querySelectorAll("#try-output .reveal").forEach((panel) => panel.classList.toggle("shown", STEP_ORDER.indexOf(panel.dataset.step) < done));
}

function renderTryDocument() {
  if (!tryDocData) return;
  $("#try-document").innerHTML = tryDocView === "raw" ? showRawWithMarkers(tryDocData.raw) : esc(tryDocData.cleaned);
  document.querySelectorAll("[data-docview]").forEach((b) => b.classList.toggle("on", b.dataset.docview === tryDocView));
}

async function runTry() {
  const button = $("#try-run");
  const source = document.querySelector('input[name="try-source"]:checked').value;
  const [model, run] = $("#try-model").value.split("|");
  const payload = { task: $("#try-task").value, doc_id: $("#try-doc").value, mode: $("#try-mode").value, model };
  $("#try-error").hidden = true;
  if (!payload.model) { $("#try-error").textContent = "Choose a model first."; $("#try-error").hidden = false; return; }
  button.disabled = true; button.textContent = source === "live" ? "Calling the AI…" : "Loading…";
  $("#try-output").hidden = false; setSteps(1);
  try {
    let view;
    if (isOwnDoc()) {
      const own = await readOwnText();
      if (!own.text.trim()) throw new Error("Upload a text file or paste some text first.");
      tryDocData = { raw: own.text, cleaned: own.text, meta: {} };
      renderTryDocument();
      $("#try-tricks").innerHTML = `Your document: <span class="tag">${esc(own.filename)}</span>`;
      setSteps(2);
      view = await api("/api/live-text", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: own.text, filename: own.filename, mode: payload.mode, model, task: payload.task }) });
      tryDocData = { ...tryDocData, ...view.document };
      renderTryDocument();
    } else {
      tryDocData = await api(`/api/documents/${encodeURIComponent(payload.doc_id)}?task=${encodeURIComponent(payload.task)}`);
      renderTryDocument();
      const tricks = (tryDocData.meta.tricks || []).map((t) => `<span class="tag">${esc(TRICK_LABELS[t] || t)}</span>`).join("");
      $("#try-tricks").innerHTML = tricks ? `Traps in this document: ${tricks}` : "";
      setSteps(2);
      view = source === "live"
        ? await api("/api/live", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : await api(`/api/replay?${new URLSearchParams({ ...payload, run })}`);
    }
    renderTryView(view);
    for (let step = 3; step <= STEP_ORDER.length; step += 1) {
      await new Promise((resolve) => setTimeout(resolve, 380));
      setSteps(step);
    }
  } catch (error) {
    $("#try-error").textContent = error.message; $("#try-error").hidden = false; setSteps(0); $("#try-output").hidden = true;
  } finally {
    button.disabled = false; button.textContent = "Run ▶";
  }
}

function renderTryView(view) {
  $("#try-result").innerHTML = statusBlock(view);
  $("#try-template").textContent = view.template ? `template ${view.template}` : "no template: one-line prompt";
  const first = view.attempts[0]?.messages || [];
  $("#try-prompt").innerHTML = first.map((m) => `<div class="msg"><span class="role">${esc(m.role)}</span><pre>${esc(m.content)}</pre></div>`).join("");
  $("#try-ai-panel h3").textContent = view.has_answer_key ? "AI answer vs correct answer" : "AI answer (no answer key for this text)";
  $("#try-fields").innerHTML = fieldsTable(view) + rawReplies(view);
  const note = $("#try-checks-note");
  note.hidden = view.checks_run;
  note.textContent = "This mode does not run these checks. They are shown here only to reveal what the full harness would have caught.";
  $("#try-checks").innerHTML = checksList(view);
  if (view.attempts.length > 1) {
    const failed = view.attempts[0].issues || [];
    const feedback = view.attempts[1].messages.at(-1)?.content || "";
    $("#try-retry").innerHTML = `<div class="retry"><b>🔁 Attempt 1 failed ${failed.length} check${failed.length === 1 ? "" : "s"}:</b>
      <ul>${failed.map((i) => `<li>${esc(i.message)}</li>`).join("")}</ul>
      <details><summary>Feedback sent back to the AI</summary><pre class="doc">${esc(feedback)}</pre></details></div>`;
  } else {
    $("#try-retry").innerHTML = "";
  }
}

/* ---------- 3. Side by side ---------- */
function sourceOptions() {
  return overview.sources.map((s) => [`${s.model}|${s.mode}|${s.run}`, sourceLabel(s, true)]);
}

function defaultPair() {
  const haiku = overview.sources.filter((s) => s.model.includes("haiku"));
  const pool = haiku.length ? haiku : overview.sources;
  const right = pool.filter((s) => s.mode === "harness").sort((a, b) => (b.retries || 0) - (a.retries || 0))[0]
    || pool.find((s) => s.mode === "template") || pool.at(-1);
  const left = pool.find((s) => s.mode === "plain" && right && s.run === right.run) || pool.find((s) => s.mode === "plain") || pool[0];
  return [left, right].map((s) => (s ? `${s.model}|${s.mode}|${s.run}` : ""));
}

function cmpSide(id) {
  const [model, mode, run] = $(id).value.split("|");
  return { model, mode, run };
}

async function refreshDifferences() {
  if (!overview) return;
  const l = cmpSide("#cmp-left");
  const r = cmpSide("#cmp-right");
  let differing = [];
  if (l.model && r.model) {
    try {
      differing = (await api(`/api/differences?${new URLSearchParams({ left_model: l.model, left_mode: l.mode, left_run: l.run,
        right_model: r.model, right_mode: r.mode, right_run: r.run })}`)).doc_ids;
    } catch { differing = []; }
  }
  const current = $("#cmp-doc").value;
  fill($("#cmp-doc"), overview.documents.map((d) => [d.doc_id, `${differing.includes(d.doc_id) ? "★ " : ""}${docLabel(d)}`]),
    differing.includes(current) || !differing.length ? current : differing[0]);
  $("#cmp-note").textContent = l.mode === r.mode
    ? `Both sides use the same mode (${SHORT_MODE[l.mode]}), so the answers will usually be the same. For the clearest demo, choose Plain on the left and Harness on the right.`
    : differing.length
      ? `★ ${differing.length} document(s) where the left setup was wrong and the right one was right.`
      : "Choose two saved setups. Documents marked ★ show a difference.";
}

function sideHtml(view) {
  const wrong = view.fields.filter((f) => !f.correct).length;
  const passedChecks = view.checks.filter((c) => c.passed === true).length;
  const failedChecks = view.checks.filter((c) => c.passed === false).length;
  return `<div class="side-title"><h3>${esc(view.model_label)} · ${esc(view.mode_label)}</h3>
      <span class="${wrong ? "bad" : "ok"}"><b>${wrong ? `${wrong} wrong` : "all correct"}</b></span></div>
    ${statusBlock(view)}<br>${fieldsTable(view)}
    <p class="small">${view.checks_run ? `Checks run: ${passedChecks}/${view.checks.length} passed.` : `No checks run. The harness checks would have found ${failedChecks} problem(s).`}</p>`;
}

async function runCompare() {
  const l = cmpSide("#cmp-left");
  const r = cmpSide("#cmp-right");
  const docId = $("#cmp-doc").value;
  $("#cmp-error").hidden = true;
  try {
    const [left, right, doc] = await Promise.all([
      api(`/api/replay?${new URLSearchParams({ ...l, doc_id: docId })}`),
      api(`/api/replay?${new URLSearchParams({ ...r, doc_id: docId })}`),
      api(`/api/documents/${encodeURIComponent(docId)}`),
    ]);
    $("#cmp-left-out").innerHTML = sideHtml(left);
    $("#cmp-right-out").innerHTML = sideHtml(right);
    $("#cmp-document").textContent = doc.cleaned;
    $("#cmp-output").hidden = false; $("#cmp-doc-panel").hidden = false;
  } catch (error) {
    $("#cmp-error").textContent = error.message; $("#cmp-error").hidden = false;
  }
}

/* ---------- 4. Results ---------- */
function headline(rows) {
  const plain = rows.filter((r) => r.mode === "plain" && r.cost_usd !== null);
  if (!plain.length) return "Finish at least one plain run and one harness run to see the headline.";
  const ref = plain.reduce((a, b) => (b.cost_usd > a.cost_usd ? b : a));
  const harnessRows = rows.filter((r) => r.mode === "harness" && r.cost_usd !== null);
  const better = harnessRows.length ? harnessRows : rows.filter((r) => r.mode === "template" && r.cost_usd !== null);
  if (!better.length) return "Finish a harness run to compare against the plain prompt.";
  const good = better.filter((r) => r.fully_correct >= ref.fully_correct && r.silent_errors <= ref.silent_errors);
  const pick = (good.length ? good : better).reduce((a, b) => (b.cost_usd < a.cost_usd ? b : a));
  const speed = ref.avg_seconds / Math.max(pick.avg_seconds, 0.01);
  const cost = ref.cost_usd / Math.max(pick.cost_usd, 1e-9);
  return `${esc(pick.model_label)} + ${esc(SHORT_MODE[pick.mode].toLowerCase())}: ${pick.fully_correct}/${pick.docs} correct, ${pick.format_errors} format errors, ${pick.silent_errors} silent errors.
    <small>vs ${esc(ref.model_label)} with a plain prompt: ${ref.fully_correct}/${ref.docs} correct, ${ref.format_errors} format errors, ${ref.silent_errors} silent errors.
    ${speed >= 1 ? `${speed.toFixed(1)}× faster` : `${(1 / speed).toFixed(1)}× slower`} and about ${cost >= 1 ? `${Math.round(cost)}× cheaper` : `${(1 / cost).toFixed(1)}× more expensive`} (list prices).</small>`;
}

function chart(title, rows, key, format, lowerIsBetter) {
  const max = Math.max(...rows.map((r) => r[key] ?? 0), 1e-9);
  return `<div class="panel"><h3>${title} <span class="small">${lowerIsBetter ? "(lower is better)" : "(higher is better)"}</span></h3>
    ${rows.map((r) => `<div class="bar-row"><span>${esc(r.model_label.replace("Claude ", ""))} · ${SHORT_MODE[r.mode]}</span>
      <div class="bar ${r.mode === "harness" ? "harness" : ""}" style="width:${((r[key] ?? 0) / max) * 100}%"></div>
      <span class="bar-val">${format(r[key])}</span></div>`).join("")}</div>`;
}

async function loadResults() {
  try {
    const { rows, price_note: priceNote } = await api("/api/results");
    if (!rows.length) { $("#res-headline").textContent = "No completed runs yet."; return; }
    const counts = rows.reduce((m, r) => m.set(r.docs, (m.get(r.docs) || 0) + 1), new Map());
    const commonDocs = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
    const comparable = rows.filter((r) => r.docs === commonDocs);
    $("#res-title").textContent = `Results on ${commonDocs} invoices`;
    $("#res-headline").innerHTML = headline(comparable)
      + (comparable.length < rows.length ? `<small>${rows.length - comparable.length} run(s) used a different number of invoices and are not included in this comparison.</small>` : "");
    $("#res-table").innerHTML = `<thead><tr><th>Model</th><th>Mode</th><th>Fully correct</th><th>Field accuracy</th><th>Format errors</th>
      <th>Values not in document</th><th>Flagged for review</th><th>Silent errors</th><th>Retries</th><th>Avg s/doc</th><th>Est. cost</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.model_label)}</td><td>${esc(r.mode_label)}</td><td><b>${r.fully_correct}/${r.docs}</b></td>
        <td>${(r.field_accuracy * 100).toFixed(1)}%</td><td>${r.format_errors}</td><td>${r.invented_values}</td><td>${r.flagged_for_review}</td>
        <td><b>${r.silent_errors}</b></td><td>${r.retries}</td><td>${r.avg_seconds}</td><td>${money(r.cost_usd)}</td></tr>`).join("")}</tbody>`;
    $("#res-charts").innerHTML = [
      chart("Fully correct invoices", rows, "fully_correct", (v) => v, false),
      chart("Silent errors (wrong, nobody warned)", rows, "silent_errors", (v) => v, true),
      chart("Format errors", rows, "format_errors", (v) => v, true),
      chart("Seconds per invoice", rows, "avg_seconds", (v) => v.toFixed(1), true),
      chart("Estimated cost for 30 invoices", rows, "cost_usd", money, true),
    ].join("");
    $("#res-note").textContent = `${priceNote} Test set: ${commonDocs} synthetic invoices with known answers. "Values not in document" counts answers that do not match anything printed in the invoice after normalising formats, for example a discount written as a negative number.`;
  } catch (error) {
    $("#res-headline").textContent = error.message;
  }
}

/* ---------- start ---------- */
async function init() {
  overview = await api("/api/overview");
  fill($("#try-task"), overview.tasks.map((t) => [t.id, `${t.title || t.task.replace(/_/g, " ")} (v${t.version})`]));
  fill($("#try-mode"), overview.modes.map((m) => [m.id, m.label]), "harness");
  refreshTryModels();
  fill($("#cmp-left"), sourceOptions(), defaultPair()[0]);
  fill($("#cmp-right"), sourceOptions(), defaultPair()[1]);

  $("#try-mode").addEventListener("change", refreshTryModels);
  $("#try-task").addEventListener("change", refreshTryDocs);
  $("#try-model").addEventListener("change", refreshTryDocs);
  $("#try-doc").addEventListener("change", applyOwnDocMode);
  $("#own-file").addEventListener("change", () => {
    const file = $("#own-file").files[0];
    $("#own-file-info").textContent = file ? `Selected: ${file.name} (${Math.ceil(file.size / 1024)} KB). The pasted text box is ignored while a file is selected. Click "Remove file" to use pasted text instead.` : "";
    $("#own-file-clear").hidden = !file;
  });
  $("#own-file-clear").addEventListener("click", () => {
    $("#own-file").value = "";
    $("#own-file-info").textContent = "";
    $("#own-file-clear").hidden = true;
    $("#own-text").focus();
  });
  document.querySelectorAll('input[name="try-source"]').forEach((r) => r.addEventListener("change", refreshTryModels));
  $("#try-run").addEventListener("click", runTry);
  document.querySelectorAll("[data-docview]").forEach((b) => b.addEventListener("click", () => { tryDocView = b.dataset.docview; renderTryDocument(); }));
  $("#cmp-left").addEventListener("change", refreshDifferences);
  $("#cmp-right").addEventListener("change", refreshDifferences);
  $("#cmp-run").addEventListener("click", runCompare);
  document.querySelectorAll("#try-steps li").forEach((li) => {
    li.addEventListener("click", () => jumpToStep(li.dataset.step));
    li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); jumpToStep(li.dataset.step); } });
  });
  window.addEventListener("hashchange", route);
  route();
}

init().catch((error) => {
  document.querySelector("main").insertAdjacentHTML("afterbegin", `<div class="error">Could not load the app: ${esc(error.message)}</div>`);
});
