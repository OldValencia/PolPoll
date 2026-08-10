# -*- coding: utf-8 -*-
"""
Builds questions.js from the plain-text source files.

Design notes:
  * every question gets a STABLE id (sha1 of the normalised question text) so the
    user's spaced-repetition progress survives a rebuild;
  * keywords are few and meaningful. The old version emitted up to 25 tokens per
    answer (including stop words), which made the typing check unpassable;
  * numbers are kept separate from words: on the exam the date IS the answer, so
    the checker treats them as mandatory and compares them exactly;
  * `short` holds a one-sentence form of the answer, used as an option in the
    quiz / true-false modes;
  * duplicates are collapsed by id.
"""
import os
import json
import re
import sys
import hashlib

# The Windows console defaults to cp1252 and cannot print Polish diacritics.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SOURCE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_FILE = os.path.join(os.path.dirname(SOURCE_DIR), "questions.js")

CATEGORIES = {
    "pytania_01_historia_polska.txt": "Historia Polski",
    "pytania_02_geografia.txt": "Geografia",
    "pytania_03_znani_polacy.txt": "Znani Polacy",
    "pytania_04_kultura_swieta_tradycje.txt": "Kultura i Tradycje",
    "pytania_05_wiedza_ogolna_i_administracja.txt": "Administracja i Prawo",
    "pytania_06_historia_i_kultura_cd.txt": "Historia i Kultura",
    "pytania_07_dodatkowe_spoleczenstwo.txt": "Społeczeństwo",
    "pytania_08_ekstra_zestaw.txt": "Ekstra (Ważne Mieszane)",
    "pytania_09_pochodzenie_i_rodzina.txt": "Pochodzenie i Rodzina",
    "pytania_10_swieta_i_tradycje.txt": "Święta i Tradycje",
    "pytania_11_panstwo_i_symbole.txt": "Państwo i Symbole",
    "pytania_12_legendy_kuchnia_ludzie.txt": "Legendy, Kuchnia i Ludzie",
}

# Answers here are personal templates, not facts: they must never be auto-graded
# and must never be offered as a wrong option in the quiz modes.
PERSONAL_CATEGORIES = {"Pochodzenie i Rodzina"}

# Real Polish stop list. The old script leaked these in because of an operator
# precedence bug (`A and B and C or len>=4 or isdigit`).
STOP_WORDS = {
    "a", "aby", "albo", "ale", "ani", "az", "aż", "bardzo", "bez", "bo", "być",
    "byl", "byla", "byli", "bylo", "był", "była", "byli", "było", "były",
    "chociaż", "ci", "co", "coś", "czy", "czyli", "dla", "do", "dwa", "dwie",
    "gdy", "gdyż", "gdzie", "go", "i", "ich", "ile", "im", "inne", "inny",
    "iż", "ja", "jak", "jako", "je", "jednak", "jednym", "jego", "jej", "jest",
    "jeszcze", "już", "kiedy", "kto", "która", "które", "którego", "której",
    "który", "których", "lat", "lata", "latach", "lub", "ma", "mają", "mamy",
    "mi", "miał", "mnie", "moze", "może", "można", "na", "nad", "nam", "nas",
    "nawet", "nic", "nich", "nie", "niego", "niej", "nim", "no", "o", "od",
    "oraz", "on", "ona", "one", "oni", "ono", "po", "pod", "podczas", "ponad",
    "poniewaz", "ponieważ", "poza", "przed", "przez", "przy", "raz", "razem",
    "roku", "rok", "roku", "r", "sa", "są", "się", "so", "swoje", "swój",
    "ta", "tak", "takze", "także", "tam", "te", "tego", "tej", "temu", "ten",
    "teraz", "też", "to", "tu", "tych", "tylko", "tym", "u", "w", "we", "wiele",
    "wielu", "więc", "wszystko", "wtedy", "z", "za", "ze", "zeby", "żeby",
    "znajduje", "jednym", "czym", "kim", "warto", "np", "itd", "m", "in",
}

# Words that look like proper nouns but are really titles - not distinctive.
TITLE_WORDS = {"król", "królowa", "książę", "święty", "święta", "prezydent",
               "papież", "generał", "marszałek", "premier", "biskup", "car"}

ROMAN = re.compile(r"^(?:[IVXLC]{2,})$")


def normalise_question(text):
    """Key used for the stable id - insensitive to case, punctuation, spacing."""
    text = text.lower().replace("ł", "l")
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text).strip()


def make_id(question):
    return hashlib.sha1(normalise_question(question).encode("utf-8")).hexdigest()[:8]


def tokenise(text):
    """Split into words. Hyphens become spaces so 'Bielsko-Biala' yields both
    halves - the old version glued them into one unmatchable token."""
    text = text.replace("-", " ").replace("–", " ").replace("—", " ")
    return re.findall(r"[\w]+", text, flags=re.UNICODE)


def extract_numbers(answer):
    """Years and counts. These are the facts the exam actually tests."""
    numbers = []
    for match in re.findall(r"\b\d{1,4}\b", answer):
        if match not in numbers:
            numbers.append(match)
    return numbers[:5]


