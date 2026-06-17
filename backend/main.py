from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
import io
import os
import pickle
import numpy as np
import csv
import pdfplumber
import textstat
from gtts import gTTS
import spacy
import sqlite3
from datetime import datetime
import json
from collections import Counter

try:
    from pdf2image import convert_from_bytes
    import pytesseract
    from PIL import Image
    OCR_AVAILABLE = True
except ImportError:
    OCR_AVAILABLE = False

# Initialize FastAPI app and NLP
app = FastAPI()
nlp = spacy.load("en_core_web_sm")

# Initialize SQLite database for progress tracking
def init_database():
    """Create SQLite database and sessions table if they don't exist."""
    conn = sqlite3.connect("progress.db")
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_name TEXT,
            date TEXT,
            time TEXT,
            text_submitted TEXT,
            total_words INTEGER,
            difficult_words_count INTEGER,
            difficult_words_list TEXT,
            readability_grade REAL,
            reading_level TEXT,
            audio_played INTEGER
        )
    """)
    conn.commit()
    conn.close()
    print("Progress database initialized")

init_database()

# Load trained ML model at startup
try:
    with open("difficulty_model.pkl", "rb") as f:
        ml_model = pickle.load(f)
    print("ML model loaded successfully")
except:
    ml_model = None
    print("ML model not found — using fallback heuristics")

# Load MRC word features for ML prediction
WORD_FEATURES = {}
try:
    with open("mrc_database.csv", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            word = row.get("Word", "").strip().lower()
            if not word:
                continue
            try:
                features = [
                    float(row.get("Familiarity", "")),
                    float(row.get("Imageability", "")),
                    float(row.get("Concreteness", "")),
                    float(row.get("Age of Acquisition Rating", "")),
                    float(row.get("Number of Letters", "")),
                    float(row.get("Number of Syllables", ""))
                ]
            except ValueError:
                continue
            if any(np.isnan(x) for x in features):
                continue
            WORD_FEATURES[word] = features
    print(f"Loaded {len(WORD_FEATURES)} MRC word feature entries")
except FileNotFoundError:
    print("MRC dataset file not found, ML predictions will only use fallback heuristic.")
except Exception as e:
    print(f"Error loading MRC dataset: {e}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class TextPayload(BaseModel):
    text: str

class QuizPayload(BaseModel):
    text: str

class SaveSessionPayload(BaseModel):
    student_name: str
    text_submitted: str
    total_words: int
    difficult_words_count: int
    difficult_words_list: str
    readability_grade: float
    reading_level: str
    audio_played: int

def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        text = " ".join(page.extract_text() or "" for page in pdf.pages)
    if text.strip():
        return text

    if not OCR_AVAILABLE:
        raise RuntimeError(
            "No text was extracted from the PDF. Install pdf2image, pytesseract, and pillow "
            "to enable OCR fallback for scanned PDFs."
        )

    images = convert_from_bytes(pdf_bytes, dpi=300)
    ocr_text = " ".join(pytesseract.image_to_string(image) for image in images)
    return ocr_text


def get_readability(text):
    """Calculate readability metrics for the given text."""
    return {
        "flesch_kincaid_grade": textstat.flesch_kincaid_grade(text),
        "gunning_fog": textstat.gunning_fog(text),
        "flesch_reading_ease": textstat.flesch_reading_ease(text),
        "smog_index": textstat.smog_index(text),
        "reading_level": (
            "Very Easy" if textstat.flesch_reading_ease(text) > 80
            else "Easy" if textstat.flesch_reading_ease(text) > 60
            else "Medium" if textstat.flesch_reading_ease(text) > 40
            else "Difficult"
        )
    }


def get_difficult_words_batch(doc):
    """Batch predict difficult words to massively speed up processing."""
    unique_words = list(set(t.text for t in doc if t.is_alpha))
    
    # Filter out common stop words to ensure they are never marked as difficult
    stop_words = nlp.Defaults.stop_words.union({
        "i", "am", "is", "are", "was", "were", "be", "being", "been",
        "have", "has", "had", "do", "does", "did", "went", "go", "goes", "gone",
        "and", "but", "or", "so", "because", "what", "who", "whom", "which",
        "whose", "why", "how", "when", "where", "there", "here"
    })
    
    unique_words = [w for w in unique_words if w.lower() not in stop_words]
    
    if ml_model is None or not WORD_FEATURES:
        return [w for w in unique_words if len(w) > 6]
        
    words_to_predict = []
    features_list = []
    difficult = []
    
    for w in unique_words:
        f = WORD_FEATURES.get(w.lower())
        if f is None:
            if len(w) > 6:
                difficult.append(w)
        else:
            words_to_predict.append(w)
            features_list.append(f)
            
    if words_to_predict:
        try:
            # Batch predict all words at once (100x faster than looping)
            preds = ml_model.predict(np.array(features_list))
            for w, pred in zip(words_to_predict, preds):
                if pred == 1:
                    difficult.append(w)
        except Exception:
            for w in words_to_predict:
                if len(w) > 6:
                    difficult.append(w)
                    
    return difficult

@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    try:
        file_bytes = await file.read()
        text = extract_text_from_pdf(file_bytes).strip()
        if not text:
            return {"text": "", "difficult_words": [], "readability": {}}

        # Disable heavy NER/Parser since we only need tokens for difficulty
        doc = nlp(text, disable=["parser", "ner"])
        difficult = get_difficult_words_batch(doc)
        
        readability = get_readability(text)
        
        return {
            "text": text,
            "difficult_words": difficult[:50],
            "readability": readability
        }
    except Exception as e:
        return {"error": str(e), "text": "", "difficult_words": [], "readability": {}}

@app.post("/analyze")
async def analyze_text(payload: TextPayload):
    text = payload.text.strip()
    if not text:
        return {"difficult_words": [], "readability": {}}
    
    # Disable heavy NER/Parser since we only need tokens for difficulty
    doc = nlp(text, disable=["parser", "ner"])
    difficult = get_difficult_words_batch(doc)
    
    readability = get_readability(text)
    
    return {
        "difficult_words": difficult[:50],
        "readability": readability
    }

import random

@app.post("/generate-quiz")
async def generate_quiz(payload: QuizPayload):
    text = payload.text.strip()
    if not text:
        return {"questions": []}
        
    doc = nlp(text)
    candidates = []
    
    for sent in doc.sents:
        entities = [ent for ent in sent.ents if ent.label_ in ["PERSON", "ORG", "GPE", "LOC", "DATE", "TIME"]]
        words = sent.text.split()
        if entities and 5 < len(words) < 25:
            candidates.append((sent, entities[0]))
        elif not entities:
            nouns = [token for token in sent if token.pos_ == "NOUN" and len(token.text) > 4]
            if nouns and 5 < len(words) < 25:
                candidates.append((sent, nouns[0]))
                
    random.shuffle(candidates)
    selected = candidates[:3]
    questions = []
    
    all_entities = list(set(ent.text for ent in doc.ents if ent.label_ in ["PERSON", "ORG", "GPE", "LOC", "DATE", "TIME"]))
    all_nouns = list(set(token.text for token in doc if token.pos_ == "NOUN" and len(token.text) > 4))
    
    for sent, target in selected:
        answer = target.text
        q_text = sent.text.replace(answer, "_______", 1)
        
        wrong_pool = all_entities if target.text in all_entities else all_nouns
        wrong_pool = [w for w in wrong_pool if w.lower() != answer.lower()]
        random.shuffle(wrong_pool)
        
        options = wrong_pool[:3]
        while len(options) < 3:
            options.append(random.choice(["Apple", "Moon", "School", "Computer", "City", "Teacher"]))
            
        options.append(answer)
        random.shuffle(options)
        
        # Ensure exactly 4 unique options including the answer
        unique_options = list(set(options))
        if answer not in unique_options:
            unique_options.append(answer)
        while len(unique_options) < 4:
            unique_options.append(random.choice(["Star", "Book", "Car", "Tree"]))
            unique_options = list(set(unique_options))
            
        questions.append({
            "question": q_text,
            "options": unique_options,
            "answer": answer
        })
        
    return {"questions": questions}

@app.post("/tts")
async def text_to_speech(payload: TextPayload):
    try:
        tts = gTTS(text=payload.text, lang="en", slow=True)
        path = "output.mp3"
        tts.save(path)
        return FileResponse(path, media_type="audio/mpeg", filename="output.mp3")
    except Exception as e:
        return {"error": str(e)}

@app.post("/save-session")
async def save_session(payload: SaveSessionPayload):
    """Save a study session to the database."""
    try:
        conn = sqlite3.connect("progress.db")
        cursor = conn.cursor()
        
        now = datetime.now()
        date = now.strftime("%Y-%m-%d")
        time = now.strftime("%H:%M:%S")
        
        cursor.execute("""
            INSERT INTO sessions (
                student_name, date, time, text_submitted, total_words,
                difficult_words_count, difficult_words_list, readability_grade,
                reading_level, audio_played
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            payload.student_name,
            date,
            time,
            payload.text_submitted,
            payload.total_words,
            payload.difficult_words_count,
            payload.difficult_words_list,
            payload.readability_grade,
            payload.reading_level,
            payload.audio_played
        ))
        
        conn.commit()
        session_id = cursor.lastrowid
        conn.close()
        
        return {"success": True, "session_id": session_id}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.get("/get-progress")
