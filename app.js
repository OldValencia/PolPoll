/* ============================================================================
   PolPoll - trener do egzaminu na Kartę Polaka
   ---------------------------------------------------------------------------
   Progress is keyed on the stable question id from questions.js and scheduled
   with SM-2, so the app can answer the only question that matters day to day:
   "what do I have to review today?"
   ========================================================================== */
'use strict';

// questions.js declares a top-level `const`, which lives in script scope and
// never reaches `window` - it has to be referenced lexically.
const DB = (typeof questionsDatabase !== 'undefined' && Array.isArray(questionsDatabase))
    ? questionsDatabase
    : [];

const CONFIG = {
    storageKey: 'polpoll_v2',
    legacyKey: 'polpoll_stats',
    maxRepeatsPerQuestion: 2,   // a wrong answer requeues the card, but not forever
    masteredIntervalDays: 21,
    newCardsPerDay: 12,
    keywordRatio: 0.5,          // tuned: 100% pass for a correct concise answer, 0% false positives
    sprintSeconds: 60,
    sprintPenalty: 2
};

const DAY_MS = 86400000;

/* ---------------------------------------------------------------- storage */

const Store = {
    read(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw === null ? fallback : JSON.parse(raw);
        } catch (err) {
            console.warn('PolPoll: cannot read storage', err);
            return fallback;
        }
    },
    write(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (err) {
            console.warn('PolPoll: cannot write storage', err);
            toast('Nie udało się zapisać postępu (pamięć przeglądarki niedostępna).');
            return false;
        }
    },
    remove(key) {
        try { localStorage.removeItem(key); } catch (err) { /* ignore */ }
    }
};

/* -------------------------------------------------------------------- SRS */

/**
 * state.cards[id] = { ef, reps, interval, due, lapses, correct, wrong, seen, last }
 * `interval` is in days; `due` is the start of the day the card is next needed.
 */
let state = loadState();

function loadState() {
    const saved = Store.read(CONFIG.storageKey, null);
    if (saved && saved.cards) {
        saved.meta = saved.meta || {};
        return saved;
    }
    return migrateLegacy();
}

/** The v1 build stored `{ [questionText]: score }`. Salvage what we can. */
function migrateLegacy() {
    const fresh = { cards: {}, meta: {} };
    const legacy = Store.read(CONFIG.legacyKey, null);
    if (legacy && typeof legacy === 'object') {
        const byQuestion = {};
        DB.forEach(q => { byQuestion[q.question] = q.id; });
        let moved = 0;
        Object.keys(legacy).forEach(questionText => {
            const id = byQuestion[questionText];
            const score = Number(legacy[questionText]);
            if (!id || !Number.isFinite(score) || score <= 0) return;
            const card = blankCard();
            card.reps = Math.min(score, 3);
            card.correct = score;
            card.seen = score;
            card.interval = score >= 3 ? 6 : score >= 2 ? 3 : 1;
            card.due = startOfDay(Date.now()) + card.interval * DAY_MS;
            fresh.cards[id] = card;
            moved++;
        });
        if (moved) fresh.meta.migratedFrom = 'v1';
    }
    return fresh;
}

function blankCard() {
    return { ef: 2.5, reps: 0, interval: 0, due: 0, lapses: 0, correct: 0, wrong: 0, seen: 0, last: 0 };
}

function saveState() {
    Store.write(CONFIG.storageKey, state);
}

function getCard(id) {
    return state.cards[id] || null;
}

function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

