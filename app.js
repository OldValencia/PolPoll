// Global State
let currentQuestions = [];
let currentQuestionIndex = 0;
let score = 0;
let mistakes = []; // Original mistakes for final list
let testMode = 'flashcard'; // 'flashcard' or 'typing'
let useTTS = false;
let synthesis = window.speechSynthesis;

// Load mastery stats from localStorage
let userStats = JSON.parse(localStorage.getItem('polpoll_stats')) || {};

// DOM Elements
const screens = {
    start: document.getElementById('start-screen'),
    quiz: document.getElementById('quiz-screen'),
    result: document.getElementById('result-screen')
};

const UI = {
    catContainer: document.getElementById('categories-container'),
    startBtn: document.getElementById('start-btn'),
    numQuestions: document.getElementById('num-questions'),
    modeSelect: document.getElementById('test-mode'),
    ttsToggle: document.getElementById('tts-toggle'),
    
    // Quiz
    qCounter: document.getElementById('question-counter'),
    catBadge: document.getElementById('category-badge'),
    progFill: document.getElementById('progress-fill'),
    qText: document.getElementById('question-text'),
    
    typingArea: document.getElementById('typing-area'),
    userAnswerInput: document.getElementById('user-answer'),
    checkBtn: document.getElementById('check-btn'),
    
    flashcardArea: document.getElementById('flashcard-area'),
    showAnswerBtn: document.getElementById('show-answer-btn'),
    
    feedbackArea: document.getElementById('feedback-area'),
    feedbackTitle: document.getElementById('feedback-title'),
    correctAnswerText: document.getElementById('correct-answer-text'),
    
    selfGradeControls: document.getElementById('self-grade-controls'),
    gradeBtns: document.querySelectorAll('.grade-btn'),
    nextBtn: document.getElementById('next-btn'),
    
    // Results
    scorePerc: document.getElementById('score-percentage'),
    scoreText: document.getElementById('score-text'),
    mistakesContainer: document.getElementById('mistakes-container'),
    mistakesList: document.getElementById('mistakes-list'),
    restartBtn: document.getElementById('restart-btn'),
    retryMistakesBtn: document.getElementById('retry-mistakes-btn')
};

// Initialize
function init() {
    // Extract unique categories
    const categories = [...new Set(questionsDatabase.map(q => q.category))];
    
    // Populate checkboxes
    categories.forEach(cat => {
        const label = document.createElement('label');
        label.className = 'checkbox-label';
        label.innerHTML = `<input type="checkbox" value="${cat}" checked> ${cat}`;
        UI.catContainer.appendChild(label);
    });

    // Event Listeners
    UI.startBtn.addEventListener('click', startTest);
    UI.showAnswerBtn.addEventListener('click', showAnswerFlashcard);
    UI.checkBtn.addEventListener('click', checkAnswerTyping);
    UI.nextBtn.addEventListener('click', nextQuestion);
    UI.restartBtn.addEventListener('click', () => switchScreen('start'));
    UI.retryMistakesBtn.addEventListener('click', startRetryMistakes);
    
    UI.gradeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const grade = e.target.dataset.grade;
            handleGrade(grade);
        });
    });
}

function switchScreen(screenName) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[screenName].classList.add('active');
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// Spaced repetition sort: prioritize questions with lower score
function sortQuestionsByMastery(pool) {
    return pool.sort((a, b) => {
        const scoreA = userStats[a.question] || 0;
        const scoreB = userStats[b.question] || 0;
        return scoreA - scoreB;
    });
}

function updateMastery(questionText, isCorrect) {
    if (!userStats[questionText]) userStats[questionText] = 0;
    if (isCorrect) userStats[questionText]++;
    else userStats[questionText]--;
    localStorage.setItem('polpoll_stats', JSON.stringify(userStats));
}

function startTest() {
    const selectedCats = Array.from(UI.catContainer.querySelectorAll('input:checked')).map(cb => cb.value);
    
    if (selectedCats.length === 0) {
        alert("Wybierz przynajmniej jedną kategorię!");
        return;
    }

    let pool = questionsDatabase.filter(q => selectedCats.includes(q.category));
    
    // Shuffle first, then sort by mastery (so equal mastery questions are randomized)
    pool = shuffleArray(pool);
    pool = sortQuestionsByMastery(pool);

    const num = UI.numQuestions.value;
    if (num !== 'all') {
        pool = pool.slice(0, parseInt(num));
    }
    
    // Shuffle the final selection again so the worst questions don't always appear at the exact beginning predictably
    pool = shuffleArray(pool);

    if (pool.length === 0) return;

    currentQuestions = pool;
    currentQuestionIndex = 0;
    score = 0;
    mistakes = [];
    testMode = UI.modeSelect.value;
    useTTS = UI.ttsToggle.checked;

    switchScreen('quiz');
    loadQuestion();
}

function playTTS(text) {
    if (!useTTS) return;
    synthesis.cancel(); // Stop any ongoing speech
    let utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pl-PL';
    utterance.rate = 1.0;
    synthesis.speak(utterance);
}

function loadQuestion() {
    const q = currentQuestions[currentQuestionIndex];
    
    // Dynamic progress (can increase if we add mistakes to the end)
    UI.qCounter.textContent = `Pytanie ${currentQuestionIndex + 1} z ${currentQuestions.length}`;
    UI.catBadge.textContent = q.category;
    UI.progFill.style.width = `${((currentQuestionIndex) / currentQuestions.length) * 100}%`;
    
    UI.qText.textContent = q.question;
    playTTS(q.question);
    
    // Reset areas
    UI.feedbackArea.classList.add('hidden');
    UI.nextBtn.classList.add('hidden');
    UI.selfGradeControls.classList.add('hidden');
    UI.feedbackTitle.className = '';
    
    if (testMode === 'flashcard') {
        UI.typingArea.classList.add('hidden');
        UI.flashcardArea.classList.remove('hidden');
        UI.showAnswerBtn.classList.remove('hidden');
    } else {
        UI.flashcardArea.classList.add('hidden');
        UI.typingArea.classList.remove('hidden');
        UI.userAnswerInput.value = '';
        UI.userAnswerInput.focus();
    }
}

