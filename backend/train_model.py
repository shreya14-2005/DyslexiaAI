import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, classification_report
import pickle
import os

# Get the directory where this script is located
script_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(script_dir)  # Change working directory to script location
print(f"Working directory: {os.getcwd()}")

# Step 1 — Load MRC Dataset
print("Loading MRC dataset...")
try:
    df = pd.read_csv("mrc_database.csv")
    print(f"Loaded CSV with shape: {df.shape}")
    print(f"Columns: {list(df.columns)}")
except FileNotFoundError:
    print("Error: mrc_database.csv not found!")
    print(f"Looking in: {os.getcwd()}")
    exit(1)

# Step 2 — Map column names and extract features
print("\nPreparing features...")
feature_mapping = {
    "Familiarity": "FAM",
    "Imageability": "IMAG", 
    "Concreteness": "CONC",
    "Age of Acquisition Rating": "AOA",
    "Number of Letters": "NLET",
    "Number of Syllables": "NSYL"
}

required_cols = list(feature_mapping.keys())
df_clean = df[["Word"] + required_cols].copy()
df_clean.columns = ["WORD"] + list(feature_mapping.values())

# Convert to numeric, replace invalid values with NaN
for col in ["FAM", "IMAG", "CONC", "AOA", "NLET", "NSYL"]:
    df_clean[col] = pd.to_numeric(df_clean[col], errors="coerce")

# Remove rows with NaN values
df_clean = df_clean.dropna()
print(f"After cleaning: {len(df_clean)} rows with valid data")

if len(df_clean) == 0:
    print("Error: No valid data rows after cleaning!")
    exit(1)

# Step 3 — Load Dale-Chall word list as labels
print("Loading Dale-Chall word list...")
import spacy
nlp = spacy.load("en_core_web_sm")

try:
    with open("dale_chall_words.txt") as f:
        easy_words = set(w.strip().lower() for w in f.readlines() if w.strip())
        
    # Add spacy stopwords and extra common words to easy_words
    easy_words.update(nlp.Defaults.stop_words)
    extra_easy = ["i", "am", "is", "are", "was", "were", "be", "being", "been", 
                  "have", "has", "had", "do", "does", "did", "went", "go", "goes", "gone",
                  "and", "but", "or", "so", "because", "a", "an", "the", "it", "they", "them",
                  "he", "she", "him", "her", "his", "hers", "its", "we", "us", "our", "ours",
                  "you", "your", "yours", "this", "that", "these", "those", "what", "who", "whom",
                  "which", "whose", "why", "how", "when", "where", "there", "here"]
    easy_words.update(extra_easy)

    print(f"Loaded {len(easy_words)} easy words")
except FileNotFoundError:
    print("Error: dale_chall_words.txt not found!")
    exit(1)

# Step 4 — Create label column
# 0 = easy word (in Dale-Chall list)
# 1 = difficult word (not in Dale-Chall list)
df_clean["label"] = df_clean["WORD"].apply(
    lambda w: 0 if str(w).lower() in easy_words else 1
)

print(f"\nTotal words: {len(df_clean)}")
print(f"Easy words: {len(df_clean[df_clean['label'] == 0])}")
print(f"Difficult words: {len(df_clean[df_clean['label'] == 1])}")

# Step 5 — Prepare features and labels
features = ["FAM", "IMAG", "CONC", "AOA", "NLET", "NSYL"]
X = df_clean[features].values
y = df_clean["label"].values

# Step 6 — Split into training and testing sets
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42
)

print(f"\nTraining set: {len(X_train)}, Test set: {len(X_test)}")

# Step 7 — Train Random Forest Classifier
print("Training model...")
model = RandomForestClassifier(n_estimators=100, random_state=42, n_jobs=-1)
model.fit(X_train, y_train)

# Step 8 — Evaluate the model
y_pred = model.predict(X_test)
accuracy = accuracy_score(y_test, y_pred)
print(f"\nModel Accuracy: {accuracy * 100:.2f}%")
print("\nClassification Report:")
print(classification_report(y_test, y_pred,
      target_names=["Easy Word", "Difficult Word"]))

# Step 9 — Save the trained model
with open("difficulty_model.pkl", "wb") as f:
    pickle.dump(model, f)
print("\nModel saved as difficulty_model.pkl")