/** quality: 0 = blank, 3 = shaky, 5 = solid (SM-2 scale). */
function recordReview(id, quality) {
    const card = state.cards[id] || blankCard();
    card.seen++;
    card.last = Date.now();

    if (quality >= 3) {
        card.correct++;
        if (card.reps === 0) card.interval = 1;
        else if (card.reps === 1) card.interval = 3;
        else card.interval = Math.max(1, Math.round(card.interval * card.ef));
        card.reps++;
    } else {
        card.wrong++;
        card.lapses++;
        card.reps = 0;
        card.interval = 0;               // due again today
    }

    card.ef = Math.max(1.3, card.ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
    card.due = startOfDay(Date.now()) + card.interval * DAY_MS;

    state.cards[id] = card;
    saveState();
}

function cardStatus(question) {
    const card = getCard(question.id);
    if (!card || card.seen === 0) return 'new';
    if (card.interval >= CONFIG.masteredIntervalDays) return 'mastered';
    if (card.lapses >= 2 && card.interval < 3) return 'hard';
    return 'learning';
}

function isDue(question, now) {
    const card = getCard(question.id);
    if (!card || card.seen === 0) return false;
    return card.due <= now;
}

function buildDailyQueue() {
    const now = startOfDay(Date.now()) + DAY_MS - 1;   // anything due by end of today
    const due = DB.filter(q => isDue(q, now));
    const fresh = DB.filter(q => cardStatus(q) === 'new').slice(0, CONFIG.newCardsPerDay);
    // Hardest first: low ease factor means the card keeps slipping.
    due.sort((a, b) => (getCard(a.id).ef - getCard(b.id).ef));
    return due.concat(shuffle(fresh));
}

function registerStudyDay() {
    const today = startOfDay(Date.now());
    const meta = state.meta || (state.meta = {});
    if (meta.lastStudyDay === today) return;
    if (meta.lastStudyDay === today - DAY_MS) meta.streak = (meta.streak || 0) + 1;
    else meta.streak = 1;
    meta.lastStudyDay = today;
    saveState();
}

/* ------------------------------------------------------------- text utils */

function shuffle(array) {
    const out = array.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, ch => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
}

/** Hyphens become spaces so "Bielsko-Biała" survives as two matchable words. */
function normalize(text) {
    return String(text)
        .toLowerCase()
        .replace(/[‐-―\-\/]/g, ' ')
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = new Array(a.length + 1);
    let curr = new Array(a.length + 1);
    for (let j = 0; j <= a.length; j++) prev[j] = j;
    for (let i = 1; i <= b.length; i++) {
        curr[0] = i;
        for (let j = 1; j <= a.length; j++) {
            curr[j] = b.charAt(i - 1) === a.charAt(j - 1)
                ? prev[j - 1]
                : Math.min(prev[j - 1], curr[j - 1], prev[j]) + 1;
        }
        [prev, curr] = [curr, prev];
    }
    return prev[a.length];
}

/**
 * Typos are forgiven in words but never in numbers - on this exam the date is
 * the answer, and accepting "1026" for "1025" teaches the wrong fact.
 */
function fuzzyEquals(word, target) {
    if (word === target) return true;
    if (/\d/.test(target) || /\d/.test(word)) return false;
    const distance = levenshtein(word, target);
    if (target.length > 7 && distance <= 2) return true;
    if (target.length > 4 && distance <= 1) return true;
    // Polish inflection: "Mieszka" for "Mieszko", "polskim" for "polski".
    if (target.length > 5 && word.length > 4 && word.slice(0, 5) === target.slice(0, 5)) return true;
    return false;
}

/**
 * Returns a verdict plus the evidence behind it, so the UI can show the user
 * exactly which parts of their answer counted.
 */
function checkTyping(raw, question) {
    const userWords = normalize(raw).split(' ').filter(Boolean);
    const userSet = new Set(userWords);

    const numbers = (question.numbers || []).map(value => ({
        value,
        ok: userSet.has(value)
    }));

    const keywords = (question.keywords || []).map(keyword => {
        const target = normalize(keyword);
        return { value: keyword, ok: userWords.some(word => fuzzyEquals(word, target)) };
    });

    const matchedWords = keywords.filter(k => k.ok).length;
    const requiredWords = keywords.length
        ? Math.max(1, Math.round(keywords.length * CONFIG.keywordRatio))
        : 0;

    const numbersOk = numbers.every(n => n.ok);
    const wordsOk = matchedWords >= requiredWords;

    let reason = '';
    if (!numbersOk) reason = 'Brakuje daty lub liczby.';
    else if (!wordsOk) reason = 'Brakuje kluczowych informacji.';

    return {
        pass: numbersOk && wordsOk && (numbers.length > 0 || keywords.length > 0),
        numbers, keywords, reason,
        matchedWords, requiredWords,
        userWords
    };
}

/* -------------------------------------------------------- distractors */

/**
 * Wrong options are drawn from the same category AND the same answer shape, so
 * a date question offers dates. Random picks would give the answer away.
 */
function pickDistractors(question, count) {
    const used = new Set([normalize(question.short || question.answer)]);
    const chosen = [];

    // Personal templates ("Moja prababcia...") are never valid options.
    const pool = DB.filter(q => q.id !== question.id && q.type !== 'personal');
    const tiers = [
        pool.filter(q => q.category === question.category && q.type === question.type),
        pool.filter(q => q.type === question.type),
        pool.filter(q => q.category === question.category),
        pool
    ];

    for (const tier of tiers) {
        for (const candidate of shuffle(tier)) {
            if (chosen.length >= count) break;
            const text = optionText(candidate);
            const key = normalize(text);
            if (!text || used.has(key) || key.length < 2) continue;
            // Reject options that merely restate the right answer.
            if (key.includes(normalize(question.short || question.answer)) ) continue;
            used.add(key);
            chosen.push(text);
        }
        if (chosen.length >= count) break;
    }
    return chosen;
}

/** Options must be short enough to scan; fall back to the first sentence. */
function optionText(question) {
    const text = (question.short || question.answer || '').trim();
    if (text.length <= 110) return text;
    return text.slice(0, 107).replace(/\s\S*$/, '') + '…';
}

/* -------------------------------------------------------------------- TTS */

const IS_APPLE = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    || (/Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Android/.test(navigator.userAgent));

const Speech = {
    synth: window.speechSynthesis || null,
    voice: null,
    keepAlive: null,
    unlocked: false,

    init() {
        if (!this.synth) return;
        const pick = () => {
            const voices = this.synth.getVoices() || [];
            this.voice = voices.find(v => v.lang === 'pl-PL')
                || voices.find(v => (v.lang || '').toLowerCase().startsWith('pl'))
                || null;
        };
        pick();
        // Voices load asynchronously in Chrome; without this the first utterance
        // gets the wrong language.
        this.synth.addEventListener('voiceschanged', pick);

        // iOS Safari refuses speech that did not originate in a user gesture.
        // Priming it once with a silent utterance on the first tap unlocks
        // synthesis for the rest of the page session.
        const unlock = () => this.unlock();
        document.addEventListener('pointerdown', unlock, { once: true, capture: true });
        document.addEventListener('keydown', unlock, { once: true, capture: true });
    },

    unlock() {
        if (this.unlocked || !this.synth) return;
        this.unlocked = true;
        try {
            const primer = new SpeechSynthesisUtterance(' ');
            primer.volume = 0;
            primer.lang = 'pl-PL';
            this.synth.speak(primer);
        } catch (err) { /* nothing we can do */ }
    },

    speak(text) {
        if (!this.synth || !text) return;
        this.clearKeepAlive();

        const emit = () => {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'pl-PL';
            if (this.voice) utterance.voice = this.voice;
            utterance.rate = 0.95;
            utterance.onend = () => this.clearKeepAlive();
            utterance.onerror = () => this.clearKeepAlive();
            this.synth.speak(utterance);

            // Chrome silently pauses synthesis after ~15s. The pause/resume poke
            // fixes that, but on Safari it is what *stops* speech - skip it.
            if (!IS_APPLE) {
                this.keepAlive = setInterval(() => {
                    if (!this.synth.speaking) return this.clearKeepAlive();
                    this.synth.pause();
                    this.synth.resume();
                }, 9000);
            }
        };

        if (this.synth.speaking || this.synth.pending) {
            this.synth.cancel();
            // Chrome drops an utterance queued in the same tick as cancel();
            // Safari drops one queued outside the originating user gesture.
            if (IS_APPLE) emit(); else setTimeout(emit, 60);
        } else {
            emit();   // synchronous: keeps us inside the iOS gesture chain
        }
    },

    stop() {
        this.clearKeepAlive();
        if (this.synth) { try { this.synth.cancel(); } catch (err) { /* ignore */ } }
    },

    clearKeepAlive() {
        if (this.keepAlive) { clearInterval(this.keepAlive); this.keepAlive = null; }
    }
};

/* ------------------------------------------------------------------ toast */

let toastTimer = null;
function toast(message) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visible'), 2600);
}

/* --------------------------------------------------------------- confetti */

