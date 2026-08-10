# -*- coding: utf-8 -*-
import os
import json
import re

def clean_word(word):
    # Remove punctuation
    word = re.sub(r'[^\w\s]', '', word).lower()
    return word

def extract_keywords(answer):
    stop_words = {'w', 'z', 'i', 'oraz', 'a', 'o', 'na', 'do', 'po', 'od', 'za', 'że', 'to', 'jest', 'są', 'był', 'była', 'było', 'przez', 'dla', 'jak', 'tak', 'nie', 'co', 'kto', 'który', 'która', 'które', 'jego', 'jej', 'ich', 'się', 'ze', 'roku', 'lat', 'tym', 'tego', 'r'}
    
    words = answer.split()
    keywords = set()
    for w in words:
        clean = clean_word(w)
        if clean and clean not in stop_words and not clean.isdigit() or len(clean) >= 4 or clean.isdigit():
            # keep long words or numbers or important short words
            if clean not in stop_words:
                keywords.add(clean)
    
    # special cases for exact dates like 1939, 966
    dates = re.findall(r'\b\d{3,4}\b', answer)
    for d in dates:
        keywords.add(d)
        
    return list(keywords)

def main():
    source_dir = r"D:\Projects\PolPoll\sources"
    output_file = r"D:\Projects\PolPoll\questions.js"
    
    categories = {
        "pytania_01_historia_polska.txt": "Historia Polski",
        "pytania_02_geografia.txt": "Geografia",
        "pytania_03_znani_polacy.txt": "Znani Polacy",
        "pytania_04_kultura_swieta_tradycje.txt": "Kultura i Tradycje",
        "pytania_05_wiedza_ogolna_i_administracja.txt": "Administracja i Prawo",
        "pytania_06_historia_i_kultura_cd.txt": "Historia i Kultura",
        "pytania_07_dodatkowe_spoleczenstwo.txt": "Społeczeństwo",
        "pytania_08_ekstra_zestaw.txt": "Ekstra (Ważne Mieszane)"
    }

    all_questions = []
    
    for filename, category in categories.items():
        filepath = os.path.join(source_dir, filename)
        if not os.path.exists(filepath):
            continue
            
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
            
        # Parse text file
        blocks = content.split('\n\n')
        for block in blocks:
            if not block.strip(): continue
            
            lines = block.strip().split('\n')
            if len(lines) >= 2:
                # e.g. "1. Kiedy i kto przyjął chrzest Polski?"
                question_match = re.match(r'^\d+\.\s*(.*)', lines[0])
                if not question_match:
                    question = lines[0]
                else:
                    question = question_match.group(1)
                
                # Odpowiedź: W 966 r. książę Mieszko I.
                answer = lines[1].replace('Odpowiedź: ', '').strip()
                
                # Combine remaining lines if any to answer
                if len(lines) > 2:
                    answer += " " + " ".join(lines[2:])
                
                keywords = extract_keywords(answer)
                
                all_questions.append({
                    "category": category,
                    "question": question,
                    "answer": answer,
                    "keywords": keywords
                })
                
    # Write to questions.js
    js_content = f"const questionsDatabase = {json.dumps(all_questions, ensure_ascii=False, indent=4)};\n"
    
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(js_content)
        
    print(f"Successfully generated {len(all_questions)} questions in {output_file}")

if __name__ == '__main__':
    main()