def extract_words(answer):
    """Distinctive words, preferring proper nouns."""
    # A word is a candidate proper noun if it is capitalised and does not open a
    # sentence. Split on sentence boundaries so we know which position is first.
    proper, ordinary = [], []
    for sentence in re.split(r"(?<=[.!?])\s+", answer):
        tokens = tokenise(sentence)
        for index, token in enumerate(tokens):
            lowered = token.lower()
            if lowered in STOP_WORDS or lowered in TITLE_WORDS:
                continue
            if token.isdigit():
                continue
            if ROMAN.match(token):
                if lowered not in proper:
                    proper.append(lowered)
                continue
            if len(token) < 4:
                continue
            is_proper = token[0].isupper() and index > 0
            bucket = proper if is_proper else ordinary
            if lowered not in proper and lowered not in ordinary:
                bucket.append(lowered)

    # Proper nouns first, then the longest ordinary words as a fallback.
    ordinary.sort(key=len, reverse=True)
    keywords = proper[:4]
    for word in ordinary:
        if len(keywords) >= 4:
            break
        keywords.append(word)
    return keywords


def first_sentence(answer):
    match = re.match(r"^.*?[.!?](?:\s|$)", answer, flags=re.DOTALL)
    sentence = (match.group(0) if match else answer).strip()
    # A trailing abbreviation ("w 966 r.") is not a sentence end - keep going.
    if re.search(r"\b(r|w|np|itd|tzw|m|in|ok)\.$", sentence) and len(sentence) < len(answer):
        rest = answer[len(sentence):].strip()
        extra = re.match(r"^.*?[.!?](?:\s|$)", rest, flags=re.DOTALL)
        sentence = (sentence + " " + (extra.group(0) if extra else rest)).strip()
    return sentence


def classify(question, answer, numbers, category=None):
    if category in PERSONAL_CATEGORIES:
        return "personal"
    q = question.lower()
    if re.match(r"^\s*(wymień|proszę wymienić|wymien)", q):
        return "list"
    if q.startswith(("kto", "kim")):
        return "person"
    if q.startswith("kiedy") or (numbers and re.match(r"^\W*\d{3,4}", answer)):
        return "date"
    if q.startswith("gdzie") or re.search(r"\b(miasto|stolic|rzek|góra|region|województ)", q):
        return "place"
    return "text"


def parse_file(path, category):
    with open(path, "r", encoding="utf-8") as handle:
        content = handle.read()

    questions = []
    for block in content.split("\n\n"):
        lines = [line for line in block.strip().split("\n") if line.strip()]
        if len(lines) < 2:
            continue

        match = re.match(r"^\d+\.\s*(.*)", lines[0])
        question = (match.group(1) if match else lines[0]).strip()

        answer = re.sub(r"^Odpowied[źz]:\s*", "", lines[1]).strip()
        if len(lines) > 2:
            answer += " " + " ".join(line.strip() for line in lines[2:])
        answer = re.sub(r"\s{2,}", " ", answer).strip()

        if not question or not answer:
            continue

        kind = classify(question, answer, extract_numbers(answer), category)
        # Personal answers are worked examples to adapt, so nothing in them is a
        # required keyword - the app self-grades these instead.
        numbers = [] if kind == "personal" else extract_numbers(answer)
        keywords = [] if kind == "personal" else extract_words(answer)

        questions.append({
            "id": make_id(question),
            "category": category,
            "question": question,
            "answer": answer,
            "short": first_sentence(answer),
            "type": kind,
            "numbers": numbers,
            "keywords": keywords,
        })
    return questions


def main():
    collected = {}
    duplicates = []

    for filename, category in CATEGORIES.items():
        path = os.path.join(SOURCE_DIR, filename)
        if not os.path.exists(path):
            print("  ! missing source: %s" % filename)
            continue
        for question in parse_file(path, category):
            if question["id"] in collected:
                duplicates.append(question["question"])
                # Keep whichever entry has the richer answer.
                if len(question["answer"]) > len(collected[question["id"]]["answer"]):
                    collected[question["id"]] = question
                continue
            collected[question["id"]] = question

    questions = list(collected.values())

    header = (
        "// Generated by sources/build_db.py - do not edit by hand.\n"
        "// `id` is a stable hash of the question text: user progress is keyed on it.\n"
    )
    body = json.dumps(questions, ensure_ascii=False, indent=2)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as handle:
        handle.write("%sconst questionsDatabase = %s;\n" % (header, body))

    empty = [q for q in questions
             if not q["keywords"] and not q["numbers"] and q["type"] != "personal"]
    print("Wrote %d questions to %s" % (len(questions), OUTPUT_FILE))
    print("  collapsed duplicates: %d" % len(duplicates))
    for text in duplicates:
        print("    - %s" % text)
    print("  avg keywords: %.1f" % (sum(len(q["keywords"]) for q in questions) / len(questions)))
    print("  avg numbers:  %.1f" % (sum(len(q["numbers"]) for q in questions) / len(questions)))
    print("  no signal at all: %d" % len(empty))
    for q in empty:
        print("    - %s" % q["question"])
    types = {}
    for q in questions:
        types[q["type"]] = types.get(q["type"], 0) + 1
    print("  types: %s" % types)


if __name__ == "__main__":
    main()