function launchConfetti(canvas) {
    const ctx = canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    const colors = ['#e11d48', '#ffffff', '#f59e0b', '#10b981', '#fda4af'];
    const pieces = Array.from({ length: 110 }, () => ({
        x: Math.random() * canvas.width,
        y: -20 - Math.random() * canvas.height * 0.5,
        w: 6 + Math.random() * 6,
        h: 8 + Math.random() * 8,
        vy: 1.6 + Math.random() * 2.6,
        vx: -1 + Math.random() * 2,
        rot: Math.random() * Math.PI,
        vr: -0.12 + Math.random() * 0.24,
        color: colors[Math.floor(Math.random() * colors.length)]
    }));

    const startedAt = performance.now();
    (function frame(now) {
        const elapsed = now - startedAt;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        pieces.forEach(p => {
            p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.vy += 0.02;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.globalAlpha = Math.max(0, 1 - elapsed / 4200);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            ctx.restore();
        });
        if (elapsed < 4200) requestAnimationFrame(frame);
        else ctx.clearRect(0, 0, canvas.width, canvas.height);
    })(startedAt);
}

/* --------------------------------------------------------------- DOM refs */

const screens = {};
const UI = {};

function cacheDom() {
    screens.start = document.getElementById('start-screen');
    screens.quiz = document.getElementById('quiz-screen');
    screens.result = document.getElementById('result-screen');
    screens.reader = document.getElementById('reader-screen');

    const ids = {
        catContainer: 'categories-container', catAll: 'cat-all', catNone: 'cat-none',
        startBtn: 'start-btn', dailyBtn: 'daily-btn', dailyCount: 'daily-count',
        readerBtn: 'reader-btn', dbCount: 'db-count',
        numQuestions: 'num-questions', modeSelect: 'test-mode', modeHint: 'mode-hint',
        sprintToggle: 'sprint-toggle', sprintWrap: 'sprint-wrap',
        ttsToggle: 'tts-toggle',

        ringProgress: 'ring-progress', dashPercent: 'dash-percent', dashDue: 'dash-due',
        dashNew: 'dash-new', dashLearning: 'dash-learning', dashStreak: 'dash-streak',
        catProgressList: 'cat-progress-list',

        quitBtn: 'quit-btn', qCounter: 'question-counter', catBadge: 'category-badge',
        progFill: 'progress-fill', sprintBar: 'sprint-bar', sprintFill: 'sprint-fill',
        sprintTime: 'sprint-time',
        panel: 'question-panel', qText: 'question-text', speakBtn: 'speak-btn',

        typingArea: 'typing-area', userAnswerInput: 'user-answer', checkBtn: 'check-btn',
        flashcardArea: 'flashcard-area', showAnswerBtn: 'show-answer-btn',
        quizArea: 'quiz-area', quizOptions: 'quiz-options',
        tfArea: 'tf-area', tfClaim: 'tf-claim',
        swipeArea: 'swipe-area', swipeCard: 'swipe-card', swipeFace: 'swipe-face',

        feedbackArea: 'feedback-area', feedbackTitle: 'feedback-title',
        answerDiff: 'answer-diff', correctAnswerText: 'correct-answer-text',
        overrideBtn: 'override-btn', selfGradeControls: 'self-grade-controls',
        nextBtn: 'next-btn',

        resultHeading: 'result-heading', scoreCircle: 'score-circle',
        scorePerc: 'score-percentage', scoreText: 'score-text', resultStats: 'result-stats',
        mistakesContainer: 'mistakes-container', mistakesList: 'mistakes-list',
        restartBtn: 'restart-btn', retryMistakesBtn: 'retry-mistakes-btn',
        confetti: 'confetti',

        readerBack: 'reader-back', readerSearch: 'reader-search',
        readerCategory: 'reader-category', readerStatus: 'reader-status',
        readerReveal: 'reader-reveal', readerCount: 'reader-count', readerList: 'reader-list'
    };
    Object.keys(ids).forEach(key => { UI[key] = document.getElementById(ids[key]); });
    UI.gradeBtns = Array.from(document.querySelectorAll('.grade-btn'));
    UI.tfBtns = Array.from(document.querySelectorAll('.tf-btn'));
}

function switchScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

/* -------------------------------------------------------------- dashboard */

function renderDashboard() {
    // The dashboard panel is intentionally absent from the start screen. Spaced
    // repetition still runs underneath: `priority()` orders every training set
    // by what is overdue. This stays a no-op unless the panel is put back.
    if (!UI.ringProgress) return;

    const total = DB.length;
    const counts = { new: 0, learning: 0, hard: 0, mastered: 0 };
    DB.forEach(q => { counts[cardStatus(q)]++; });

    const endOfToday = startOfDay(Date.now()) + DAY_MS - 1;
    const dueCount = DB.filter(q => isDue(q, endOfToday)).length;
    const dailyQueue = buildDailyQueue();

    const percent = total ? Math.round((counts.mastered / total) * 100) : 0;
    UI.dashPercent.textContent = percent + '%';

    const radius = 52;
    const circumference = 2 * Math.PI * radius;
    UI.ringProgress.style.strokeDasharray = circumference.toFixed(1);
    UI.ringProgress.style.strokeDashoffset = (circumference * (1 - percent / 100)).toFixed(1);

    UI.dashDue.textContent = dueCount;
    UI.dashNew.textContent = counts.new;
    UI.dashLearning.textContent = counts.learning + counts.hard;
    UI.dashStreak.textContent = (state.meta && state.meta.streak) || 0;

    UI.dailyCount.textContent = dailyQueue.length;
    UI.dailyBtn.disabled = dailyQueue.length === 0;
    UI.dailyBtn.classList.toggle('is-disabled', dailyQueue.length === 0);

    // Per-category bars
    const byCategory = {};
    DB.forEach(q => {
        const bucket = byCategory[q.category] || (byCategory[q.category] = { total: 0, mastered: 0, seen: 0 });
        bucket.total++;
        const status = cardStatus(q);
        if (status === 'mastered') bucket.mastered++;
        if (status !== 'new') bucket.seen++;
    });

    UI.catProgressList.innerHTML = Object.keys(byCategory).map(name => {
        const bucket = byCategory[name];
        const pct = Math.round((bucket.mastered / bucket.total) * 100);
        const seenPct = Math.round((bucket.seen / bucket.total) * 100);
        return `
            <div class="cat-progress-row">
                <div class="cat-progress-head">
                    <span>${escapeHtml(name)}</span>
                    <span class="muted">${bucket.mastered}/${bucket.total}</span>
                </div>
                <div class="cat-progress-track">
                    <div class="cat-progress-seen" style="width:${seenPct}%"></div>
                    <div class="cat-progress-mastered" style="width:${pct}%"></div>
                </div>
            </div>`;
    }).join('');
}

