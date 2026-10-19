const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
// Render terminates HTTPS at its proxy; trust it so secure session cookies work.
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data.json");

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: process.env.SESSION_SECRET || "change-this-secret-before-deploying-azmoon-plus",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 8
  }
}));
app.use(express.static(path.join(__dirname, "public")));

function loadDB() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const initial = { teachers: [], exams: [], submissions: [] };
      fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
      return initial;
    }
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return {
      teachers: parsed.teachers || [],
      exams: parsed.exams || [],
      submissions: parsed.submissions || []
    };
  } catch (err) {
    console.error("Database read error:", err);
    return { teachers: [], exams: [], submissions: [] };
  }
}
let db = loadDB();

function saveDB() {
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
function safeTeacher(t) {
  return t ? { id: t.id, name: t.name, email: t.email } : null;
}
function publicExam(exam) {
  return {
    id: exam.id, title: exam.title, subject: exam.subject,
    duration: exam.duration, code: exam.code, createdAt: exam.createdAt,
    questions: exam.questions.map((q, i) => ({
      id: q.id, text: q.text, type: q.type, points: q.points,
      options: q.type === "choice" ? q.options : undefined,
      order: i + 1
    }))
  };
}
function auth(req, res, next) {
  if (!req.session.teacherId) return res.status(401).json({ error: "برای این کار ابتدا وارد حساب معلم شوید." });
  const teacher = db.teachers.find(t => t.id === req.session.teacherId);
  if (!teacher) return res.status(401).json({ error: "جلسه شما معتبر نیست؛ دوباره وارد شوید." });
  req.teacher = teacher;
  next();
}
function makeCode() {
  let code;
  do { code = crypto.randomBytes(3).toString("hex").toUpperCase(); }
  while (db.exams.some(e => e.code === code));
  return code;
}
function cleanString(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

app.get("/api/me", (req, res) => {
  const teacher = db.teachers.find(t => t.id === req.session.teacherId);
  res.json({ teacher: safeTeacher(teacher) });
});

app.post("/api/auth/register", async (req, res) => {
  const name = cleanString(req.body.name, 80);
  const email = cleanString(req.body.email, 160).toLowerCase();
  const password = String(req.body.password || "");
  if (name.length < 2) return res.status(400).json({ error: "نام باید حداقل ۲ حرف داشته باشد." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "ایمیل معتبر وارد کنید." });
  if (password.length < 8) return res.status(400).json({ error: "رمز عبور باید حداقل ۸ کاراکتر باشد." });
  if (db.teachers.some(t => t.email === email)) return res.status(409).json({ error: "این ایمیل قبلاً ثبت شده است." });
  const teacher = {
    id: crypto.randomUUID(), name, email,
    passwordHash: await bcrypt.hash(password, 12),
    createdAt: new Date().toISOString()
  };
  db.teachers.push(teacher);
  saveDB();
  req.session.teacherId = teacher.id;
  res.json({ teacher: safeTeacher(teacher) });
});

app.post("/api/auth/login", async (req, res) => {
  const email = cleanString(req.body.email, 160).toLowerCase();
  const password = String(req.body.password || "");
  const teacher = db.teachers.find(t => t.email === email);
  if (!teacher || !(await bcrypt.compare(password, teacher.passwordHash))) {
    return res.status(401).json({ error: "ایمیل یا رمز عبور درست نیست." });
  }
  req.session.teacherId = teacher.id;
  res.json({ teacher: safeTeacher(teacher) });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/exams", auth, (req, res) => {
  const exams = db.exams.filter(e => e.teacherId === req.teacher.id).map(e => ({
    ...publicExam(e),
    submissionCount: db.submissions.filter(s => s.examId === e.id).length
  }));
  res.json({ exams });
});

app.post("/api/exams", auth, (req, res) => {
  const title = cleanString(req.body.title, 120);
  const subject = cleanString(req.body.subject, 80);
  const duration = Number(req.body.duration);
  const rawQuestions = Array.isArray(req.body.questions) ? req.body.questions : [];
  if (title.length < 2 || subject.length < 2) return res.status(400).json({ error: "عنوان آزمون و نام درس را وارد کنید." });
  if (!Number.isInteger(duration) || duration < 1 || duration > 600) return res.status(400).json({ error: "مدت آزمون باید بین ۱ تا ۶۰۰ دقیقه باشد." });
  if (rawQuestions.length < 1 || rawQuestions.length > 100) return res.status(400).json({ error: "آزمون باید بین ۱ تا ۱۰۰ سؤال داشته باشد." });

  const questions = [];
  for (const raw of rawQuestions) {
    const text = cleanString(raw.text, 2000);
    const type = raw.type === "text" ? "text" : "choice";
    const points = Math.max(1, Math.min(100, Number(raw.points) || 1));
    if (!text) return res.status(400).json({ error: "متن همه سؤال‌ها را وارد کنید." });
    if (type === "choice") {
      const options = Array.isArray(raw.options) ? raw.options.map(o => cleanString(o, 300)).filter(Boolean).slice(0, 6) : [];
      const correctIndex = Number(raw.correctIndex);
      if (options.length < 2 || options.length > 6) return res.status(400).json({ error: "هر سؤال تستی باید ۲ تا ۶ گزینه داشته باشد." });
      if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) return res.status(400).json({ error: "پاسخ صحیح هر سؤال تستی را مشخص کنید." });
      questions.push({ id: crypto.randomUUID(), text, type, points, options, correctIndex });
    } else {
      questions.push({ id: crypto.randomUUID(), text, type, points });
    }
  }
  const exam = {
    id: crypto.randomUUID(), teacherId: req.teacher.id, title, subject, duration,
    code: makeCode(), questions, createdAt: new Date().toISOString()
  };
  db.exams.push(exam);
  saveDB();
  res.status(201).json({ exam: publicExam(exam) });
});

app.get("/api/exams/:code/public", (req, res) => {
  const code = cleanString(req.params.code, 12).toUpperCase();
  const exam = db.exams.find(e => e.code === code);
  if (!exam) return res.status(404).json({ error: "آزمونی با این کد پیدا نشد." });
  req.session.examStarts = req.session.examStarts || {};
  const now = Date.now();
  if (!req.session.examStarts[exam.code]) req.session.examStarts[exam.code] = now;
  const startedAt = req.session.examStarts[exam.code];
  const expiresAt = startedAt + exam.duration * 60 * 1000;
  if (now >= expiresAt) return res.status(410).json({ error: "زمان این آزمون برای شما تمام شده است و دیگر نمی‌توانید وارد آن شوید." });
  res.json({ exam: publicExam(exam), expiresAt });
});

app.post("/api/exams/:code/submit", (req, res) => {
  const code = cleanString(req.params.code, 12).toUpperCase();
  const exam = db.exams.find(e => e.code === code);
  if (!exam) return res.status(404).json({ error: "آزمونی با این کد پیدا نشد." });
  const startedAt = req.session.examStarts && req.session.examStarts[exam.code];
  if (!startedAt) return res.status(403).json({ error: "ابتدا از طریق کد وارد آزمون شوید." });
  if (Date.now() >= startedAt + exam.duration * 60 * 1000) return res.status(410).json({ error: "زمان آزمون تمام شده است؛ پاسخ‌ها دیگر ثبت نمی‌شوند." });
  const studentName = cleanString(req.body.studentName, 100);
  const answers = req.body.answers && typeof req.body.answers === "object" ? req.body.answers : {};
  if (studentName.length < 2) return res.status(400).json({ error: "نام دانش‌آموز را وارد کنید." });

  let earned = 0;
  let total = 0;
  let autoGraded = true;
  const reviewedAnswers = exam.questions.map(q => {
    total += q.points;
    const answer = cleanString(answers[q.id], 3000);
    let correct = null;
    if (q.type === "choice") {
      correct = Number(answer) === q.correctIndex;
      if (correct) earned += q.points;
    } else {
      autoGraded = false;
    }
    return { questionId: q.id, answer, correct };
  });
  const submission = {
    id: crypto.randomUUID(), examId: exam.id, studentName,
    answers: reviewedAnswers, earned, total, autoGraded,
    submittedAt: new Date().toISOString()
  };
  db.submissions.push(submission);
  saveDB();
  res.status(201).json({
    message: "پاسخ‌ها با موفقیت ثبت شدند.",
    result: { earned, total, autoGraded, needsManualGrading: !autoGraded }
  });
});

app.get("/api/exams/:id/results", auth, (req, res) => {
  const exam = db.exams.find(e => e.id === req.params.id && e.teacherId === req.teacher.id);
  if (!exam) return res.status(404).json({ error: "آزمون پیدا نشد." });
  const submissions = db.submissions.filter(s => s.examId === exam.id).map(s => ({
    id: s.id, studentName: s.studentName, earned: s.earned, total: s.total,
    autoGraded: s.autoGraded, submittedAt: s.submittedAt,
    answers: s.answers.map(a => {
      const q = exam.questions.find(q => q.id === a.questionId);
      return {
        question: q ? q.text : "",
        answer: a.answer,
        correct: a.correct,
        type: q ? q.type : "text",
        correctAnswer: q && q.type === "choice" ? q.options[q.correctIndex] : null,
        points: q ? q.points : 0
      };
    })
  }));
  res.json({ exam: { id: exam.id, title: exam.title, code: exam.code }, submissions });
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Azmoon Plus is running on port ${PORT}`);
});
