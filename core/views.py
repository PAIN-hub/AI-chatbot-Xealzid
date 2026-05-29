import json
import re
import requests
import logging
from django.shortcuts import render
from django.http import JsonResponse
from django.views.decorators.csrf import ensure_csrf_cookie
from django.conf import settings
from django.utils.html import escape
from .models import ChatSession, Message, CodeSnippet

logger = logging.getLogger(__name__)

# System instructions to guide the LLM to write code in a parsed format
SYSTEM_INSTRUCTION = (
    "You are Xealzid, a cyber-minimalist code writing and architectural assistant.\n"
    "When generating code, you MUST always wrap it in standard markdown code fences.\n"
    "Crucially, on the first line inside the code block, specify the filename using the appropriate comment character for that language. "
    "Use the exact format: 'File: <filename>'. For example:\n"
    "```html\n"
    "<!-- File: index.html -->\n"
    "...\n"
    "```\n"
    "Or:\n"
    "```python\n"
    "# File: script.py\n"
    "...\n"
    "```\n"
    "Ensure all code snippets are complete, secure, and production-ready. Always explain your architectural decisions briefly."
)

@ensure_csrf_cookie
def editor_page(request):
    """Renders the main dashboard page."""
    return render(request, 'core/editor.html')

def api_sessions(request):
    """Handles session list and creation."""
    if request.method == 'GET':
        sessions = ChatSession.objects.all().values('id', 'title', 'created_at', 'updated_at')
        return JsonResponse(list(sessions), safe=False)
        
    elif request.method == 'POST':
        try:
            data = json.loads(request.body) if request.body else {}
        except json.JSONDecodeError:
            data = {}
        title = data.get('title', 'New Chat Session')
        session = ChatSession.objects.create(title=title)
        return JsonResponse({
            'id': str(session.id),
            'title': session.title,
            'created_at': session.created_at.isoformat()
        }, status=210) # 210 custom success or 201 Created
        
    return JsonResponse({'error': 'Method not allowed'}, status=405)

def api_session_detail(request, session_id):
    """Handles details / deletion of a session."""
    try:
        session = ChatSession.objects.get(id=session_id)
    except ChatSession.DoesNotExist:
        return JsonResponse({'error': 'Session not found'}, status=404)

    if request.method == 'DELETE':
        session.delete()
        return JsonResponse({'status': 'deleted'})
        
    return JsonResponse({'error': 'Method not allowed'}, status=405)

def api_messages(request, session_id):
    """Handles message retrieval and user message posting with LLM integration."""
    try:
        session = ChatSession.objects.get(id=session_id)
    except ChatSession.DoesNotExist:
        return JsonResponse({'error': 'Session not found'}, status=404)

    if request.method == 'GET':
        messages = session.messages.all().values('id', 'role', 'content', 'created_at')
        return JsonResponse(list(messages), safe=False)

    elif request.method == 'POST':
        try:
            data = json.loads(request.body)
            content = data.get('content', '').strip()
        except (json.JSONDecodeError, KeyError):
            return JsonResponse({'error': 'Invalid request body'}, status=400)

        if not content:
            return JsonResponse({'error': 'Content cannot be empty'}, status=400)

        # 1. Save user message to database
        user_message = Message.objects.create(session=session, role='user', content=content)

        # 2. Compile full context of conversation
        conversation = [{"role": "system", "content": SYSTEM_INSTRUCTION}]
        for msg in session.messages.all():
            conversation.append({"role": msg.role, "content": msg.content})

        # 3. Call Local LLM or fall back to mock
        assistant_content = ""
        try:
            headers = {"Content-Type": "application/json"}
            payload = {
                "model": settings.LOCAL_LLM_MODEL,
                "messages": conversation,
                "temperature": 0.2
            }
            # Timeout set to 6 seconds to avoid blocking the request thread too long
            response = requests.post(settings.LOCAL_LLM_URL, headers=headers, json=payload, timeout=6.0)
            if response.status_code == 200:
                resp_json = response.json()
                assistant_content = resp_json['choices'][0]['message']['content']
            else:
                logger.warning(f"Local LLM API returned status {response.status_code}. Using mock fallback.")
                assistant_content = _generate_mock_response(content)
        except Exception as e:
            logger.warning(f"Error connecting to local LLM: {str(e)}. Using mock fallback.")
            assistant_content = _generate_mock_response(content)

        # 4. Save assistant response to database
        assistant_message = Message.objects.create(session=session, role='assistant', content=assistant_content)

        # 5. Parse and save any code snippets generated in the assistant response
        parsed_snippets = _parse_and_save_snippets(session, assistant_message, assistant_content)

        # Update session timestamp
        session.save()

        return JsonResponse({
            'user_message': {
                'id': str(user_message.id),
                'role': user_message.role,
                'content': user_message.content,
                'created_at': user_message.created_at.isoformat()
            },
            'assistant_message': {
                'id': str(assistant_message.id),
                'role': assistant_message.role,
                'content': assistant_message.content,
                'created_at': assistant_message.created_at.isoformat()
            },
            'snippets': parsed_snippets
        }, status=201)

    return JsonResponse({'error': 'Method not allowed'}, status=405)