/* ------------------------------------------------------------ session */

const MODE_HINTS = {
    flashcard: 'Odpowiadasz na głos, potem sam oceniasz - najbliżej prawdziwego egzaminu.',
    typing: 'Sprawdzanie po słowach kluczowych. Daty muszą się zgadzać co do roku.',
    quiz: '4 warianty, błędne losowane z pytań tego samego typu.',
    truefalse: 'Błyskawiczna decyzja - świetne do utrwalania dat i nazwisk.',
    swipe: 'Jedna ręka: dotknij, aby odwrócić, przeciągnij w bok, aby ocenić.'
};

const SPRINT_MODES = new Set(['quiz', 'truefalse', 'swipe', 'flashcard']);

let session = null;

function createSession(questions, mode, options) {
    const settings = options || {};
    return {
        queue: questions.slice(),
        index: 0,
        mode,
        sprint: Boolean(settings.sprint) && SPRINT_MODES.has(mode),
        planned: questions.length,
        resolved: 0,
        correctFirst: 0,
        answeredCount: 0,
        correctCount: 0,
        mistakes: [],
        failedIds: new Set(),
        repeats: {},
        locked: false,
        current: null,
        currentPayload: null,
        sprintEndsAt: 0,
        sprintTimer: null,
        finished: false
    };
}

function startSession(questions, mode, options) {
    if (!questions.length) {
        toast('Brak pytań do nauki w tym zestawie.');
        return;
    }
    Speech.stop();
    session = createSession(questions, mode, options);
    switchScreen('quiz');

    if (session.sprint) startSprint();
    else UI.sprintBar.classList.add('hidden');

    loadQuestion();
}

function startSprint() {
    UI.sprintBar.classList.remove('hidden');
    session.sprintEndsAt = Date.now() + CONFIG.sprintSeconds * 1000;
    clearInterval(session.sprintTimer);
    session.sprintTimer = setInterval(tickSprint, 100);
    tickSprint();
}

function tickSprint() {
    if (!session || !session.sprint) return;
    const remaining = Math.max(0, session.sprintEndsAt - Date.now());
    const seconds = remaining / 1000;
    UI.sprintTime.textContent = seconds.toFixed(1);
    UI.sprintFill.style.width = (remaining / (CONFIG.sprintSeconds * 1000) * 100) + '%';
    UI.sprintBar.classList.toggle('critical', seconds <= 10);
    if (remaining <= 0) {
        clearInterval(session.sprintTimer);
        session.sprintTimer = null;
        finishSession('time');
    }
}

function penaliseSprint() {
    if (!session || !session.sprint) return;
    session.sprintEndsAt -= CONFIG.sprintPenalty * 1000;
    UI.sprintBar.classList.add('penalty');
    setTimeout(() => UI.sprintBar.classList.remove('penalty'), 400);
}

function currentQuestion() {
    return session.queue[session.index];
}

function loadQuestion() {
    if (!session || session.finished) return;
    if (session.index >= session.queue.length) return finishSession('done');

    const question = currentQuestion();
    session.current = question;
    session.locked = false;

    const pendingRepeats = session.queue.length - session.index - 1;
    const position = Math.min(session.resolved + 1, session.planned);
    UI.qCounter.textContent = `Pytanie ${position} z ${session.planned}`
        + (pendingRepeats > session.planned - position ? ` · +${pendingRepeats - (session.planned - position)} powtórek` : '');
    UI.catBadge.textContent = question.category;

    const ratio = session.planned ? session.resolved / session.planned : 0;
    UI.progFill.style.width = (ratio * 100) + '%';
    updateProgressColor();

    UI.qText.textContent = question.question;

    // Reset every area, then show the one this mode needs.
    [UI.typingArea, UI.flashcardArea, UI.quizArea, UI.tfArea, UI.swipeArea, UI.feedbackArea]
        .forEach(el => el.classList.add('hidden'));
    UI.nextBtn.classList.add('hidden');
    UI.selfGradeControls.classList.add('hidden');
    UI.overrideBtn.classList.add('hidden');
    UI.answerDiff.classList.add('hidden');
    UI.answerDiff.innerHTML = '';
    UI.feedbackTitle.className = '';
    UI.panel.classList.remove('shake');

    if (UI.ttsToggle.checked) Speech.speak(question.question);

    session.activeMode = effectiveMode(question);

    switch (session.activeMode) {
        case 'typing': renderTyping(question); break;
        case 'quiz': renderQuiz(question); break;
        case 'truefalse': renderTrueFalse(question); break;
        case 'swipe': renderSwipe(question); break;
        default: renderFlashcard(question);
    }
}

/**
 * "Pochodzenie i Rodzina" answers are templates about the user's own life, so
 * there is nothing to auto-grade or to build wrong options from. Those always
 * fall back to say-it-then-rate-yourself, which is how the real interview goes.
 */
function effectiveMode(question) {
    if (question.type !== 'personal') return session.mode;
    return session.mode === 'swipe' ? 'swipe' : 'flashcard';
}

function updateProgressColor() {
    const answered = session.answeredCount;
    const accuracy = answered ? session.correctCount / answered : 1;
    // Red at 0% correct, green at 100%.
    const hue = Math.round(accuracy * 130);
    UI.progFill.style.background = `hsl(${hue}, 72%, 48%)`;
}

/* ------------------------------------------------------- mode: flashcard */

function renderFlashcard() {
    UI.flashcardArea.classList.remove('hidden');
    UI.showAnswerBtn.classList.remove('hidden');
}

function revealFlashcard() {
    if (!session || session.locked) return;
    const question = currentQuestion();
    session.locked = true;
    UI.flashcardArea.classList.add('hidden');
    UI.feedbackTitle.textContent = question.type === 'personal'
        ? 'Wzór odpowiedzi - dopasuj do siebie:'
        : 'Poprawna odpowiedź:';
    UI.correctAnswerText.textContent = question.answer;
    UI.feedbackArea.classList.remove('hidden');
    UI.selfGradeControls.classList.remove('hidden');
    if (UI.ttsToggle.checked) Speech.speak(question.answer);
}

/* ---------------------------------------------------------- mode: typing */

function renderTyping() {
    UI.typingArea.classList.remove('hidden');
    UI.userAnswerInput.value = '';
    if (!isTouchDevice()) UI.userAnswerInput.focus();
}

