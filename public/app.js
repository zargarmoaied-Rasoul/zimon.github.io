const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
let currentTeacher = null;
let exams = [];
let authMode = "login";
let currentPublicExam = null;
let examTimerInterval = null;
let questionCount = 0;
let toastTimer;

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "خطایی رخ داد. دوباره تلاش کن.");
  return data;
}
function toast(message, isError = false) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.remove("hidden", "error");
  if (isError) el.classList.add("error");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 4500);
}
function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}
function go(view) {
  if (view === "create" && !currentTeacher) { authMode = "login"; renderAuth(); view = "auth"; }
  if (view === "exams" && !currentTeacher) { authMode = "login"; renderAuth(); view = "auth"; }
  if (view === "results" && !currentTeacher) { authMode = "login"; renderAuth(); view = "auth"; }
  $$(".view").forEach(v => v.classList.add("hidden"));
  const target = $("#view-" + view);
  if (target) target.classList.remove("hidden");
  $$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  $("#hero").classList.toggle("hidden", view !== "home");
  if (view === "home") loadExams().catch(() => {});
  if (view === "exams") renderExams().catch(e => toast(e.message, true));
  if (view === "results") populateResultsSelect();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
document.addEventListener("click", e => {
  const nav = e.target.closest("[data-view]");
  if (nav) { e.preventDefault(); go(nav.dataset.view); }
});
function renderAuth() {
  const register = authMode === "register";
  $("#authTitle").textContent = register ? "ساخت حساب معلم" : "ورود معلم";
  $("#registerNameWrap").classList.toggle("hidden", !register);
  $("#teacherName").required = register;
  $("#authSubmit").textContent = register ? "ساخت حساب و ورود" : "ورود";
  $("#authSwitchText").textContent = register ? "قبلاً حساب ساختی؟" : "حساب نداری؟";
  $("#authSwitch").textContent = register ? "ورود معلم" : "ثبت‌نام معلم";
  $("#teacherPassword").autocomplete = register ? "new-password" : "current-password";
}
$("#authButton").addEventListener("click", () => {
  authMode = currentTeacher ? "logout" : "login";
  if (currentTeacher) {
    api("/api/auth/logout", { method: "POST", body: "{}" }).then(() => {
      currentTeacher = null; exams = []; updateAccount(); go("home"); toast("از حساب معلم خارج شدی.");
    }).catch(e => toast(e.message, true));
  } else { renderAuth(); go("auth"); }
});
$("#authSwitch").addEventListener("click", () => {
  authMode = authMode === "login" ? "register" : "login";
  renderAuth();
});
$("#authForm").addEventListener("submit", async e => {
  e.preventDefault();
  const body = {
    name: $("#teacherName").value.trim(),
    email: $("#teacherEmail").value.trim(),
    password: $("#teacherPassword").value
  };
  try {
    const data = await api(authMode === "register" ? "/api/auth/register" : "/api/auth/login", {
      method: "POST", body: JSON.stringify(body)
    });
    currentTeacher = data.teacher;
    $("#authForm").reset();
    updateAccount();
    await loadExams();
    go("home");
    toast("خوش اومدی " + currentTeacher.name + "!");
  } catch (err) { toast(err.message, true); }
});
function updateAccount() {
  $("#accountLabel").textContent = currentTeacher ? currentTeacher.name : "فضای آموزشی هوشمند";
  $("#authButton").textContent = currentTeacher ? "خروج از حساب" : "ورود معلم";
}
function updateStats() {
  $("#statExams").textContent = currentTeacher ? exams.length : "—";
  $("#statSubmissions").textContent = currentTeacher ? exams.reduce((n, e) => n + (e.submissionCount || 0), 0) : "—";
}
async function loadExams() {
  if (!currentTeacher) {
    $("#homeExamList").innerHTML = `<div class="empty-state"><span>▤</span><b>برای مدیریت آزمون‌ها وارد حساب معلم شو</b><p>حساب معلم بساز، آزمون ایجاد کن و کد اختصاصی بگیر.</p><button class="btn btn-secondary" data-view="auth">ورود / ثبت‌نام</button></div>`;
    updateStats(); return;
  }
  const data = await api("/api/exams");
  exams = data.exams;
  updateStats();
  $("#homeExamList").innerHTML = exams.length ? exams.slice(0, 3).map(examRow).join("") : `<div class="empty-state"><span>▤</span><b>هنوز آزمونی ساخته نشده</b><p>اولین آزمونت رو بساز تا اینجا ظاهر بشه.</p><button class="btn btn-secondary" data-view="create">ساخت اولین آزمون</button></div>`;
}
function examRow(exam) {
  return `<article class="exam-row">
    <div class="exam-icon">✎</div>
    <div class="exam-main"><h3>${escapeHTML(exam.title)}</h3><p>${escapeHTML(exam.subject)} · ${exam.duration} دقیقه · ${exam.questions.length} سؤال · ${exam.submissionCount || 0} پاسخ</p></div>
    <span class="code-badge">${escapeHTML(exam.code)}</span>
    <div class="exam-actions">
      <button class="btn btn-secondary btn-sm" data-copy="${escapeHTML(exam.code)}">کپی کد</button>
      <button class="btn btn-secondary btn-sm" data-results="${escapeHTML(exam.id)}">نتایج</button>
    </div>
  </article>`;
}
async function renderExams() {
  await loadExams();
  $("#examList").innerHTML = exams.length ? exams.map(examRow).join("") : `<div class="empty-state"><span>▤</span><b>هنوز آزمونی نداری</b><p>با ساخت آزمون، کد اختصاصی برای دانش‌آموزها می‌گیری.</p><button class="btn btn-primary" data-view="create">＋ ساخت آزمون</button></div>`;
}
document.addEventListener("click", async e => {
  const copy = e.target.closest("[data-copy]");
  if (copy) {
    try { await navigator.clipboard.writeText(copy.dataset.copy); toast("کد آزمون کپی شد: " + copy.dataset.copy); }
    catch { toast("کد آزمون: " + copy.dataset.copy + " (اگر کپی نشد، دستی انتخابش کن)"); }
  }
  const resultBtn = e.target.closest("[data-results]");
  if (resultBtn) {
    go("results");
    $("#resultsExamSelect").value = resultBtn.dataset.results;
    loadResults(resultBtn.dataset.results).catch(err => toast(err.message, true));
  }
});
function addQuestion(defaultType = "choice") {
  questionCount++;
  const template = $("#questionTemplate").content.cloneNode(true);
  const card = $(".question-card", template);
  $(".question-number", card).textContent = "سؤال " + questionCount;
  $(".q-type", card).value = defaultType;
  const editor = $(".options-editor", card);
  for (let i = 0; i < 4; i++) {
    const row = document.createElement("div");
    row.className = "option-edit";
    row.innerHTML = `<input type="radio" name="correct-${questionCount}" ${i === 0 ? "checked" : ""} aria-label="پاسخ صحیح"><input type="text" maxlength="300" placeholder="گزینه ${i + 1}" value="${i === 0 ? "گزینه اول" : i === 1 ? "گزینه دوم" : i === 2 ? "گزینه سوم" : "گزینه چهارم"}">`;
    editor.appendChild(row);
  }
  $(".remove-question", card).addEventListener("click", () => { card.remove(); renumberQuestions(); });
  $(".q-type", card).addEventListener("change", () => toggleQuestionType(card));
  $("#questionBuilder").appendChild(card);
  toggleQuestionType(card);
  renumberQuestions();
}
function toggleQuestionType(card) {
  const choice = $(".q-type", card).value === "choice";
  $(".choice-fields", card).classList.toggle("hidden", !choice);
}
function renumberQuestions() {
  $$(".question-card").forEach((card, i) => $(".question-number", card).textContent = "سؤال " + (i + 1));
}
$("#addQuestion").addEventListener("click", () => addQuestion());
$("#createForm").addEventListener("submit", async e => {
  e.preventDefault();
  const questions = $$(".question-card").map(card => {
    const q = { text: $(".q-text", card).value.trim(), type: $(".q-type", card).value, points: Number($(".q-points", card).value) || 1 };
    if (q.type === "choice") {
      const rows = $$(".option-edit", card);
      q.options = rows.map(row => $("input[type=text]", row).value.trim()).filter(Boolean);
      q.correctIndex = rows.findIndex(row => $("input[type=radio]", row).checked);
      if (q.correctIndex >= q.options.length) q.correctIndex = 0;
    }
    return q;
  });
  try {
    const data = await api("/api/exams", { method: "POST", body: JSON.stringify({
      title: $("#examTitle").value.trim(), subject: $("#examSubject").value.trim(),
      duration: Number($("#examDuration").value), questions
    })});
    $("#createForm").reset();
    $("#questionBuilder").innerHTML = "";
    questionCount = 0; addQuestion();
    await loadExams(); go("exams");
    toast("آزمون ساخته شد! کد اختصاصی: " + data.exam.code);
  } catch (err) { toast(err.message, true); }
});
$("#joinForm").addEventListener("submit", async e => {
  e.preventDefault();
  const code = $("#examCode").value.trim().toUpperCase();
  try {
    const data = await api(`/api/exams/${encodeURIComponent(code)}/public`);
    currentPublicExam = { ...data.exam, expiresAt: data.expiresAt };
    renderStudentExam(currentPublicExam);
    toast("آزمون پیدا شد. با دقت پاسخ بده.");
  } catch (err) { $("#studentExam").classList.add("hidden"); toast(err.message, true); }
});
function renderStudentExam(exam) {
  const host = $("#studentExam");
  host.classList.remove("hidden");
  if (examTimerInterval) clearInterval(examTimerInterval);
  host.innerHTML = `<div class="panel student-paper"><div class="paper-top"><div><h3>${escapeHTML(exam.title)}</h3><div class="paper-meta">${escapeHTML(exam.subject)} · ${exam.questions.length} سؤال</div></div><span class="code-badge">${escapeHTML(exam.code)}</span></div>
  <div class="toast" id="examCountdown" role="timer">زمان باقی‌مانده: محاسبه...</div>
  <form id="studentAnswerForm"><div id="studentQuestions"></div><button class="btn btn-primary full" type="submit">ثبت نهایی پاسخ‌ها ←</button><p class="muted">پس از پایان زمان، ثبت پاسخ‌ها بسته می‌شود.</p></form></div>`;
  $("#studentQuestions").innerHTML = exam.questions.map((q, i) => {
    const answer = q.type === "choice"
      ? `<div class="student-options">${q.options.map((opt, j) => `<label class="student-option"><input type="radio" name="answer-${escapeHTML(q.id)}" value="${j}" required> ${escapeHTML(opt)}</label>`).join("")}</div>`
      : `<textarea class="student-answer" name="answer-${escapeHTML(q.id)}" rows="4" maxlength="3000" required placeholder="پاسخ تشریحی خود را بنویس..."></textarea>`;
    return `<article class="student-question"><h4>${i + 1}. ${escapeHTML(q.text)} <span class="muted">(${q.points} نمره)</span></h4>${answer}</article>`;
  }).join("");
  $("#studentAnswerForm").addEventListener("submit", submitStudentAnswers);
  const tick = () => {
    const seconds = Math.max(0, Math.ceil((exam.expiresAt - Date.now()) / 1000));
    const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
    const ss = String(seconds % 60).padStart(2, "0");
    const counter = $("#examCountdown");
    if (counter) counter.textContent = seconds > 0 ? `زمان باقی‌مانده: ${mm}:${ss}` : "زمان آزمون تمام شد؛ دیگر امکان ثبت پاسخ نیست.";
    if (seconds <= 0) {
      clearInterval(examTimerInterval);
      const form = $("#studentAnswerForm");
      if (form) { form.querySelectorAll("input, textarea, button").forEach(el => el.disabled = true); }
    }
  };
  tick();
  examTimerInterval = setInterval(tick, 1000);
}
async function submitStudentAnswers(e) {
  e.preventDefault();
  if (!currentPublicExam) return;
  const answers = {};
  for (const q of currentPublicExam.questions) {
    if (q.type === "choice") {
      const selected = $(`input[name="answer-${q.id}"]:checked`);
      if (!selected) return toast("لطفاً به همه سؤال‌ها پاسخ بده.", true);
      answers[q.id] = selected.value;
    } else {
      const field = $(`[name="answer-${q.id}"]`);
      if (!field.value.trim()) return toast("لطفاً به همه سؤال‌ها پاسخ بده.", true);
      answers[q.id] = field.value.trim();
    }
  }
  try {
    const data = await api(`/api/exams/${encodeURIComponent(currentPublicExam.code)}/submit`, {
      method: "POST", body: JSON.stringify({ studentName: $("#studentName").value.trim(), answers })
    });
    const result = data.result;
    $("#studentAnswerForm").innerHTML = `<div class="result-summary"><strong>${result.earned} از ${result.total}</strong><p>پاسخ‌ها با موفقیت ثبت شد. ${result.needsManualGrading ? "سؤال‌های تشریحی باید توسط معلم تصحیح شوند." : "نمره تستی به‌صورت خودکار محاسبه شد."}</p></div><p>ممنون که در آزمون شرکت کردی 🌟</p>`;
    toast("پاسخ‌ها با موفقیت ثبت شد.");
  } catch (err) { toast(err.message, true); }
}
function populateResultsSelect() {
  const select = $("#resultsExamSelect");
  select.innerHTML = exams.length ? exams.map(e => `<option value="${escapeHTML(e.id)}">${escapeHTML(e.title)} · ${escapeHTML(e.code)}</option>`).join("") : `<option value="">ابتدا آزمون بساز</option>`;
  if (exams.length) loadResults(select.value).catch(err => toast(err.message, true));
}
$("#resultsExamSelect").addEventListener("change", e => {
  if (e.target.value) loadResults(e.target.value).catch(err => toast(err.message, true));
});
async function loadResults(examId) {
  if (!examId) return;
  const data = await api(`/api/exams/${encodeURIComponent(examId)}/results`);
  const host = $("#resultsList");
  if (!data.submissions.length) {
    host.innerHTML = `<div class="empty-state"><span>▥</span><b>هنوز پاسخی ثبت نشده</b><p>وقتی دانش‌آموزها امتحان رو ارسال کنن، نتیجه‌ها اینجا نمایش داده می‌شن.</p></div>`;
    return;
  }
  host.innerHTML = data.submissions.map(s => `<article class="result-card"><h4>${escapeHTML(s.studentName)}</h4><p>نمره خودکار: <b>${s.earned} از ${s.total}</b> ${s.autoGraded ? "" : "· نیازمند تصحیح تشریحی"}</p><p>زمان ثبت: ${new Date(s.submittedAt).toLocaleString("fa-IR")}</p>
  ${s.answers.map((a, i) => `<div class="student-question"><p><b>${i + 1}. ${escapeHTML(a.question)}</b></p><p>پاسخ دانش‌آموز: ${escapeHTML(a.answer || "—")}</p>${a.type === "choice" ? `<p class="${a.correct ? "answer-correct" : "answer-wrong"}">${a.correct ? "✓ پاسخ صحیح" : "پاسخ صحیح: " + escapeHTML(a.correctAnswer)}</p>` : `<p class="muted">پاسخ تشریحی؛ تصحیح دستی لازم است.</p>`}</div>`).join("")}</article>`).join("");
}
async function boot() {
  try {
    const data = await api("/api/me");
    currentTeacher = data.teacher;
    updateAccount();
    if (currentTeacher) await loadExams();
  } catch {}
  addQuestion();
  go("home");
}
boot();