def api_snippets(request, session_id):
    """Handles retrieval, addition, or saving/updating of code snippets in the session."""
    try:
        session = ChatSession.objects.get(id=session_id)
    except ChatSession.DoesNotExist:
        return JsonResponse({'error': 'Session not found'}, status=404)

    if request.method == 'GET':
        snippets = session.snippets.all().values('id', 'filename', 'language', 'content', 'updated_at')
        return JsonResponse(list(snippets), safe=False)

    elif request.method == 'POST' or request.method == 'PUT':
        try:
            data = json.loads(request.body)
            filename = data.get('filename', '').strip()
            content = data.get('content', '')
            language = data.get('language', 'plaintext').strip()
        except (json.JSONDecodeError, KeyError):
            return JsonResponse({'error': 'Invalid request body'}, status=400)

        if not filename:
            return JsonResponse({'error': 'Filename is required'}, status=400)

        # Validate filename to prevent directory traversal
        if '/' in filename or '\\' in filename or '..' in filename:
            return JsonResponse({'error': 'Invalid filename format'}, status=400)

        # Create or update snippet in workspace
        snippet, created = CodeSnippet.objects.update_or_create(
            session=session,
            filename=filename,
            defaults={'content': content, 'language': language}
        )

        return JsonResponse({
            'id': str(snippet.id),
            'filename': snippet.filename,
            'language': snippet.language,
            'content': snippet.content,
            'updated_at': snippet.updated_at.isoformat(),
            'created': created
        })

    return JsonResponse({'error': 'Method not allowed'}, status=405)

def api_snippet_detail(request, session_id, filename):
    """Handles details or deletion of a specific file snippet."""
    try:
        snippet = CodeSnippet.objects.get(session_id=session_id, filename=filename)
    except CodeSnippet.DoesNotExist:
        return JsonResponse({'error': 'Snippet not found'}, status=404)

    if request.method == 'DELETE':
        snippet.delete()
        return JsonResponse({'status': 'deleted'})

    return JsonResponse({'error': 'Method not allowed'}, status=405)

def api_suggest(request, session_id):
    """Handles real-time autocomplete suggestions using code context."""
    if request.method != 'POST':
        return JsonResponse({'error': 'Method not allowed'}, status=405)

    try:
        data = json.loads(request.body)
        filename = data.get('filename', '')
        code_content = data.get('content', '')
        cursor_line = data.get('line', 0)
        cursor_ch = data.get('ch', 0)
    except (json.JSONDecodeError, KeyError):
        return JsonResponse({'error': 'Invalid request body'}, status=400)

    # 1. Fallback suggestion logic or LLM completions if prompt is short
    # Here we perform dynamic context-aware suggestions
    suggestions = _generate_code_completions(filename, code_content, cursor_line, cursor_ch)
    return JsonResponse({'suggestions': suggestions})