function submitTyping() {
    if (!session || session.locked) return;
    const question = currentQuestion();
    const raw = UI.userAnswerInput.value;
    if (!normalize(raw)) {
        toast('Wpisz odpowiedź albo naciśnij "Nie wiem".');
        return;
    }
    session.locked = true;

    const verdict = checkTyping(raw, question);
    UI.typingArea.classList.add('hidden');
    UI.feedbackArea.classList.remove('hidden');
    UI.correctAnswerText.textContent = question.answer;
    UI.nextBtn.classList.remove('hidden');

    renderAnswerDiff(verdict, raw);

    if (verdict.pass) {
        UI.feedbackTitle.textContent = 'Dobrze! Sens się zgadza ✅';
        UI.feedbackTitle.className = 'feedback-success';
        settleAnswer(question, true, 5);
    } else {
        UI.feedbackTitle.textContent = `Nie do końca - ${verdict.reason} ❌`;
        UI.feedbackTitle.className = 'feedback-error';
        UI.overrideBtn.classList.remove('hidden');
        shakePanel();
        settleAnswer(question, false, 0);
    }
    UI.nextBtn.focus();
}

/** Shows precisely which required parts were found, and which were missed. */
function renderAnswerDiff(verdict, raw) {
    const chips = []
        .concat(verdict.numbers.map(n => ({ ...n, kind: 'number' })))
        .concat(verdict.keywords.map(k => ({ ...k, kind: 'word' })));

    if (!chips.length) { UI.answerDiff.classList.add('hidden'); return; }

    const matchedTargets = new Set(
        verdict.keywords.filter(k => k.ok).map(k => normalize(k.value))
            .concat(verdict.numbers.filter(n => n.ok).map(n => n.value))
    );
    const userHtml = normalize(raw).split(' ').filter(Boolean).map(word => {
        const hit = Array.from(matchedTargets).some(target => fuzzyEquals(word, target) || word === target);
        return hit ? `<mark>${escapeHtml(word)}</mark>` : escapeHtml(word);
    }).join(' ');

    UI.answerDiff.innerHTML = `
        <div class="diff-user">${userHtml}</div>
        <div class="diff-chips">
            ${chips.map(chip => `
                <span class="chip ${chip.ok ? 'chip-ok' : 'chip-miss'} ${chip.kind === 'number' ? 'chip-number' : ''}">
                    ${chip.ok ? '✓' : '✕'} ${escapeHtml(chip.value)}
                </span>`).join('')}
        </div>
        <p class="diff-legend">Zielone = zaliczone. ${verdict.numbers.length ? 'Liczby i daty muszą się zgadzać dokładnie.' : ''}</p>`;
    UI.answerDiff.classList.remove('hidden');
}

/* ------------------------------------------------------------ mode: quiz */

function renderQuiz(question) {
    UI.quizArea.classList.remove('hidden');
    const correct = optionText(question);
    const options = shuffle([correct].concat(pickDistractors(question, 3)));

    UI.quizOptions.innerHTML = options.map((text, i) => `
        <button class="quiz-option" data-correct="${text === correct}">
            <span class="quiz-key">${i + 1}</span>
            <span class="quiz-text">${escapeHtml(text)}</span>
        </button>`).join('');

    Array.from(UI.quizOptions.children).forEach(button => {
        button.addEventListener('click', () => answerQuiz(button));
    });
}

function answerQuiz(button) {
    if (!session || session.locked) return;
    session.locked = true;
    const question = currentQuestion();
    const isCorrect = button.dataset.correct === 'true';

    Array.from(UI.quizOptions.children).forEach(option => {
        option.disabled = true;
        if (option.dataset.correct === 'true') option.classList.add('is-correct');
        else if (option === button) option.classList.add('is-wrong');
    });

    showVerdict(question, isCorrect);
}

/* ------------------------------------------------------ mode: true/false */

function renderTrueFalse(question) {
    UI.tfArea.classList.remove('hidden');
    const showTruth = Math.random() < 0.5;
    let claim = optionText(question);
    if (!showTruth) {
        const alternatives = pickDistractors(question, 1);
        if (alternatives.length) claim = alternatives[0];
    }
    session.currentPayload = { truth: claim === optionText(question) };
    UI.tfClaim.textContent = claim;
    UI.tfBtns.forEach(btn => { btn.disabled = false; btn.classList.remove('is-correct', 'is-wrong'); });
}

function answerTrueFalse(said) {
    if (!session || session.locked) return;
    session.locked = true;
    const question = currentQuestion();
    const isCorrect = said === session.currentPayload.truth;
    UI.tfBtns.forEach(btn => {
        btn.disabled = true;
        const value = btn.dataset.tf === 'true';
        if (value === session.currentPayload.truth) btn.classList.add('is-correct');
        else if (value === said) btn.classList.add('is-wrong');
    });
    showVerdict(question, isCorrect);
}

/* ----------------------------------------------------------- mode: swipe */

let swipeDrag = null;

function renderSwipe(question) {
    UI.swipeArea.classList.remove('hidden');
    UI.swipeCard.classList.remove('flipped', 'gone-left', 'gone-right');
    UI.swipeCard.style.transform = '';
    UI.swipeCard.dataset.face = 'question';
    UI.swipeFace.textContent = 'Dotknij, aby zobaczyć odpowiedź';
    UI.swipeCard.classList.remove('revealed');
    void question;
}

function flipSwipe() {
    if (!session || session.activeMode !== 'swipe' || session.locked) return;
    const question = currentQuestion();
    if (UI.swipeCard.dataset.face === 'question') {
        UI.swipeCard.dataset.face = 'answer';
        UI.swipeCard.classList.add('revealed');
        UI.swipeFace.textContent = question.answer;
        if (UI.ttsToggle.checked) Speech.speak(question.answer);
    } else {
        UI.swipeCard.dataset.face = 'question';
        UI.swipeCard.classList.remove('revealed');
        UI.swipeFace.textContent = 'Dotknij, aby zobaczyć odpowiedź';
    }
}

function commitSwipe(knew) {
    if (!session || session.locked) return;
    session.locked = true;
    UI.swipeCard.classList.add(knew ? 'gone-right' : 'gone-left');
    const question = currentQuestion();
    settleAnswer(question, knew, knew ? 5 : 0);
    if (!knew) shakePanel();
    setTimeout(() => { advance(); }, 260);
}