function showAnswerFlashcard() {
    const q = currentQuestions[currentQuestionIndex];
    UI.showAnswerBtn.classList.add('hidden');
    
    UI.feedbackTitle.textContent = "Poprawna odpowiedź:";
    UI.feedbackTitle.className = '';
    UI.correctAnswerText.textContent = q.answer;
    
    UI.feedbackArea.classList.remove('hidden');
    UI.selfGradeControls.classList.remove('hidden');
}

function handleGrade(grade) {
    const q = currentQuestions[currentQuestionIndex];
    
    if (grade === 'correct') {
        score++;
        updateMastery(q.question, true);
    } else {
        if (!mistakes.includes(q)) mistakes.push(q);
        updateMastery(q.question, false);
        // Add to the end of the array to repeat it!
        currentQuestions.push(q); 
        
        if (grade === 'partial') score += 0.5;
    }
    
    UI.selfGradeControls.classList.add('hidden');
    nextQuestion();
}

// Levenshtein distance for typos
function levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) { matrix[i] = [i]; }
    for (let j = 0; j <= a.length; j++) { matrix[0][j] = j; }
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
            }
        }
    }
    return matrix[b.length][a.length];
}

function isFuzzyMatch(word, target) {
    if (word === target) return true;
    const dist = levenshtein(word, target);
    if (target.length > 5 && dist <= 2) return true;
    if (target.length > 3 && dist <= 1) return true;
    return false;
}

function normalizeString(str) {
    return str.toLowerCase()
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"")
        .replace(/\s{2,}/g," ")
        .trim();
}

function checkAnswerTyping() {
    const userAnswer = normalizeString(UI.userAnswerInput.value);
    const q = currentQuestions[currentQuestionIndex];
    
    if (!userAnswer) return;

    let matchedKeywords = 0;
    const requiredKeywords = q.keywords.map(k => normalizeString(k));
    const userWords = userAnswer.split(" ");
    
    requiredKeywords.forEach(kw => {
        // Check if any word in user answer matches keyword (with typos)
        for (let w of userWords) {
            if (isFuzzyMatch(w, kw) || userAnswer.includes(kw)) {
                matchedKeywords++;
                break;
            }
        }
    });

    const matchRatio = requiredKeywords.length > 0 ? (matchedKeywords / requiredKeywords.length) : 0;
    
    UI.typingArea.classList.add('hidden');
    UI.feedbackArea.classList.remove('hidden');
    UI.correctAnswerText.textContent = q.answer;
    UI.nextBtn.classList.remove('hidden');

    if (matchRatio >= 0.6 || (matchedKeywords > 0 && requiredKeywords.length <= 2)) {
        score++;
        updateMastery(q.question, true);
        UI.feedbackTitle.textContent = "Dobrze! (Zrozumiałem sens) ✅";
        UI.feedbackTitle.className = 'feedback-success';
    } else {
        if (!mistakes.includes(q)) mistakes.push(q);
        updateMastery(q.question, false);
        // Queue it at the end
        currentQuestions.push(q);
        
        UI.feedbackTitle.textContent = "Niestety, brakuje kluczowych informacji ❌";
        UI.feedbackTitle.className = 'feedback-error';
    }
}

function nextQuestion() {
    currentQuestionIndex++;
    if (currentQuestionIndex < currentQuestions.length) {
        loadQuestion();
    } else {
        showResults();
    }
}

function showResults() {
    UI.progFill.style.width = '100%';
    synthesis.cancel(); // Stop TTS
    
    setTimeout(() => {
        switchScreen('result');
        
        // Calculate based on original length to avoid >100% scores due to repeated questions
        const originalLength = currentQuestions.length - mistakes.length; 
        const perc = Math.round((score / originalLength) * 100);
        UI.scorePerc.textContent = `${perc}%`;
        
        if (perc >= 80) UI.scorePerc.parentElement.style.borderColor = 'var(--success)';
        else if (perc >= 50) UI.scorePerc.parentElement.style.borderColor = 'var(--partial)';
        else UI.scorePerc.parentElement.style.borderColor = 'var(--error)';

        UI.scoreText.textContent = `Podsumowanie testu. Powtarzałeś trudne pytania aż do skutku!`;

        if (mistakes.length > 0) {
            UI.mistakesContainer.classList.remove('hidden');
            UI.retryMistakesBtn.classList.remove('hidden');
            UI.mistakesList.innerHTML = '';
            
            mistakes.forEach(m => {
                const li = document.createElement('li');
                li.innerHTML = `<strong>${m.question}</strong><br><span style="color:var(--text-muted)">${m.answer}</span>`;
                UI.mistakesList.appendChild(li);
            });
        } else {
            UI.mistakesContainer.classList.add('hidden');
            UI.retryMistakesBtn.classList.add('hidden');
        }
    }, 300);
}

function startRetryMistakes() {
    currentQuestions = shuffleArray([...mistakes]);
    currentQuestionIndex = 0;
    score = 0;
    mistakes = [];
    switchScreen('quiz');
    loadQuestion();
}

// Start
document.addEventListener('DOMContentLoaded', init);