# Helper function to extract code blocks from Markdown content and persist to database
def _parse_and_save_snippets(session, message, md_content):
    # Regex to extract code fences and optional language identifiers
    # Format: ```lang \n code \n ```
    pattern = r'```(\w*)\n(.*?)\n```'
    matches = re.finditer(pattern, md_content, re.DOTALL)
    snippets = []

    for match in matches:
        language = match.group(1).lower() or 'plaintext'
        code = match.group(2)

        # Inspect the first two lines of code block for filename comment
        lines = code.splitlines()
        filename = None
        if lines:
            first_line = lines[0]
            # Match comment formats like: File: index.html, file: script.py, filename: app.js
            fn_match = re.search(r'(?:file|filename|File|Filename):\s*([a-zA-Z0-9_\-\.]+)', first_line)
            if fn_match:
                filename = fn_match.group(1).strip()
                # Strip the comment line out of the code block so it stays clean in the editor
                code = "\n".join(lines[1:])
            elif len(lines) > 1:
                # Check second line just in case
                sec_match = re.search(r'(?:file|filename|File|Filename):\s*([a-zA-Z0-9_\-\.]+)', lines[1])
                if sec_match:
                    filename = sec_match.group(1).strip()
                    code = "\n".join([lines[0]] + lines[2:])

        if filename:
            # Save or update snippet
            snippet, created = CodeSnippet.objects.update_or_create(
                session=session,
                filename=filename,
                defaults={
                    'message': message,
                    'language': language,
                    'content': code
                }
            )
            snippets.append({
                'id': str(snippet.id),
                'filename': snippet.filename,
                'language': snippet.language,
                'content': snippet.content
            })

    return snippets

# Fallback offline generator for Xealzid responses
def _generate_mock_response(prompt):
    p_lower = prompt.lower()
    
    # 1. Check if user is asking for python/sorting/algorithms
    if "python" in p_lower or "sort" in p_lower or "algorithm" in p_lower:
        return (
            "### Off-line Architectural Suggestions: Quick Sort Implementation\n\n"
            "I've designed a clean, recursive Quick Sort implementation in Python. "
            "It uses a list comprehension approach for high readability, adhering to Pythonic design patterns.\n\n"
            "Here is the script file which I've loaded into your workspace workspace:\n\n"
            "```python\n"
            "# File: quick_sort.py\n"
            "def quicksort(arr):\n"
            "    \"\"\"Sorts the array using the quicksort algorithm.\"\"\"\n"
            "    if len(arr) <= 1:\n"
            "        return arr\n"
            "    pivot = arr[len(arr) // 2]\n"
            "    left = [x for x in arr if x < pivot]\n"
            "    middle = [x for x in arr if x == pivot]\n"
            "    right = [x for x in arr if x > pivot]\n"
            "    return quicksort(left) + middle + quicksort(right)\n\n"
            "# Example usage:\n"
            "if __name__ == '__main__':\n"
            "    test_data = [3, 6, 8, 10, 1, 2, 1]\n"
            "    print('Original:', test_data)\n"
            "    print('Sorted:', quicksort(test_data))\n"
            "```\n\n"
            "#### Key Architectural Notes:\n"
            "- **Time Complexity**: Average $O(n \\log n)$, Worst-case $O(n^2)$ when pivot selections are sub-optimal.\n"
            "- **Space Complexity**: $O(n)$ auxiliary space due to list reconstruction. For large in-place datasets, consider a two-pointer partitioning variant."
        )

    # 2. Check if user asks for web/html/css/frontend
    elif "html" in p_lower or "css" in p_lower or "web" in p_lower or "frontend" in p_lower:
        return (
            "### Cyber-minimal Grid Layout Component\n\n"
            "Here is a responsive, highly performant grid layout designed in pure CSS. "
            "It adopts a modern CSS grid strategy with autofit columns and supports dark mode.\n\n"
            "The components are created in `layout.html` and `grid.css`:\n\n"
            "```html\n"
            "<!-- File: layout.html -->\n"
            "<!DOCTYPE html>\n"
            "<html lang=\"en\">\n"
            "<head>\n"
            "    <meta charset=\"UTF-8\">\n"
            "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n"
            "    <link rel=\"stylesheet\" href=\"grid.css\">\n"
            "    <title>Xealzid Responsive Grid</title>\n"
            "</head>\n"
            "<body>\n"
            "    <main class=\"cyber-grid\">\n"
            "        <div class=\"grid-card\">\n"
            "            <h3>Module 01</h3>\n"
            "            <p>System integrity is green. Operations active.</p>\n"
            "        </div>\n"
            "        <div class=\"grid-card\">\n"
            "            <h3>Module 02</h3>\n"
            "            <p>Network connectivity at 99.8%. Encrypted handshake successful.</p>\n"
            "        </div>\n"
            "        <div class=\"grid-card\">\n"
            "            <h3>Module 03</h3>\n"
            "            <p>Subsystem core cooling stable. Temperature: 28C.</p>\n"
            "        </div>\n"
            "    </main>\n"
            "</body>\n"
            "</html>\n"
            "```\n\n"
            "And the associated styling sheet:\n\n"
            "```css\n"
            "/* File: grid.css */\n"
            ":root {\n"
            "    --bg-color: #0b0d10;\n"
            "    --card-bg: #12151c;\n"
            "    --accent-glow: #00f0ff;\n"
            "    --text-color: #d1d5db;\n"
            "}\n\n"
            "body {\n"
            "    background: var(--bg-color);\n"
            "    color: var(--text-color);\n"
            "    font-family: sans-serif;\n"
            "    padding: 2rem;\n"
            "}\n\n"
            ".cyber-grid {\n"
            "    display: grid;\n"
            "    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));\n"
            "    gap: 1.5rem;\n"
            "}\n\n"
            ".grid-card {\n"
            "    background: var(--card-bg);\n"
            "    border: 1px solid rgba(0, 240, 255, 0.15);\n"
            "    border-radius: 4px;\n"
            "    padding: 1.5rem;\n"
            "    transition: all 0.3s ease;\n"
            "}\n\n"
            ".grid-card:hover {\n"
            "    border-color: var(--accent-glow);\n"
            "    box-shadow: 0 0 10px rgba(0, 240, 255, 0.2);\n"
            "    transform: translateY(-2px);\n"
            "}\n"
            "```"
        )

    # 3. Default response
    return (
        "### Welcome to Xealzid Offline Mode\n\n"
        "The application is running in secure local fallback mode since a local LLM server wasn't detected. "
        "However, you can fully write, edit, and experiment with code inside the right editor panel.\n\n"
        "Try asking me to generate **Python code** or **HTML components** to see automated workspace sync in action.\n\n"
        "Here is a default workspace info script to check system settings:\n\n"
        "```javascript\n"
        "// File: check_sys.js\n"
        "const xealzidConfig = {\n"
        "    version: '1.0.0',\n"
        "    mode: 'offline_fallback',\n"
        "    theme: 'cyber-minimal',\n"
        "    owasp_strict: true\n"
        "};\n\n"
        "function verifyConfig() {\n"
        "    console.log(`[Xealzid] Operating in ${xealzidConfig.mode} mode.`);\n"
        "    return true;\n"
        "}\n"
        "verifyConfig();\n"
        "```\n\n"
        "Let me know what you'd like to build next!"
    )

