# Xealzid // Secure Code Architect Workspace

Xealzid is a production-grade, highly responsive web application designed for architectural brainstorming, code generation, and direct code editing. Built with a high-performance, cyber-minimalist [...]

<img src="xealzid/Screenshot From 2026-05-29 17-10-49.png" alt="Description" width="300"/>

---

## ⚡ Key Features

- **Cyber-Minimal Dashboard**: Built entirely in HTML5, CSS3, and Vanilla JS for fast, frame-rate stable interactions.
- **Auto-Sync Code Workspace**: An interactive split-screen workspace featuring tabbed files, line numbers, download capabilities, clipboard copy, and direct editing.
- **Smart Markdown Extraction**: When the AI suggests code blocks in chat, Xealzid automatically extracts the blocks, parses the filenames, and updates the workspace files in real-time.
- **Context-Aware Suggestion Engine**: Includes an autocomplete suggestion engine (via `Ctrl+Space` or inline triggers like `def `, `const `, `import `) that pulls live suggestions based on file c[...]
- **Robust Local LLM Integration**: Designed to securely connect to a local LLM API (e.g., Ollama or Llama.cpp) with an offline mock generator fallback for zero-setup execution.
- **OWASP Hardened Security**:
  - Strict **Content Security Policy (CSP)** disabling inline scripts and `unsafe-eval`.
  - Secure **CSRF Mitigation** mapping tokens to all mutating REST requests.
  - Safe **XSS Protection** sanitizing user input and AI Markdown via local vendor copies of `DOMPurify`.
  - Traversal Prevention rejecting any file paths attempting directory traversal (`../`).

---

## 📂 Project Architecture

```
xealzid/
├── manage.py                # Command-line utility
├── requirements.txt         # Package dependencies
├── db.sqlite3               # Local SQLite database
├── xealzid/
│   ├── settings.py          # Django project settings
│   ├── urls.py              # Main URL router
│   ├── wsgi.py              # WSGI Entrypoint
│   └── asgi.py              # ASGI Entrypoint
└── core/
    ├── models.py            # ChatSession, Message, & CodeSnippet tables
    ├── views.py             # SPA renderer, REST endpoints, LLM API client
    ├── urls.py              # App-level endpoint mappings
    ├── middleware.py        # Strict security headers injector
    ├── tests.py             # Full unit and integration test suite
    ├── templates/
    │   └── core/
    │       ├── base.html    # Base skeleton, imports scripts securely
    │       └── editor.html  # Main single-page application structure
    └── static/
        ├── css/
        │   └── styles.css   # Cyber-minimal styling and responsive queries
        ├── js/
        │   └── app.js       # App logic (REST APIs, autocomplete, editor sync)
        └── vendor/
            ├── dompurify.min.js # Local offline HTML sanitizer
            ├── prism.js     # Code syntax highlighting (Markup, CSS, JS, Python)
            └── prism.css    # Tomorrow-Night style theme for code blocks
```

---

## 🚀 Quick Start

### 1. Install Dependencies
Ensure you have Python 3 and Django installed:
```bash
pip install -r requirements.txt
```

### 2. Run Database Migrations
Initialize the local SQLite database schema:
```bash
python3 manage.py migrate
```

### 3. Run the Development Server
Start the local server:
```bash
python3 manage.py runserver
```
Visit the application in your browser at `http://127.0.0.1:8000/`.

### 4. Run the Test Suite
Execute the Django unit and integration tests:
```bash
python3 manage.py test
```

---

## 🤖 Local LLM Integration Configuration

By default, Xealzid connects to a local LLM completion endpoint at `http://localhost:11434/v1/chat/completions` using the `codegemma` model (highly recommended for code architecture).

You can customize this configuration in your environment variables or directly inside `xealzid/settings.py`:

```python
# settings.py
LOCAL_LLM_URL = os.environ.get("LOCAL_LLM_URL", "http://localhost:11434/v1/chat/completions")
LOCAL_LLM_MODEL = os.environ.get("LOCAL_LLM_MODEL", "codegemma")
```

If the endpoint is offline or unavailable, the application automatically drops back to its rule-based mock generator so all editing, parsing, saving, and suggestion features can be thoroughly tested.

### Setting Up CodeGemma

To use CodeGemma as your local LLM, follow these steps:

#### Prerequisites
- **Ollama** (recommended): Download from [ollama.ai](https://ollama.ai)
- **Llama.cpp** (alternative): Download from [llama-cpp](https://github.com/ggerganov/llama.cpp)

#### Option 1: Using Ollama (Recommended)

1. **Install Ollama** from [ollama.ai](https://ollama.ai) and follow platform-specific instructions.

2. **Pull the CodeGemma model**:
   ```bash
   ollama pull codegemma
   ```
   This downloads the CodeGemma model (~5GB). You can also specify a variant:
   ```bash
   ollama pull codegemma:7b    # 7B parameter model
   ollama pull codegemma:13b   # 13B parameter model
   ```

3. **Start the Ollama server** (if not already running):
   ```bash
   ollama serve
   ```
   The server will listen on `http://localhost:11434` by default.

4. **Verify the connection**:
   ```bash
   curl http://localhost:11434/api/tags
   ```
   You should see `codegemma` in the list of available models.

5. **Run Xealzid**: Start the development server as described above. The application will automatically connect to CodeGemma.

#### Option 2: Using Llama.cpp

1. **Clone and build llama.cpp**:
   ```bash
   git clone https://github.com/ggerganov/llama.cpp.git
   cd llama.cpp
   make
   ```

2. **Download the CodeGemma GGUF model** from [Hugging Face](https://huggingface.co/models?search=codegemma+gguf).

3. **Start the server**:
   ```bash
   ./server -m ./path/to/codegemma.gguf -ngl 999 --port 11434
   ```

4. **Update Xealzid configuration** (if needed) to match your server setup.

#### Customizing the Model

To use a different model or server endpoint, set environment variables before starting:

```bash
export LOCAL_LLM_URL="http://localhost:11434/v1/chat/completions"
export LOCAL_LLM_MODEL="codegemma"
python3 manage.py runserver
```

Or edit `xealzid/settings.py` directly:
```python
LOCAL_LLM_URL = "http://localhost:11434/v1/chat/completions"
LOCAL_LLM_MODEL = "codegemma"
```

#### Troubleshooting

- **Connection refused**: Ensure Ollama or Llama.cpp is running on port 11434.
- **Model not found**: Verify the model is installed with `ollama list` or check Llama.cpp configuration.
- **Slow responses**: CodeGemma performance depends on your hardware. For faster responses, use the 7B variant.
- **Fallback mode**: If connection fails, Xealzid automatically uses the mock generator. Check the browser console for error messages.

---

# AI-chatbot-Xealzid
