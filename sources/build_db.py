# -*- coding: utf-8 -*-
"""
Builds questions.js from the plain-text source files.

Design notes:
  * every question gets a STABLE id (sha1 of the normalised question text) so the
    user's spaced-repetition progress survives a rebuild;
  * numbers are kept separate from words: on the exam the date IS the answer, so
    the checker treats them as mandatory and compares them exactly;
  * `short` holds a one-sentence form of the answer, used as an option in the
    quiz mode;
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


def normalise_question(text):
    """Key used for the stable id - insensitive to case, punctuation, spacing."""
    text = text.lower().replace("ł", "l")
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text).strip()


def make_id(question):
    return hashlib.sha1(normalise_question(question).encode("utf-8")).hexdigest()[:8]


def extract_numbers(answer):
    """Years and counts. These are the facts the exam actually tests."""
    numbers = []
    for match in re.findall(r"\b\d{1,4}\b", answer):
        if match not in numbers:
            numbers.append(match)
    return numbers[:5]


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
        # Personal answers are worked examples to adapt, not facts to check.
        numbers = [] if kind == "personal" else extract_numbers(answer)

        questions.append({
            "id": make_id(question),
            "category": category,
            "question": question,
            "answer": answer,
            "short": first_sentence(answer),
            "type": kind,
            "numbers": numbers,
        })
    return questions


# --- spoken form of a year -------------------------------------------------
# Knowing the digits is not the same as being able to say them. In Polish only
# the tens and units of a year become ordinals, and after "w" they take the
# locative - "w tysiąc dziewięćset trzydziestym dziewiątym roku". Learners
# routinely decline the whole thing, so every date carries its spoken form.

CARD_HUNDREDS = {1: "sto", 2: "dwieście", 3: "trzysta", 4: "czterysta", 5: "pięćset",
                 6: "sześćset", 7: "siedemset", 8: "osiemset", 9: "dziewięćset"}
ORD_HUNDREDS = {1: "setny", 2: "dwusetny", 3: "trzechsetny", 4: "czterechsetny",
                5: "pięćsetny", 6: "sześćsetny", 7: "siedemsetny", 8: "osiemsetny",
                9: "dziewięćsetny"}
ORD_UNITS = {1: "pierwszy", 2: "drugi", 3: "trzeci", 4: "czwarty", 5: "piąty",
             6: "szósty", 7: "siódmy", 8: "ósmy", 9: "dziewiąty"}
ORD_TEENS = {10: "dziesiąty", 11: "jedenasty", 12: "dwunasty", 13: "trzynasty",
             14: "czternasty", 15: "piętnasty", 16: "szesnasty", 17: "siedemnasty",
             18: "osiemnasty", 19: "dziewiętnasty"}
ORD_TENS = {2: "dwudziesty", 3: "trzydziesty", 4: "czterdziesty", 5: "pięćdziesiąty",
            6: "sześćdziesiąty", 7: "siedemdziesiąty", 8: "osiemdziesiąty",
            9: "dziewięćdziesiąty"}
CARD_THOUSANDS = {1: "tysiąc", 2: "dwa tysiące"}
ORD_THOUSANDS = {1: "tysięczny", 2: "dwutysięczny"}


def to_locative(word):
    """Masculine ordinal in the locative: -y -> -ym, -i -> -im."""
    return word[:-1] + ("im" if word.endswith("i") else "ym")


def year_spoken(year):
    """Returns the phrase you actually say: 'w tysiąc czterysta dziesiątym roku'."""
    thousands, rest = divmod(year, 1000)
    hundreds, rest2 = divmod(rest, 100)
    tens, units = divmod(rest2, 10)

    parts = []          # (word, is_ordinal)
    if thousands:
        parts.append((CARD_THOUSANDS.get(thousands, str(thousands)), False))
    if hundreds:
        parts.append((CARD_HUNDREDS[hundreds], False))

    if rest2:
        if 10 <= rest2 <= 19:
            parts.append((ORD_TEENS[rest2], True))
        else:
            if tens:
                parts.append((ORD_TENS[tens], True))
            if units:
                parts.append((ORD_UNITS[units], True))
    elif hundreds:
        parts[-1] = (ORD_HUNDREDS[hundreds], True)          # 1300 -> trzechsetny
    elif thousands:
        parts[-1] = (ORD_THOUSANDS.get(thousands, ""), True)  # 1000 -> tysięczny

    words = [to_locative(w) if is_ord else w for w, is_ord in parts]
    return "w %s roku" % " ".join(words)


TIMELINE_SOURCE = os.path.join(SOURCE_DIR, "os_czasu.txt")
TIMELINE_OUTPUT = os.path.join(os.path.dirname(SOURCE_DIR), "timeline.js")


def build_timeline():
    """Parses os_czasu.txt into the anchor/event tree used by the study screen."""
    if not os.path.exists(TIMELINE_SOURCE):
        print("  ! missing timeline source: os_czasu.txt")
        return 0

    anchors = []
    current = None

    with open(TIMELINE_SOURCE, "r", encoding="utf-8") as handle:
        for raw in handle:
            line = raw.rstrip("\n")
            stripped = line.strip()
            if not stripped or (stripped.startswith("#") and not stripped.startswith("##")):
                continue

            if stripped.startswith("##"):
                parts = [p.strip() for p in stripped[2:].split("|")]
                current = {
                    "year": int(parts[0]),
                    "say": year_spoken(int(parts[0])),
                    "title": parts[1] if len(parts) > 1 else "",
                    "role": parts[2] if len(parts) > 2 else "",
                    "note": "",
                    "hooks": [],
                    "events": [],
                }
                anchors.append(current)
            elif current is None:
                continue
            elif stripped.startswith("!"):
                current["hooks"].append(stripped[1:].strip())
            elif stripped[0] in "-~":
                # "-" is an event the consul realistically asks about, "~" is
                # background. The app can filter to the core set so a hundred
                # dates do not drown the forty that matter.
                parts = [p.strip() for p in stripped[1:].split("|")]
                current["events"].append({
                    "year": int(parts[0]),
                    "say": year_spoken(int(parts[0])),
                    "title": parts[1] if len(parts) > 1 else "",
                    "note": parts[2] if len(parts) > 2 else "",
                    "core": stripped[0] == "-",
                })
            elif not current["note"]:
                current["note"] = stripped

    for anchor in anchors:
        anchor["events"].sort(key=lambda e: e["year"])

    header = (
        "// Generated by sources/build_db.py from sources/os_czasu.txt - do not edit by hand.\n"
        "// Anchor dates for the study screen; everything else hangs off them.\n"
    )
    with open(TIMELINE_OUTPUT, "w", encoding="utf-8") as handle:
        handle.write("%sconst dateTimeline = %s;\n"
                     % (header, json.dumps(anchors, ensure_ascii=False, indent=2)))

    events = sum(len(a["events"]) for a in anchors)
    core = sum(1 for a in anchors for e in a["events"] if e["core"])
    hooks = sum(len(a["hooks"]) for a in anchors)
    print("Wrote timeline: %d anchors, %d events (%d kluczowych / %d dodatkowych), %d hooks"
          % (len(anchors), events, core, events - core, hooks))
    span = [(a["year"], len(a["events"])) for a in anchors]
    print("  per anchor: %s" % ", ".join("%d:%d" % s for s in span))
    return len(anchors)


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

    print("Wrote %d questions to %s" % (len(questions), OUTPUT_FILE))
    print("  collapsed duplicates: %d" % len(duplicates))
    for text in duplicates:
        print("    - %s" % text)
    print("  avg numbers per question: %.1f"
          % (sum(len(q["numbers"]) for q in questions) / len(questions)))

    types = {}
    for q in questions:
        types[q["type"]] = types.get(q["type"], 0) + 1
    print("  types: %s" % types)

    build_timeline()


if __name__ == "__main__":
    main()