function bindSwipeGestures() {
    const card = UI.swipeCard;
    if (!card) return;

    card.addEventListener('pointerdown', event => {
        if (session && session.locked) return;
        swipeDrag = { startX: event.clientX, startY: event.clientY, moved: false };
        card.setPointerCapture(event.pointerId);
    });

    card.addEventListener('pointermove', event => {
        if (!swipeDrag) return;
        const dx = event.clientX - swipeDrag.startX;
        const dy = event.clientY - swipeDrag.startY;
        if (Math.abs(dx) > 6 || Math.abs(dy) > 6) swipeDrag.moved = true;
        card.style.transform = `translateX(${dx}px) rotate(${dx / 22}deg)`;
        card.classList.toggle('tilt-right', dx > 45);
        card.classList.toggle('tilt-left', dx < -45);
    });

    const release = event => {
        if (!swipeDrag) return;
        const dx = event.clientX - swipeDrag.startX;
        const drag = swipeDrag;
        swipeDrag = null;
        card.classList.remove('tilt-right', 'tilt-left');

        if (Math.abs(dx) > 90) {
            commitSwipe(dx > 0);
        } else {
            card.style.transform = '';
            if (!drag.moved) flipSwipe();
        }
    };
    card.addEventListener('pointerup', release);
    card.addEventListener('pointercancel', () => {
        swipeDrag = null;
        card.style.transform = '';
        card.classList.remove('tilt-right', 'tilt-left');
    });
}

/* --------------------------------------------------- shared answer flow */

/** Feedback panel used by the auto-graded modes (quiz, true/false). */
function showVerdict(question, isCorrect) {
    UI.feedbackArea.classList.remove('hidden');
    UI.correctAnswerText.textContent = question.answer;
    UI.nextBtn.classList.remove('hidden');
    if (isCorrect) {
        UI.feedbackTitle.textContent = 'Dobrze ✅';
        UI.feedbackTitle.className = 'feedback-success';
    } else {
        UI.feedbackTitle.textContent = 'Błąd ❌';
        UI.feedbackTitle.className = 'feedback-error';
        shakePanel();
    }
    settleAnswer(question, isCorrect, isCorrect ? 5 : 0);
    UI.nextBtn.focus();
}

/**
 * Single place where a question's outcome is committed: session score, SM-2
 * scheduling, and the bounded requeue that replaced the old infinite loop.
 */
function settleAnswer(question, isCorrect, quality) {
    session.answeredCount++;
    if (isCorrect) session.correctCount++;
    else penaliseSprint();

    recordReview(question.id, quality);

    const firstAttempt = !session.failedIds.has(question.id);

    if (isCorrect) {
        if (firstAttempt) session.correctFirst++;
        session.resolved++;
    } else {
        if (firstAttempt) {
            session.failedIds.add(question.id);
            session.mistakes.push(question);
        }
        const seen = (session.repeats[question.id] || 0);
        if (seen < CONFIG.maxRepeatsPerQuestion) {
            session.repeats[question.id] = seen + 1;
            session.queue.push(question);       // bounded: at most N extra passes
        } else {
            session.resolved++;                 // give up on it for this session
        }
    }
    updateProgressColor();
}

/** Flashcard self-grading. "Prawie" now actually awards half credit. */
function handleGrade(grade) {
    if (!session || !session.locked) return;
    const question = currentQuestion();
    UI.selfGradeControls.classList.add('hidden');

    if (grade === 'correct') settleAnswer(question, true, 5);
    else if (grade === 'partial') settlePartial(question);
    else settleAnswer(question, false, 0);

    advance();
}

/** Half credit: counts toward the score but still comes back this session. */
function settlePartial(question) {
    session.answeredCount++;
    session.correctCount += 0.5;
    recordReview(question.id, 3);

    const firstAttempt = !session.failedIds.has(question.id);
    if (firstAttempt) {
        session.correctFirst += 0.5;
        session.failedIds.add(question.id);
        session.mistakes.push(question);
    }
    const seen = session.repeats[question.id] || 0;
    if (seen < CONFIG.maxRepeatsPerQuestion) {
        session.repeats[question.id] = seen + 1;
        session.queue.push(question);
    } else {
        session.resolved++;
    }
    updateProgressColor();
}

/** "Jednak wiedziałem" - repairs a false negative from the typing checker. */
function overrideAsCorrect() {
    if (!session) return;
    const question = currentQuestion();

    // Undo the failure we just recorded, then re-record it as a success.
    session.correctCount++;
    if (session.failedIds.has(question.id)) {
        session.failedIds.delete(question.id);
        session.mistakes = session.mistakes.filter(m => m.id !== question.id);
        session.correctFirst++;
    }
    if (session.repeats[question.id]) {
        session.repeats[question.id]--;
        const last = session.queue.lastIndexOf(question);
        if (last > session.index) session.queue.splice(last, 1);
    }
    session.resolved++;

    const card = state.cards[question.id];
    if (card) {                                  // roll back the lapse
        card.wrong = Math.max(0, card.wrong - 1);
        card.lapses = Math.max(0, card.lapses - 1);
    }
    recordReview(question.id, 4);

    UI.overrideBtn.classList.add('hidden');
    UI.feedbackTitle.textContent = 'Zaliczone ✅';
    UI.feedbackTitle.className = 'feedback-success';
    updateProgressColor();
    toast('Zaliczone. Postęp poprawiony.');
}

function advance() {
    if (!session || session.finished) return;
    session.index++;
    if (session.index >= session.queue.length) finishSession('done');
    else loadQuestion();
}

/* ------------------------------------------------------------- finishing */

function finishSession(reason) {
    if (!session || session.finished) return;
    session.finished = true;
    clearInterval(session.sprintTimer);
    session.sprintTimer = null;
    Speech.stop();
    UI.sprintBar.classList.add('hidden');

    if (session.answeredCount > 0) registerStudyDay();

    if (reason === 'quit' && session.answeredCount === 0) {
        session = null;
        renderDashboard();
        switchScreen('start');
        return;
    }

    renderResults(reason);
    renderDashboard();
}