# Static autocomplete completions depending on context
def _generate_code_completions(filename, content, line, ch):
    lines = content.splitlines()
    if not lines or line >= len(lines):
        return []
    
    current_line = lines[line][:ch].strip()
    ext = filename.split('.')[-1].lower() if '.' in filename else ''
    
    completions = []
    # Python helpers
    if ext == 'py':
        if current_line.endswith('def '):
            completions = ['main():', 'quicksort(arr):', '__init__(self):']
        elif current_line.endswith('import '):
            completions = ['os', 'sys', 'json', 'requests', 'math']
        elif current_line.endswith('print('):
            completions = ['"System OK"']
    # JS helpers
    elif ext == 'js':
        if current_line.endswith('const '):
            completions = ['config = {}', 'element = document.getElementById()']
        elif current_line.endswith('document.'):
            completions = ['getElementById', 'querySelector', 'querySelectorAll', 'addEventListener']
        elif current_line.endswith('console.'):
            completions = ['log', 'error', 'warn', 'info']
    # HTML helpers
    elif ext in ['html', 'htm']:
        if current_line.endswith('<'):
            completions = ['div class=""', 'span', 'main class=""', 'section', 'button id=""', 'input type="text"']
        elif current_line.endswith('class="'):
            completions = ['cyber-grid', 'grid-card', 'btn-primary', 'editor-container', 'chat-bubble']
            
    return completions
