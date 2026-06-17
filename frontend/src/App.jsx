import { useState, useRef, useEffect } from "react";
import axios from "axios";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from "recharts";
import "./App.css";

const API = "http://localhost:8000";

const ALPHABETS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const NUMBERS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20"];
const WORD_MAP = {
  A: "Apple", B: "Ball", C: "Cat", D: "Dog", E: "Elephant", F: "Fish", G: "Gate", H: "Hat",
  I: "Ice cream", J: "Jar", K: "Kite", L: "Leaf", M: "Moon", N: "Nest", O: "Orange",
  P: "Penguin", Q: "Queen", R: "Rainbow", S: "Sun", T: "Tree", U: "Umbrella", V: "Van",
  W: "Water", X: "Xylophone", Y: "Yarn", Z: "Zebra"
};
const CARD_COLORS = [
  "#FF6B6B", "#FF8E53", "#FFC947", "#6BCB77", "#4D96FF",
  "#C77DFF", "#FF6FC8", "#00C9A7", "#F7B731", "#45B7D1"
];

export default function App() {
  const [tab, setTab] = useState("home");
  const [revType, setRevType] = useState("alphabets");
  const [revIdx, setRevIdx] = useState(0);
  const [revFlip, setRevFlip] = useState(false);
  const [revPlaying, setRevPlaying] = useState(false);
  const [revCompletedToday, setRevCompletedToday] = useState(() => {
    return localStorage.getItem("dyslexia_rev_completed") === new Date().toLocaleDateString();
  });
  const [isPlaying, setIsPlaying] = useState(false);

  // Settings & New Features
  const [readTheme, setReadTheme] = useState("theme-default");
  const [readFont, setReadFont] = useState("font-hyperlegible");
  const [readSize, setReadSize] = useState(19);
  const [playbackRate, setPlaybackRate] = useState(1.0);

  // Dictionary
  const [dictWord, setDictWord] = useState(null);
  const [dictData, setDictData] = useState(null);
  const [dictLoading, setDictLoading] = useState(false);

  // Quiz
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizData, setQuizData] = useState(null);
  const [quizAnswers, setQuizAnswers] = useState({});
  const [quizScore, setQuizScore] = useState(null);

  const [inputText, setInputText] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [studentName, setStudentName] = useState(() => localStorage.getItem("dyslexia_student_name") || "");
  const [dashboardStats, setDashboardStats] = useState(null);
  const [dashboardSessions, setDashboardSessions] = useState([]);
  const [currentSpeakingIndex, setCurrentSpeakingIndex] = useState(-1);
  const fileRef = useRef(null);
  const autoTimer = useRef(null);
  const revData = revType === "alphabets" ? ALPHABETS : NUMBERS;

  useEffect(() => {
    if (tab !== "revision" || !revPlaying) { clearInterval(autoTimer.current); return; }
    clearInterval(autoTimer.current);
    autoTimer.current = setInterval(() => {
      setRevFlip(true);
      setTimeout(() => {
        setRevIdx(i => {
          const nextIdx = (i + 1) % revData.length;
          if (nextIdx === 0 && i > 0) {
            const today = new Date().toLocaleDateString();
            localStorage.setItem("dyslexia_rev_completed", today);
            setRevCompletedToday(true);
            setRevPlaying(false);
          }
          return nextIdx;
        });
        setRevFlip(false);
      }, 1200);
    }, 2800);
    return () => clearInterval(autoTimer.current);
  }, [tab, revType, revData.length, revPlaying]);

  useEffect(() => {
    if (tab !== "revision" || !revPlaying) {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      return;
    }
    const item = revData[revIdx];
    const word = revType === "alphabets" ? `${item}. ${WORD_MAP[item] || item}` : `Number ${item}`;
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(word);
      utt.rate = 0.75; utt.pitch = 1.1; utt.volume = 1;
      window.speechSynthesis.speak(utt);
    }
  }, [revIdx, tab, revType, revPlaying]);

  useEffect(() => {
    localStorage.setItem("dyslexia_student_name", studentName);
  }, [studentName]);

  useEffect(() => {
    if (tab !== "dashboard") return;
    if (!studentName.trim()) {
      setDashboardStats(null);
      setDashboardSessions([]);
      return;
    }
    const fetchData = async () => {
      setLoading(true);
      try {
        const pRes = await axios.get(`${API}/get-progress?student_name=${encodeURIComponent(studentName)}`);
        const sRes = await axios.get(`${API}/get-stats?student_name=${encodeURIComponent(studentName)}`);
        if (pRes.data && pRes.data.success) {
          setDashboardSessions([...pRes.data.sessions].reverse());
        } else {
          setDashboardSessions([]);
        }
        if (sRes.data && sRes.data.success) {
          setDashboardStats(sRes.data);
        } else {
          setDashboardStats(null);
        }
      } catch (err) {
        console.error(err);
      }
      setLoading(false);
    };
    fetchData();
  }, [tab, studentName]);

  const saveSessionRecord = async (text, difficultWords, readability) => {
    if (!studentName.trim()) return;
    try {
      await axios.post(`${API}/save-session`, {
        student_name: studentName,
        text_submitted: text.slice(0, 1000),
        total_words: text.split(/\s+/).length,
        difficult_words_count: difficultWords.length,
        difficult_words_list: JSON.stringify(difficultWords),
        readability_grade: readability.flesch_kincaid_grade || 0,
        reading_level: readability.reading_level || "Unknown",
        audio_played: 1
      });
    } catch (err) {
      console.error("Failed to save session", err);
    }
  };

  // Global Audio Cleanup
  useEffect(() => {
    return () => {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  const playBrowserAudio = (textToPlay, rate = playbackRate) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();

    const utt = new SpeechSynthesisUtterance(textToPlay);
    utt.rate = rate;

    utt.onstart = () => { setIsPlaying(true); setCurrentSpeakingIndex(0); };
    utt.onboundary = (e) => { if (e.name === 'word') setCurrentSpeakingIndex(e.charIndex); };
    utt.onend = () => { setIsPlaying(false); setCurrentSpeakingIndex(-1); };
    utt.onerror = () => { setIsPlaying(false); setCurrentSpeakingIndex(-1); };

    window.speechSynthesis.speak(utt);
  };

  const togglePlay = () => {
    if (isPlaying) {
      window.speechSynthesis.pause();
      setIsPlaying(false);
    } else {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
        setIsPlaying(true);
      } else if (result?.text) {
        playBrowserAudio(result.text);
      }
    }
  };

  const fetchDictionary = async (word) => {
    const cleanWord = word.replace(/[^a-zA-Z]/g, '').toLowerCase();
    if (!cleanWord) return;
    setDictWord(cleanWord);
    setDictLoading(true); setDictData(null);
    try {
      const res = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${cleanWord}`);
      if (res.data && res.data.length > 0) setDictData(res.data[0]);
      else setDictData({ error: "Definition not found." });
    } catch { setDictData({ error: "Could not load definition." }); }
    setDictLoading(false);
  };

  const generateQuiz = async (text) => {
    setQuizLoading(true); setQuizData(null); setQuizAnswers({}); setQuizScore(null);
    try {
      const res = await axios.post(`${API}/generate-quiz`, { text });
      setQuizData(res.data.questions);
    } catch { alert("Failed to generate quiz."); }
    setQuizLoading(false);
  };

  const analyzeText = async () => {
    if (!inputText.trim()) return;
    setLoading(true); setResult(null); setCurrentSpeakingIndex(-1);
    try {
      const res = await axios.post(`${API}/analyze`, { text: inputText });
      setResult({ text: inputText, difficult_words: res.data.difficult_words, readability: res.data.readability });
      playBrowserAudio(inputText);
      saveSessionRecord(inputText, res.data.difficult_words, res.data.readability);
      setQuizData(null);
    } catch { alert("Backend not running!\n\nRun this in terminal:\ncd backend\nuvicorn main:app --reload"); }
    setLoading(false);
  };

  const uploadPDF = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true); setResult(null); setCurrentSpeakingIndex(-1);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await axios.post(`${API}/upload`, form);
      setResult(res.data);
      setInputText(res.data.text);
      playBrowserAudio(res.data.text);
      saveSessionRecord(res.data.text, res.data.difficult_words, res.data.readability);
      setQuizData(null);
    } catch { alert("Backend not running!\n\nRun this in terminal:\ncd backend\nuvicorn main:app --reload"); }
    setLoading(false);
  };

  const clearSession = () => {
    setInputText("");
    setResult(null);
    setCurrentSpeakingIndex(-1);
    setQuizData(null);
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      setIsPlaying(false);
    }
  };

  const renderHighlightedText = (text, difficultWords, activeIndex) => {
    if (!text) return null;
    const diffSet = new Set((difficultWords || []).map(w => w.toLowerCase()));

    const regex = /(\b\w+\b)|(\s+)|([^a-zA-Z0-9\s]+)/g;
    const elements = [];
    let match;
    let safetyCounter = 0;

    while ((match = regex.exec(text)) !== null) {
      if (safetyCounter++ > 100000) break;
      const part = match[0];
      const startIdx = match.index;
      const endIdx = startIdx + part.length;

      const isWord = /\b\w+\b/.test(part);
      const isDifficult = isWord && diffSet.has(part.toLowerCase());
      const isSpeaking = activeIndex >= startIdx && activeIndex < endIdx;

      let className = "";
      if (isSpeaking) className += " speaking-hl";
      if (isDifficult) className += " hl hl-btn";

      if (isDifficult) {
        elements.push(
          <button key={startIdx} className={className.trim()} onClick={() => fetchDictionary(part)} title="Click for definition">
            {part}
          </button>
        );
      } else if (isSpeaking) {
        elements.push(<span key={startIdx} className={className.trim()}>{part}</span>);
      } else {
        elements.push(<span key={startIdx}>{part}</span>);
      }
    }
    return elements;
  };

  const cardColor = CARD_COLORS[revIdx % CARD_COLORS.length];
  const item = revData[revIdx];
  const pct = ((revIdx + 1) / revData.length) * 100;
  const circumference = 2 * Math.PI * 52;

  return (
    <div className="app">
      <div className="bg-shapes">
        <div className="shape s1" /><div className="shape s2" />
        <div className="shape s3" /><div className="shape s4" /><div className="shape s5" />
      </div>

      <header className="hdr">
        <div className="logo">
          <div className="logo-orb">R</div>
          <div>
            <div className="logo-name">ReadEasy</div>
            <div className="logo-tag">AI Reading Assistant</div>
          </div>
        </div>
        <nav className="nav">
          {[
            { id: "home", label: "Home", path: "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z M9 22V12h6v10" },
            { id: "revision", label: "Revision", path: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2 M9 5a2 2 0 002 2h2a2 2 0 002-2 M9 12h6 M9 16h4" },
            { id: "read", label: "Read & Listen", path: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6 M16 13H8 M16 17H8" },
            { id: "dashboard", label: "Dashboard", path: "M3 3v18h18 M18 9l-5 5-3-3-5 5" },
          ].map(t => (
            <button key={t.id} className={`nav-btn ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                {t.path.split(" M").map((d, i) => <path key={i} d={i === 0 ? d : "M" + d} />)}
              </svg>
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
      </header>

      <main className="main">

        {tab === "home" && (
          <div className="home">
            <div className="hero">
              <div className="hero-badge">✦ Powered by AI &amp; NLP</div>
              <h1 className="hero-title">Learning made <span className="grad-text">joyful</span> for every reader</h1>
              <p className="hero-sub">Upload PDFs, highlight tricky words, and listen to text read aloud — designed for dyslexic students.</p>

              <div className="home-name-section">
                {!studentName.trim() ? (
                  <div className="name-input-wrap">
                    <input
                      type="text"
                      value={studentName}
                      onChange={e => setStudentName(e.target.value)}
                      placeholder="Enter your name to track progress..."
                      className="name-input home-name-input"
                    />
                  </div>
                ) : (
                  <div className="welcome-back-badge">
                    <span>👋 Welcome back, <strong>{studentName}</strong>!</span>
                    <button className="btn-clear-name" title="Change Name" onClick={() => setStudentName("")}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                    </button>
                  </div>
                )}
              </div>

              <div className="hero-btns">
                <button className="btn-glow" onClick={() => setTab("revision")}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z" /></svg>
                  Start Revision
                </button>
                <button className="btn-outline" onClick={() => setTab("read")}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                  Upload PDF
                </button>
              </div>
            </div>

            <div className="feat-grid">
              {[
                { emoji: "🔤", color: "#FF6B6B", bg: "#fff0f0", title: "Smart Revision", desc: "Flashcards auto-play with voice for A–Z and 1–20", tab: "revision" },
                { emoji: "📄", color: "#4D96FF", bg: "#f0f5ff", title: "PDF Reader", desc: "Upload any PDF and extract text in seconds", tab: "read" },
                { emoji: "🔊", color: "#6BCB77", bg: "#f0fff4", title: "Auto Speech", desc: "Text is spoken aloud — slow, clear, automatic", tab: "read" },
                { emoji: "✨", color: "#C77DFF", bg: "#faf0ff", title: "Word Highlight", desc: "Tricky words are highlighted so students can focus", tab: "read" },
              ].map((f, i) => (
                <div key={i} className="feat-card" onClick={() => setTab(f.tab)} style={{ "--fc": f.color, "--fb": f.bg }}>
                  <div className="feat-blob" />
                  <div className="feat-emoji">{f.emoji}</div>
                  <h3 className="feat-title">{f.title}</h3>
                  <p className="feat-desc">{f.desc}</p>
                  <div className="feat-arrow" style={{ color: f.color }}>→</div>
                </div>
              ))}
            </div>

            <div className="stats-row">
              {[["26", "Alphabets"], ["20", "Numbers"], ["Auto", "Audio"], ["100%", "Free"]].map(([n, l], i) => (
                <div key={i} className="stat-pill">
                  <span className="stat-n">{n}</span>
                  <span className="stat-l">{l}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "revision" && (
          <div className="revision">
            <div className="rev-header">
              <h2 className="section-title">Revision Session</h2>
              <button
                className={`btn-rev-play ${revPlaying ? "playing" : ""}`}
                style={{ "--rc": cardColor }}
                onClick={() => setRevPlaying(!revPlaying)}
              >
                {revPlaying ? (
                  <><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg> Pause Audio</>
                ) : (
                  <><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z" /></svg> Start Auto-play</>
                )}
              </button>
            </div>

            <div className="rev-tabs">
              {["alphabets", "numbers"].map(t => (
                <button key={t} className={`rev-tab ${revType === t ? "active" : ""}`}
                  style={revType === t ? { background: cardColor, borderColor: cardColor } : {}}
                  onClick={() => { setRevType(t); setRevIdx(0); setRevFlip(false); }}>
                  {t === "alphabets" ? "🔤 Alphabets" : "🔢 Numbers"}
                </button>
              ))}
            </div>

            <div className="card-stage">
              <svg className="prog-ring" width="130" height="130" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="52" fill="none" stroke="#eee" strokeWidth="7" />
                <circle cx="60" cy="60" r="52" fill="none" stroke={cardColor} strokeWidth="7"
                  strokeDasharray={`${(circumference * pct) / 100} ${circumference}`}
                  strokeLinecap="round" transform="rotate(-90 60 60)"
                  style={{ transition: "stroke-dasharray 0.4s ease" }} />
                <text x="60" y="56" textAnchor="middle" fontSize="20" fontWeight="800" fill={cardColor}>{revIdx + 1}</text>
                <text x="60" y="73" textAnchor="middle" fontSize="11" fill="#aaa">of {revData.length}</text>
              </svg>

              <div className={`flashcard ${revFlip ? "flipped" : ""}`}>
                <div className="card-inner">
                  <div className="card-front" style={{ background: cardColor }}>
                    <div className="cs cs1" /><div className="cs cs2" /><div className="cs cs3" />
                    <div className="card-sound-icon">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" /></svg>
                    </div>
                    <span className="card-letter">{item}</span>
                    <span className="card-tap">auto-flipping...</span>
                  </div>
                  <div className="card-back" style={{ background: cardColor }}>
                    <div className="cs cs1" /><div className="cs cs2" /><div className="cs cs3" />
                    {revType === "alphabets" && <span className="card-letter-sm">{item}</span>}
                    <span className="card-word">{revType === "alphabets" ? WORD_MAP[item] : `Number ${item}`}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="rev-bar-wrap">
              <div className="rev-bar">
                <div className="rev-fill" style={{ width: `${pct}%`, background: cardColor }} />
              </div>
              <p className="rev-count">{revIdx + 1} of {revData.length} — advances every 2.8s</p>
            </div>

            <div className="rev-dots">
              {revData.map((_, i) => (
                <span key={i} className={`dot ${i === revIdx ? "active" : i < revIdx ? "done" : ""}`}
                  style={i === revIdx ? { background: cardColor, transform: "scale(1.5)" } : i < revIdx ? { background: cardColor + "88" } : {}}
                  onClick={() => { clearInterval(autoTimer.current); setRevIdx(i); setRevFlip(false); }} />
              ))}
            </div>
          </div>
        )}

        {tab === "read" && (
          <div className="reader">
            <h2 className="section-title">Read &amp; Listen</h2>

            <div className="input-row">
              <div className="input-card">
                <div className="ic-header">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4D96FF" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                  <span>Type or paste text</span>
                </div>
                <textarea className="textarea" rows={5}
                  placeholder="Type or paste any reading text here..."
                  value={inputText} onChange={e => setInputText(e.target.value)} />
                <div style={{ display: "flex", gap: "10px", marginTop: "15px" }}>
                  <button className="btn-analyze" onClick={analyzeText} disabled={loading || !inputText.trim()} style={{ flex: 1 }}>
                    {loading
                      ? <><span className="spin" /> Analyzing...</>
                      : <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg> Analyze &amp; Read Aloud</>
                    }
                  </button>
                  {inputText.trim() && !loading && (
                    <button className="btn-outline" onClick={clearSession} style={{ padding: "0 20px" }}>
                      Clear
                    </button>
                  )}
                </div>
              </div>

              <div className="or-divider"><span>OR</span></div>

              <div className="upload-zone" onClick={() => fileRef.current.click()}>
                <input ref={fileRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={uploadPDF} />
                <div className="upload-orb">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#FF6B6B" strokeWidth="1.5" strokeLinecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><polyline points="9 15 12 12 15 15" /></svg>
                </div>
                <span className="upload-title">Upload PDF</span>
                <span className="upload-sub">Click to browse your files</span>
              </div>
            </div>

            {loading && (
              <div className="loading-card">
                <div className="load-dots"><span /><span /><span /></div>
                <p>Analyzing text and generating audio...</p>
              </div>
            )}

            {result && !loading && (
              <div className="results">
                <div className="book-container">
                  <div className="book-spine"></div>

                  {/* Settings in Corners */}
                  <div className="book-corner top-left">
                    <select value={readFont} onChange={e => setReadFont(e.target.value)} className="book-sel" title="Change Font">
                      <option value="font-hyperlegible">Hyperlegible</option>
                      <option value="font-opendyslexic">OpenDyslexic</option>
                      <option value="font-arial">Arial</option>
                    </select>
                  </div>

                  <div className="book-corner top-right">
                    <select value={readTheme} onChange={e => setReadTheme(e.target.value)} className="book-sel" title="Change Theme">
                      <option value="theme-default">Default Theme</option>
                      <option value="theme-pastel-yellow">Yellow Theme</option>
                      <option value="theme-light-blue">Blue Theme</option>
                    </select>
                  </div>

                  <div className="book-corner bottom-left">
                    <div className="book-ctrl-group">
                      <span className="bc-lbl">Speed:</span>
                      <div className="bc-btns">
                        {[0.75, 1.0, 1.25, 1.5].map(r => (
                          <button key={r} className={`bc-btn ${playbackRate === r ? "active" : ""}`}
                            onClick={() => {
                              setPlaybackRate(r);
                              if (isPlaying) {
                                window.speechSynthesis.cancel();
                                setTimeout(() => playBrowserAudio(result.text, r), 50);
                              }
                            }}>
                            {r}x
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="book-corner bottom-right">
                    <div className="book-ctrl-group">
                      <span className="bc-lbl">Size:</span>
                      <input type="range" min="16" max="32" value={readSize} onChange={e => setReadSize(Number(e.target.value))} className="bc-slider" />
                    </div>
                  </div>

                  <div className="book-header">
                    <button className="btn-book-play" onClick={togglePlay}>
                      {isPlaying ? (
                        <><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg> Pause Audio</>
                      ) : (
                        <><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z" /></svg> Play Audio</>
                      )}
                    </button>
                    {isPlaying && <div className="wave-anim"><span></span><span></span><span></span><span></span><span></span></div>}

                    <button className="btn-book-replay" onClick={clearSession}>
                      ⟲ Clear & Restart
                    </button>
                  </div>

                  <div className={`book-page ${readTheme} ${readFont}`} style={{ fontSize: `${readSize}px` }}>
                    {renderHighlightedText(result.text, result.difficult_words, currentSpeakingIndex)}
                  </div>

                  <div className="legend-row" style={{ marginTop: "20px", padding: "0 20px" }}>
                    <mark className="hl">highlighted</mark><span> = difficult word (Click for dictionary)</span>
                  </div>
                </div>

                {result.difficult_words?.length > 0 && (
                  <div className="words-card" style={{ marginTop: "20px" }}>
                    <div className="wc-hdr">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="#C77DFF"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                      Difficult words found <strong>({result.difficult_words.length})</strong>
                    </div>
                    <div className="chips">
                      {result.difficult_words.map((w, i) => (
                        <span key={i} className="chip" style={{ "--ci": i % 5 }}>{w}</span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="quiz-section">
                  {!quizData && !quizLoading && (
                    <button className="btn-outline" onClick={() => generateQuiz(result.text)} style={{ width: "100%", justifyContent: "center", padding: "16px" }}>
                      🧠 Take AI Comprehension Quiz
                    </button>
                  )}
                  {quizLoading && (
                    <div className="loading-card" style={{ padding: "20px" }}><div className="spin" /> Generating Quiz...</div>
                  )}
                  {quizData && (
                    <div className="quiz-card">
                      <h3>Reading Comprehension Quiz</h3>
                      {quizScore !== null ? (
                        <div className="quiz-score">
                          <h4>You scored {quizScore} / {quizData.length}!</h4>
                          <button className="btn-outline" onClick={() => { setQuizData(null); setQuizAnswers({}); setQuizScore(null); }}>Try Another</button>
                        </div>
                      ) : (
                        <div className="quiz-list">
                          {quizData.map((q, qIdx) => (
                            <div key={qIdx} className="quiz-q">
                              <p><strong>Q{qIdx + 1}.</strong> {q.question}</p>
                              <div className="quiz-opts">
                                {q.options.map((opt, oIdx) => (
                                  <label key={oIdx} className="quiz-opt">
                                    <input type="radio" name={`q-${qIdx}`} checked={quizAnswers[qIdx] === opt} onChange={() => setQuizAnswers({ ...quizAnswers, [qIdx]: opt })} />
                                    <span>{opt}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          ))}
                          <button
                            className="btn-glow"
                            disabled={Object.keys(quizAnswers).length < quizData.length}
                            onClick={() => {
                              let s = 0;
                              quizData.forEach((q, i) => { if (quizAnswers[i] === q.answer) s++; });
                              setQuizScore(s);
                            }}
                          >
                            Submit Answers
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Dictionary Modal */}
            {dictWord && (
              <div className="dict-overlay" onClick={() => setDictWord(null)}>
                <div className="dict-modal" onClick={e => e.stopPropagation()}>
                  <button className="dict-close" onClick={() => setDictWord(null)}>✕</button>
                  {dictLoading ? (
                    <div className="loading-card" style={{ border: "none", padding: "40px" }}><div className="spin" style={{ borderColor: "var(--accent)" }} /></div>
                  ) : dictData?.error ? (
                    <div className="placeholder-msg">{dictData.error}</div>
                  ) : dictData ? (
                    <div className="dict-content">
                      <h2 className="dict-title">{dictData.word}</h2>
                      <span className="dict-phonetic">{dictData.phonetic || (dictData.phonetics && dictData.phonetics[0]?.text)}</span>

                      <div className="dict-meanings">
                        {dictData.meanings.slice(0, 2).map((m, idx) => (
                          <div key={idx} className="dict-meaning">
                            <span className="dict-pos">{m.partOfSpeech}</span>
                            <ul>
                              {m.definitions.slice(0, 2).map((d, i) => (
                                <li key={i}>{d.definition}</li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "dashboard" && (
          <div className="dashboard-container">
            <h2 className="section-title">Student Dashboard</h2>

            <div className="dash-section profile-card">
              <h3>SECTION A — Student Profile Card</h3>

              {studentName.trim() ? (
                <div className="profile-header">
                  <h4>{studentName}'s Profile</h4>
                </div>
              ) : null}

              {dashboardStats ? (
                <>
                  <div className="profile-stats">
                    <div className="dash-stat-card">
                      <span className="sc-icon" style={{ background: "#e0f7f1", color: "#6BCB77" }}>📊</span>
                      <div className="sc-info">
                        <span className="sc-val">{dashboardStats.total_sessions}</span>
                        <span className="sc-lbl">Total Sessions</span>
                      </div>
                    </div>
                    <div className="dash-stat-card">
                      <span className="sc-icon" style={{ background: "#fff0f0", color: "#FF6B6B" }}>⚠️</span>
                      <div className="sc-info">
                        <span className="sc-val">{dashboardStats.average_difficult_words}</span>
                        <span className="sc-lbl">Avg Difficult Words</span>
                      </div>
                    </div>
                    <div className="dash-stat-card">
                      <span className="sc-icon" style={{ background: "#f0f5ff", color: "#4D96FF" }}>📖</span>
                      <div className="sc-info">
                        <span className="sc-val">{dashboardSessions.length > 0 ? dashboardSessions[dashboardSessions.length - 1].reading_level : "N/A"}</span>
                        <span className="sc-lbl">Current Level</span>
                      </div>
                    </div>
                  </div>

                  <div className="progress-badge">
                    <span className="badge-lbl">Overall Progress:</span>
                    <span className="badge-val">
                      {dashboardStats.total_sessions < 5 ? "Beginner" :
                        dashboardStats.total_sessions <= 10 ? "Learner" :
                          dashboardStats.total_sessions <= 20 ? "Reader" : "Champion"}
                    </span>
                  </div>
                </>
              ) : (
                <p className="placeholder-msg">Enter your name and complete a session to see stats.</p>
              )}
            </div>

            {dashboardSessions.length > 0 && (
              <div className="dash-section readability-profile">
                <h3>Latest Text Readability</h3>
                <div className="readability-visuals">
                  {(() => {
                    const latest = dashboardSessions[0];
                    const level = latest.reading_level || "Unknown";
                    const grade = latest.readability_grade || 0;

                    const getProgress = (lvl) => {
                      if (lvl === "Very Easy") return 100;
                      if (lvl === "Easy") return 75;
                      if (lvl === "Medium") return 50;
                      return 25;
                    };
                    const getProgressColor = (lvl) => {
                      if (lvl === "Very Easy") return "#6BCB77";
                      if (lvl === "Easy") return "#4D96FF";
                      if (lvl === "Medium") return "#FFC947";
                      return "#FF6B6B";
                    };

                    return (
                      <div className="rp-container">
                        <div className="rp-stats-row">
                          <div className="rp-item">
                            <span className="rp-lbl">Reading Level</span>
                            <span className="rp-val" style={{ color: getProgressColor(level) }}>{level}</span>
                          </div>
                          <div className="rp-item">
                            <span className="rp-lbl">US Grade Level</span>
                            <span className="rp-val">{grade.toFixed(1)}</span>
                          </div>
                          <div className="rp-item">
                            <span className="rp-lbl">Difficult Words</span>
                            <span className="rp-val">{latest.difficult_words_count}</span>
                          </div>
                        </div>

                        <div className="rp-bar-container">
                          <div className="bar-label">Current Reading Ease Target</div>
                          <div className="rp-bar-bg">
                            <div className="rp-bar-fill" style={{ width: `${getProgress(level)}%`, background: getProgressColor(level) }} />
                          </div>
                          <div className="rp-bar-lbls">
                            <span>Difficult</span>
                            <span>Medium</span>
                            <span>Easy</span>
                            <span>Very Easy</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            <div className="dash-section">
              <h3>SECTION B — Progress Chart</h3>
              {dashboardSessions.length > 0 ? (
                <div className="chart-wrapper">
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={dashboardSessions.map((s, i) => ({ session: i + 1, difficultWords: s.difficult_words_count, grade: s.readability_grade }))}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                      <XAxis dataKey="session" tickLine={false} axisLine={false} tick={{ fill: '#6e6a85' }} />
                      <YAxis yAxisId="left" tickLine={false} axisLine={false} tick={{ fill: '#6e6a85' }} />
                      <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} tick={{ fill: '#6e6a85' }} />
                      <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }} />
                      <Legend verticalAlign="top" height={36} iconType="circle" />
                      <Line yAxisId="left" type="monotone" dataKey="difficultWords" stroke="#FF6B6B" strokeWidth={3} dot={{ r: 4, fill: '#FF6B6B' }} name="Difficult Word Count" />
                      <Line yAxisId="right" type="monotone" dataKey="grade" stroke="#4D96FF" strokeWidth={3} dot={{ r: 4, fill: '#4D96FF' }} name="Readability Grade" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="placeholder-msg">Complete your first reading session to see progress</p>
              )}
            </div>

            <div className="dash-section">
              <h3>SECTION C — Difficult Words History</h3>
              {dashboardStats && dashboardStats.most_common_words && dashboardStats.most_common_words.length > 0 ? (
                <div className="word-grid">
                  {dashboardStats.most_common_words.slice(0, 10).map((w, i) => {
                    let count = 0;
                    dashboardSessions.forEach(s => {
                      try {
                        const list = JSON.parse(s.difficult_words_list);
                        if (list.includes(w)) count++;
                      } catch (e) { }
                    });
                    const colors = ["#FF6B6B", "#4D96FF", "#C77DFF", "#6BCB77", "#FFC947"];
                    const color = colors[i % colors.length];
                    return (
                      <div key={i} className="word-history-card" style={{ "--wc": color }} title={`this word appeared ${count} times in your sessions`}>
                        <span className="wh-word">{w}</span>
                        <span className="wh-count">{count} {count === 1 ? 'time' : 'times'}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="placeholder-msg">No difficult words found yet.</p>
              )}
            </div>

            <div className="dash-section">
              <h3>SECTION D — Weekly Activity</h3>

              <div className="daily-progress-checkbox">
                <div className={`checkbox-circle ${revCompletedToday ? "checked" : ""}`}>
                  {revCompletedToday ? "✓" : ""}
                </div>
                <div className="checkbox-text">
                  <span className="cp-title">Daily Revision Status</span>
                  <span className="cp-desc">
                    {revCompletedToday
                      ? "Great job! You completed your revision session today."
                      : "Pending: Complete a full revision session today!"}
                  </span>
                </div>
              </div>

              <div className="chart-wrapper">
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={(() => {
                    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
                    const counts = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 };
                    const now = new Date();
                    const startOfWeek = new Date(now);
                    startOfWeek.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1));
                    startOfWeek.setHours(0, 0, 0, 0);

                    dashboardSessions.forEach(s => {
                      const d = new Date(s.date);
                      if (d >= startOfWeek) {
                        const dayStr = d.toLocaleDateString("en-US", { weekday: "short" });
                        if (counts[dayStr] !== undefined) counts[dayStr]++;
                      }
                    });
                    return days.map(d => ({ day: d, sessions: counts[d] }));
                  })()}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                    <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: '#6e6a85' }} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#6e6a85' }} />
                    <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }} />
                    <Bar dataKey="sessions" name="Sessions Completed" radius={[6, 6, 0, 0]}>
                      {
                        (() => {
                          const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
                          const counts = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 };
                          const now = new Date();
                          const startOfWeek = new Date(now);
                          startOfWeek.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1));
                          startOfWeek.setHours(0, 0, 0, 0);
                          dashboardSessions.forEach(s => {
                            const d = new Date(s.date);
                            if (d >= startOfWeek) {
                              const dayStr = d.toLocaleDateString("en-US", { weekday: "short" });
                              if (counts[dayStr] !== undefined) counts[dayStr]++;
                            }
                          });
                          return days.map(d => ({ day: d, sessions: counts[d] })).map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.sessions > 0 ? "#6BCB77" : "#e0e0e0"} />
                          ));
                        })()
                      }
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="dash-section">
              <h3>SECTION E — Achievement Badges</h3>
              <div className="badge-grid">
                {(() => {
                  const totalSessions = dashboardSessions.length;
                  const totalWords = dashboardSessions.reduce((acc, s) => acc + s.difficult_words_count, 0);
                  const improvement = dashboardStats ? dashboardStats.improvement : 0;
                  const badges = [
                    { name: "First Read", locked: totalSessions < 1, icon: "📖", desc: "unlocked after 1 session completed" },
                    { name: "PDF Reader", locked: dashboardSessions.length === 0, icon: "📄", desc: "unlocked after first PDF upload" },
                    { name: "Word Explorer", locked: totalWords < 50, icon: "🔍", desc: "unlocked after 50 total difficult words identified across all sessions" },
                    { name: "5 Sessions", locked: totalSessions < 5, icon: "🔥", desc: "unlocked after 5 sessions completed" },
                    { name: "Improving Reader", locked: improvement >= 0, icon: "📈", desc: "unlocked when improvement score is negative meaning difficult words decreased" },
                    { name: "Champion Reader", locked: totalSessions < 20, icon: "👑", desc: "unlocked after 20 sessions completed" }
                  ];
                  return badges.map((b, i) => (
                    <div key={i} className={`achievement-badge ${b.locked ? "badge-locked" : "badge-unlocked"}`}>
                      <div className="badge-icon-wrap">
                        <span className="badge-emoji">{b.icon}</span>
                        <div className="badge-status-icon">{b.locked ? "🔒" : "✓"}</div>
                      </div>
                      <span className="badge-name">{b.name}</span>
                      <span className="badge-desc">{b.desc}</span>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