function renderResults(reason) {
    switchScreen('result');

    const attempted = reason === 'done' ? session.planned : session.resolved + (session.answeredCount ? 1 : 0);
    const denominator = Math.max(1, Math.min(session.planned, Math.max(attempted, 1)));
    const percent = Math.round((session.correctFirst / denominator) * 100);

    UI.scorePerc.textContent = percent + '%';
    UI.resultHeading.textContent = reason === 'time' ? 'Czas minął! ⏱️'
        : reason === 'quit' ? 'Trening przerwany' : 'Koniec treningu!';

    UI.scoreCircle.style.borderColor = percent >= 80 ? 'var(--success)'
        : percent >= 50 ? 'var(--partial)' : 'var(--error)';

    UI.scoreText.textContent = `Za pierwszym razem: ${formatScore(session.correctFirst)} z ${denominator}.`;

    const accuracy = session.answeredCount
        ? Math.round((session.correctCount / session.answeredCount) * 100) : 0;
    UI.resultStats.innerHTML = `
        <div class="result-stat"><strong>${session.answeredCount}</strong><span>odpowiedzi</span></div>
        <div class="result-stat"><strong>${accuracy}%</strong><span>skuteczność</span></div>
        <div class="result-stat"><strong>${session.mistakes.length}</strong><span>do powtórki</span></div>`;

    if (session.mistakes.length) {
        UI.mistakesContainer.classList.remove('hidden');
        UI.retryMistakesBtn.classList.remove('hidden');
        UI.mistakesList.innerHTML = session.mistakes.map(m => `
            <li>
                <strong>${escapeHtml(m.question)}</strong>
                <span class="muted">${escapeHtml(m.answer)}</span>
            </li>`).join('');
    } else {
        UI.mistakesContainer.classList.add('hidden');
        UI.retryMistakesBtn.classList.add('hidden');
    }

    if (percent === 100 && session.answeredCount > 0) {
        launchConfetti(UI.confetti);
        toast('Komplet! 🎉');
    }
}

function formatScore(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function retryMistakes() {
    const again = session ? session.mistakes.slice() : [];
    if (!again.length) return;
    startSession(shuffle(again), session.mode, { sprint: false });
}

/* --------------------------------------------------------------- reader */

const readerState = { search: '', category: 'all', status: 'all', reveal: false };

function openReader() {
    switchScreen('reader');
    if (UI.readerCategory.options.length <= 1) {
        const categories = Array.from(new Set(DB.map(q => q.category)));
        categories.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            UI.readerCategory.appendChild(option);
        });
    }
    renderReader();
}

function renderReader() {
    const needle = normalize(readerState.search);
    const items = DB.filter(question => {
        if (readerState.category !== 'all' && question.category !== readerState.category) return false;
        if (readerState.status !== 'all' && cardStatus(question) !== readerState.status) return false;
        if (!needle) return true;
        return normalize(question.question + ' ' + question.answer).includes(needle);
    });

    UI.readerCount.textContent = `${items.length} ${plural(items.length, 'pytanie', 'pytania', 'pytań')}`;

    if (!items.length) {
        UI.readerList.innerHTML = '<p class="reader-empty">Nic nie znaleziono.</p>';
        return;
    }

    const statusLabels = { new: 'nietknięte', learning: 'w nauce', hard: 'trudne', mastered: 'opanowane' };

    UI.readerList.innerHTML = items.map(question => {
        const status = cardStatus(question);
        const card = getCard(question.id);
        const meta = card && card.seen
            ? `${card.correct}/${card.seen} trafień · następna powtórka ${formatDue(card.due)}`
            : 'jeszcze nie ćwiczone';
        return `
            <details class="reader-item" ${readerState.reveal ? 'open' : ''}>
                <summary>
                    <span class="reader-q">${escapeHtml(question.question)}</span>
                    <span class="status-dot status-${status}" title="${statusLabels[status]}"></span>
                </summary>
                <div class="reader-body">
                    <p class="reader-a">${escapeHtml(question.answer)}</p>
                    <p class="reader-meta-line">
                        <span class="badge small">${escapeHtml(question.category)}</span>
                        <span class="muted">${escapeHtml(meta)}</span>
                    </p>
                </div>
            </details>`;
    }).join('');
}

function formatDue(due) {
    if (!due) return 'dziś';
    const days = Math.round((startOfDay(due) - startOfDay(Date.now())) / DAY_MS);
    if (days <= 0) return 'dziś';
    if (days === 1) return 'jutro';
    return `za ${days} ${plural(days, 'dzień', 'dni', 'dni')}`;
}

function plural(count, one, few, many) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (count === 1) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
}

/* ----------------------------------------------------------------- setup */

function isTouchDevice() {
    return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

function selectedCategories() {
    return Array.from(UI.catContainer.querySelectorAll('input:checked')).map(input => input.value);
}

function buildCategoryCheckboxes() {
    const counts = {};
    DB.forEach(q => { counts[q.category] = (counts[q.category] || 0) + 1; });

    UI.catContainer.innerHTML = Object.keys(counts).map(name => `
        <label class="checkbox-label">
            <input type="checkbox" value="${escapeHtml(name)}" checked>
            <span>${escapeHtml(name)}</span>
            <span class="cat-count">${counts[name]}</span>
        </label>`).join('');
}

function handleStart() {
    const categories = selectedCategories();
    if (!categories.length) {
        toast('Wybierz przynajmniej jedną kategorię.');
        return;
    }

    let pool = DB.filter(q => categories.includes(q.category));

    // Overdue and shaky cards first, new cards next, well-known cards last.
    const now = Date.now();
    pool = shuffle(pool).sort((a, b) => priority(a, now) - priority(b, now));

    const limit = UI.numQuestions.value;
    if (limit !== 'all') pool = pool.slice(0, parseInt(limit, 10));

    startSession(shuffle(pool), UI.modeSelect.value, { sprint: UI.sprintToggle.checked });
}

/** Lower is more urgent. */
function priority(question, now) {
    const card = getCard(question.id);
    if (!card || card.seen === 0) return 100;               // new: after the overdue ones
    const overdueDays = (now - card.due) / DAY_MS;
    if (overdueDays >= 0) return -overdueDays - (3 - card.ef) * 10;
    return 200 + card.interval;                              // not due yet
}

function handleModeChange() {
    const mode = UI.modeSelect.value;
    UI.modeHint.textContent = MODE_HINTS[mode] || '';
    const sprintable = SPRINT_MODES.has(mode);
    UI.sprintToggle.disabled = !sprintable;
    UI.sprintWrap.classList.toggle('is-disabled', !sprintable);
    if (!sprintable) UI.sprintToggle.checked = false;
}

function handleKeydown(event) {
    if (screens.quiz.classList.contains('active')) return quizKeys(event);
    if (screens.reader.classList.contains('active') && event.key === 'Escape') {
        renderDashboard();
        switchScreen('start');
    }
}

function quizKeys(event) {
    const typingInInput = event.target === UI.userAnswerInput;

    if (event.key === 'Escape') { event.preventDefault(); return finishSession('quit'); }

    if (typingInInput) {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            submitTyping();
        }
        return;
    }

    const mode = session ? (session.activeMode || session.mode) : null;

    if (event.key === 'Enter' && !UI.nextBtn.classList.contains('hidden')) {
        event.preventDefault();
        return advance();
    }

    if (mode === 'flashcard' || mode === 'swipe') {
        if (event.code === 'Space') {
            event.preventDefault();
            if (mode === 'swipe') return flipSwipe();
            if (!UI.showAnswerBtn.classList.contains('hidden')) return revealFlashcard();
        }
    }

    if (mode === 'flashcard' && !UI.selfGradeControls.classList.contains('hidden')) {
        if (event.key === '1') return handleGrade('wrong');
        if (event.key === '2') return handleGrade('partial');
        if (event.key === '3') return handleGrade('correct');
    }

    if (mode === 'swipe' && UI.swipeCard.dataset.face === 'answer' && !session.locked) {
        if (event.key === 'ArrowLeft') return commitSwipe(false);
        if (event.key === 'ArrowRight') return commitSwipe(true);
    }

    if (mode === 'truefalse' && !session.locked) {
        if (event.key === 'ArrowLeft') return answerTrueFalse(false);
        if (event.key === 'ArrowRight') return answerTrueFalse(true);
    }

    if (mode === 'quiz' && !session.locked && /^[1-4]$/.test(event.key)) {
        const option = UI.quizOptions.children[parseInt(event.key, 10) - 1];
        if (option) return answerQuiz(option);
    }
}