async def get_progress(student_name: str):
    """Get all sessions for a student ordered by date and time (newest first)."""
    try:
        conn = sqlite3.connect("progress.db")
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT id, student_name, date, time, text_submitted, total_words,
                   difficult_words_count, difficult_words_list, readability_grade,
                   reading_level, audio_played
            FROM sessions
            WHERE student_name = ?
            ORDER BY date DESC, time DESC
        """, (student_name,))
        
        rows = cursor.fetchall()
        conn.close()
        
        sessions = []
        for row in rows:
            sessions.append({
                "id": row[0],
                "student_name": row[1],
                "date": row[2],
                "time": row[3],
                "text_submitted": row[4],
                "total_words": row[5],
                "difficult_words_count": row[6],
                "difficult_words_list": row[7],
                "readability_grade": row[8],
                "reading_level": row[9],
                "audio_played": row[10]
            })
        
        return {"success": True, "sessions": sessions}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.get("/get-stats")
async def get_stats(student_name: str):
    """Get comprehensive statistics for a student."""
    try:
        conn = sqlite3.connect("progress.db")
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT difficult_words_count, difficult_words_list, reading_level
            FROM sessions
            WHERE student_name = ?
            ORDER BY date ASC, time ASC
        """, (student_name,))
        
        rows = cursor.fetchall()
        conn.close()
        
        if not rows:
            return {"success": False, "error": "No sessions found for this student"}
        
        # Calculate total sessions
        total_sessions = len(rows)
        
        # Extract difficult words counts
        difficult_counts = [row[0] for row in rows]
        
        # Calculate average difficult words
        average_difficult_words = sum(difficult_counts) / total_sessions
        
        # Find best and worst sessions
        best_session_idx = difficult_counts.index(min(difficult_counts))
        worst_session_idx = difficult_counts.index(max(difficult_counts))
        
        best_session = {
            "difficult_words_count": difficult_counts[best_session_idx]
        }
        worst_session = {
            "difficult_words_count": difficult_counts[worst_session_idx]
        }
        
        # Calculate improvement (first to latest session)
        improvement = difficult_counts[0] - difficult_counts[-1]
        
        # Calculate most common words across all sessions
        all_words = []
        for row in rows:
            try:
                words = json.loads(row[1]) if isinstance(row[1], str) else []
                if isinstance(words, list):
                    all_words.extend(words)
            except:
                pass
        
        most_common_words = []
        if all_words:
            word_counter = Counter(all_words)
            most_common_words = [word for word, count in word_counter.most_common(10)]
        
        # Extract reading level history
        reading_level_history = [row[2] for row in rows]
        
        return {
            "success": True,
            "total_sessions": total_sessions,
            "average_difficult_words": round(average_difficult_words, 2),
            "best_session": best_session,
            "worst_session": worst_session,
            "improvement": improvement,
            "most_common_words": most_common_words,
            "reading_level_history": reading_level_history
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.get("/")
def root():
    return {"status": "Dyslexia Assistant API is running"}