function shakePanel() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    UI.panel.classList.remove('shake');
    void UI.panel.offsetWidth;      // restart the animation
    UI.panel.classList.add('shake');
}

function bindEvents() {
    UI.startBtn.addEventListener('click', handleStart);
    if (UI.dailyBtn) {
        UI.dailyBtn.addEventListener('click', () => {
            const queue = buildDailyQueue();
            if (!queue.length) return toast('Na dziś nic nie zaplanowano. Zrób własny trening!');
            startSession(queue, UI.modeSelect.value, { sprint: UI.sprintToggle.checked });
        });
    }

    UI.catAll.addEventListener('click', () => {
        UI.catContainer.querySelectorAll('input').forEach(i => { i.checked = true; });
    });
    UI.catNone.addEventListener('click', () => {
        UI.catContainer.querySelectorAll('input').forEach(i => { i.checked = false; });
    });

    UI.modeSelect.addEventListener('change', handleModeChange);
    UI.showAnswerBtn.addEventListener('click', revealFlashcard);
    UI.checkBtn.addEventListener('click', submitTyping);
    UI.nextBtn.addEventListener('click', advance);
    UI.quitBtn.addEventListener('click', () => finishSession('quit'));
    UI.overrideBtn.addEventListener('click', overrideAsCorrect);
    UI.speakBtn.addEventListener('click', () => {
        const question = session && session.current;
        if (question) Speech.speak(UI.feedbackArea.classList.contains('hidden') ? question.question : question.answer);
    });

    UI.gradeBtns.forEach(button => {
        button.addEventListener('click', event => handleGrade(event.currentTarget.dataset.grade));
    });
    UI.tfBtns.forEach(button => {
        button.addEventListener('click', event => answerTrueFalse(event.currentTarget.dataset.tf === 'true'));
    });

    UI.restartBtn.addEventListener('click', () => {
        session = null;
        renderDashboard();
        switchScreen('start');
    });
    UI.retryMistakesBtn.addEventListener('click', retryMistakes);

    UI.readerBtn.addEventListener('click', openReader);
    UI.readerBack.addEventListener('click', () => { renderDashboard(); switchScreen('start'); });
    UI.readerSearch.addEventListener('input', event => {
        readerState.search = event.target.value;
        renderReader();
    });
    UI.readerCategory.addEventListener('change', event => {
        readerState.category = event.target.value; renderReader();
    });
    UI.readerStatus.addEventListener('change', event => {
        readerState.status = event.target.value; renderReader();
    });
    UI.readerReveal.addEventListener('change', event => {
        readerState.reveal = event.target.checked; renderReader();
    });

    // Checking the toggle is itself a user gesture - the ideal moment to unlock
    // iOS speech and let the user hear straight away whether it works.
    UI.ttsToggle.addEventListener('change', () => {
        if (!UI.ttsToggle.checked) return Speech.stop();
        Speech.unlock();
        Speech.speak('Lektor włączony.');
        if (!Speech.synth) toast('Ta przeglądarka nie obsługuje czytania na głos.');
    });

    document.addEventListener('keydown', handleKeydown);
    bindSwipeGestures();

    // Persist the user's settings between visits.
    ['numQuestions', 'modeSelect'].forEach(key => {
        UI[key].addEventListener('change', savePreferences);
    });
    ['sprintToggle', 'ttsToggle'].forEach(key => {
        UI[key].addEventListener('change', savePreferences);
    });
}

function savePreferences() {
    state.meta = state.meta || {};
    state.meta.prefs = {
        count: UI.numQuestions.value,
        mode: UI.modeSelect.value,
        sprint: UI.sprintToggle.checked,
        tts: UI.ttsToggle.checked
    };
    saveState();
}

function restorePreferences() {
    const prefs = (state.meta && state.meta.prefs) || null;
    if (!prefs) return;
    if (prefs.count) UI.numQuestions.value = prefs.count;
    if (prefs.mode) UI.modeSelect.value = prefs.mode;
    UI.sprintToggle.checked = Boolean(prefs.sprint);
    UI.ttsToggle.checked = Boolean(prefs.tts);
}

function init() {
    cacheDom();

    if (!DB.length) {
        document.body.innerHTML =
            '<div style="padding:2rem;font-family:sans-serif;color:#fff">' +
            '<h1>Nie udało się wczytać bazy pytań</h1>' +
            '<p>Sprawdź, czy plik <code>questions.js</code> leży obok <code>index.html</code>.</p></div>';
        return;
    }

    UI.dbCount.textContent = DB.length;
    buildCategoryCheckboxes();
    restorePreferences();
    handleModeChange();
    bindEvents();
    Speech.init();
    renderDashboard();

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
        navigator.serviceWorker.register('sw.js').catch(() => { /* offline is a bonus, not a requirement */ });
    }
}

document.addEventListener('DOMContentLoaded', init);
