document.addEventListener('DOMContentLoaded', () => {
    // State management
    let currentSessionId = null;
    let activeFile = null;
    let openFiles = {}; // filename -> content/metadata
    let currentSuggestions = [];
    let activeSuggestionIndex = -1;

    // Elements
    const sidebar = document.getElementById('sidebar');
    const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
    const tabChatBtn = document.getElementById('tab-chat-btn');
    const tabWorkspaceBtn = document.getElementById('tab-workspace-btn');
    const mainWorkspace = document.querySelector('.main-workspace');
    
    const newSessionBtn = document.getElementById('new-session-btn');
    const sessionsList = document.getElementById('sessions-list');
    const connectionStatus = document.getElementById('connection-status');
    const statusDot = document.querySelector('.status-dot');

    const chatMessages = document.getElementById('chat-messages');
    const chatInputForm = document.getElementById('chat-input-form');
    const chatMessageInput = document.getElementById('chat-message-input');
    const chatSubmitBtn = document.getElementById('chat-submit-btn');

    const fileTabs = document.getElementById('file-tabs');
    const addFileBtn = document.getElementById('add-file-btn');
    const editorWelcome = document.getElementById('editor-welcome');
    const editorContainer = document.getElementById('editor-container');
    
    const activeFilename = document.getElementById('active-filename');
    const activeLanguage = document.getElementById('active-language');
    const editToggleBtn = document.getElementById('edit-toggle-btn');
    const copyCodeBtn = document.getElementById('copy-code-btn');
    const downloadFileBtn = document.getElementById('download-file-btn');
    const deleteFileBtn = document.getElementById('delete-file-btn');

    const codeViewerWrapper = document.getElementById('code-viewer-wrapper');
    const codeDisplay = document.getElementById('code-display');
    const codeEditorWrapper = document.getElementById('code-editor-wrapper');
    const codeEditTextarea = document.getElementById('code-edit-textarea');
    const textareaLineNumbers = document.getElementById('textarea-line-numbers');
    const suggestionsPanel = document.getElementById('suggestions-panel');
    
    const saveStatus = document.getElementById('save-status');
    const triggerSuggestBtn = document.getElementById('trigger-suggest-btn');

    const newFileModal = document.getElementById('new-file-modal');
    const newFileForm = document.getElementById('new-file-form');
    const newFilenameInput = document.getElementById('new-filename');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');

    // --- Helper Functions ---

    // Secure CSRF Token reader
    function getCsrfToken() {
        const meta = document.querySelector('meta[name="csrf-token"]');
        return meta ? meta.getAttribute('content') : '';
    }

    // Secure custom API call wrapper
    async function apiCall(url, method = 'GET', body = null) {
        const headers = {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        };
        const config = { method, headers };
        if (body) {
            config.body = JSON.stringify(body);
        }
        try {
            const response = await fetch(url, config);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (e) {
            console.error(`API Call failed [${method} ${url}]:`, e);
            showNotification(`Error: ${e.message}`, 'error');
            throw e;
        }
    }

    function showNotification(msg, type = 'info') {
        // Light notification system inside editor status or alert
        console.log(`[Notification] ${type.toUpperCase()}: ${msg}`);
        if (type === 'error') {
            saveStatus.textContent = msg;
            saveStatus.style.color = 'var(--accent-danger)';
        } else {
            saveStatus.textContent = msg;
            saveStatus.style.color = 'var(--text-secondary)';
        }
        setTimeout(() => {
            saveStatus.textContent = 'Saved';
            saveStatus.style.color = 'var(--text-secondary)';
        }, 4000);
    }

    // --- Markdown to Sanitized HTML Parser ---
    function parseMarkdown(md) {
        if (!md) return '';
        
        let html = md;
        
        // Escape HTML to mitigate XSS before adding tags
        html = escapeHTML(html);

        // Code blocks: ```lang \n code \n ```
        html = html.replace(/```(\w*)\n([\s\S]*?)\n```/g, (match, lang, code) => {
            const languageClass = lang ? `class="language-${lang.toLowerCase()}"` : '';
            return `<pre><code ${languageClass}>${code}</code></pre>`;
        });

        // Inline code: `code`
        html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');

        // Headers: ###, ##, #
        html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.*?)$/gm, '<h4>$1</h4>');
        html = html.replace(/^# (.*?)$/gm, '<h2>$1</h2>');

        // Bold: **text**
        html = html.replace(/\*\*([\s\S]*?)\*\*/g, '<strong>$1</strong>');

        // Unordered lists: - item
        html = html.replace(/^\-\s+(.*?)$/gm, '<li>$1</li>');
        // Wrap lists: if we have <li>, group them inside <ul>
        // This is a simple wrapper logic
        html = html.replace(/(<li>.*?<\/li>)+/g, '<ul>$&</ul>');

        // Paragraphs: separate double newlines into p blocks, except pre blocks
        const parts = html.split(/(<pre>[\s\S]*?<\/pre>)/);
        html = parts.map(part => {
            if (part.startsWith('<pre>')) return part;
            return part.split(/\n\n+/).map(p => {
                const trimmed = p.trim();
                if (!trimmed || trimmed.startsWith('<h') || trimmed.startsWith('<ul') || trimmed.startsWith('<li>')) return trimmed;
                return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
            }).join('');
        }).join('');

        // Use DOMPurify for strict sanitization
        if (window.DOMPurify) {
            return window.DOMPurify.sanitize(html, {
                ALLOWED_TAGS: ['p', 'br', 'pre', 'code', 'h2', 'h3', 'h4', 'strong', 'ul', 'li', 'ol'],
                ALLOWED_ATTR: ['class']
            });
        }
        
        return html; // Fallback
    }

    function escapeHTML(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // --- State and UI Updates ---

    // Fetch and populate sessions
    async function loadSessions() {
        try {
            const sessions = await apiCall('/api/sessions/');
            sessionsList.innerHTML = '';
            
            if (sessions.length === 0) {
                sessionsList.innerHTML = '<li class="session-placeholder">No active sessions.</li>';
                return;
            }

            sessions.forEach(sess => {
                const li = document.createElement('li');
                li.setAttribute('data-id', sess.id);
                if (sess.id === currentSessionId) li.classList.add('active');
                
                li.innerHTML = `
                    <span class="session-title">${escapeHTML(sess.title)}</span>
                    <button class="delete-session" title="Delete Session">
                        <svg class="icon" viewBox="0 0 24 24"><path fill="currentColor" d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z"/></svg>
                    </button>
                `;

                li.addEventListener('click', (e) => {
                    if (e.target.closest('.delete-session')) {
                        deleteSession(sess.id);
                    } else {
                        selectSession(sess.id);
                    }
                });

                sessionsList.appendChild(li);
            });
        } catch (e) {
            console.error("Failed to load sessions", e);
        }
    }

    // Create session
    async function createSession(title = 'New Session') {
        try {
            const session = await apiCall('/api/sessions/', 'POST', { title });
            currentSessionId = session.id;
            await loadSessions();
            await selectSession(session.id);
        } catch (e) {
            console.error("Failed to create session", e);
        }
    }

    // Delete session
    async function deleteSession(id) {
        if (!confirm('Are you sure you want to delete this session? All history will be lost.')) return;
        try {
            await apiCall(`/api/sessions/${id}/`, 'DELETE');
            if (currentSessionId === id) {
                currentSessionId = null;
                activeFile = null;
                openFiles = {};
                renderWorkspace();
                chatMessages.innerHTML = `
                    <div class="chat-welcome">
                        <div class="welcome-card">
                            <h3>Session Terminated</h3>
                            <p>Select or create a new session in the sidebar to begin.</p>
                        </div>
                    </div>
                `;
            }
            await loadSessions();
        } catch (e) {
            console.error("Failed to delete session", e);
        }
    }

    // Select session
    async function selectSession(id) {
        currentSessionId = id;
        
        // Highlight active item in list
        document.querySelectorAll('#sessions-list li').forEach(li => {
            li.classList.remove('active');
            if (li.getAttribute('data-id') === id) {
                li.classList.add('active');
            }
        });

        // Close sidebar if open on mobile
        sidebar.classList.remove('open');

        // Load Messages
        chatMessages.innerHTML = '<div class="chat-welcome"><div class="welcome-card"><h3>Loading History...</h3></div></div>';
        try {
            const messages = await apiCall(`/api/sessions/${id}/messages/`);
            renderMessages(messages);
        } catch (e) {
            chatMessages.innerHTML = '<div class="chat-welcome"><div class="welcome-card"><h3 style="color:var(--accent-danger)">Error loading messages</h3></div></div>';
        }

        // Load Workspace Code Snippets
        try {
            const snippets = await apiCall(`/api/sessions/${id}/snippets/`);
            openFiles = {};
            snippets.forEach(snip => {
                openFiles[snip.filename] = {
                    id: snip.id,
                    filename: snip.filename,
                    language: snip.language,
                    content: snip.content
                };
            });
            
            // Set active file to first available file, or null
            const fileList = Object.keys(openFiles);
            if (fileList.length > 0) {
                activeFile = fileList[0];
            } else {
                activeFile = null;
            }
            renderWorkspace();
        } catch (e) {
            console.error("Error loading workspace snippets", e);
        }
    }

    // Render Messages list
    function renderMessages(messages) {
        chatMessages.innerHTML = '';
        if (messages.length === 0) {
            chatMessages.innerHTML = `
                <div class="chat-welcome">
                    <div class="welcome-card">
                        <h3>Session Initialized</h3>
                        <p>Xealzid is a secure, cyber-minimal editor. You can prompt me to write code, design schemas, or refine architectures.</p>
                        <div class="welcome-shortcuts">
                            <button class="shortcut-btn" data-prompt="Implement a Quick Sort algorithm in Python">Python Quick Sort</button>
                            <button class="shortcut-btn" data-prompt="Create a responsive CSS Grid layout">CSS Grid Layout</button>
                        </div>
                    </div>
                </div>
            `;
            // Reattach events for shortcuts
            document.querySelectorAll('.shortcut-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    chatMessageInput.value = btn.getAttribute('data-prompt');
                    chatInputForm.dispatchEvent(new Event('submit'));
                });
            });
            return;
        }

        messages.forEach(msg => {
            appendMessage(msg.role, msg.content, msg.created_at);
        });
        scrollToBottom();
    }

    // Append single message bubble
    function appendMessage(role, content, timestamp = null) {
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${role}`;
        
        // Custom parser converts markdown + uses DOMPurify
        const parsedHTML = parseMarkdown(content);
        bubble.innerHTML = parsedHTML;

        // Add timestamps
        const meta = document.createElement('div');
        meta.className = 'chat-bubble-meta';
        const dateStr = timestamp ? new Date(timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        meta.textContent = `${role === 'user' ? 'USER' : 'XEALZID'} // ${dateStr}`;
        bubble.appendChild(meta);

        chatMessages.appendChild(bubble);
        
        // Trigger syntax highlight on code elements inside messages
        if (window.Prism) {
            bubble.querySelectorAll('pre code').forEach(codeBlock => {
                window.Prism.highlightElement(codeBlock);
            });
        }
    }

    function scrollToBottom() {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // --- Workspace and Code Sandbox Operations ---

    function getLanguageFromExtension(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        const mapping = {
            'html': 'html',
            'htm': 'html',
            'css': 'css',
            'js': 'javascript',
            'json': 'json',
            'py': 'python',
            'sh': 'bash',
            'md': 'markdown',
            'sql': 'sql',
            'c': 'c',
            'cpp': 'cpp',
            'java': 'java'
        };
        return mapping[ext] || 'plaintext';
    }

    // Render workspace files, tabs, and load editor if a file is active
    function renderWorkspace() {
        fileTabs.innerHTML = '';
        const filenames = Object.keys(openFiles);
        
        if (filenames.length === 0) {
            editorWelcome.classList.remove('hidden');
            editorContainer.classList.add('hidden');
            return;
        }

        editorWelcome.classList.add('hidden');
        editorContainer.classList.remove('hidden');

        filenames.forEach(name => {
            const tab = document.createElement('span');
            tab.className = `file-tab ${name === activeFile ? 'active' : ''}`;
            tab.innerHTML = `
                ${name}
                <button class="close-tab" title="Close File">&times;</button>
            `;
            
            tab.addEventListener('click', (e) => {
                if (e.target.classList.contains('close-tab')) {
                    e.stopPropagation();
                    closeFile(name);
                } else {
                    activeFile = name;
                    renderWorkspace();
                }
            });

            fileTabs.appendChild(tab);
        });

        // Load content for active file
        if (activeFile && openFiles[activeFile]) {
            const file = openFiles[activeFile];
            activeFilename.textContent = file.filename;
            
            const lang = getLanguageFromExtension(file.filename);
            activeLanguage.textContent = lang;

            // Load Viewer
            codeDisplay.textContent = file.content;
            codeDisplay.className = `language-${lang}`;
            if (window.Prism) {
                window.Prism.highlightElement(codeDisplay);
            }

            // Sync Textarea content
            codeEditTextarea.value = file.content;
            updateLineNumbers();
        }
    }

    function closeFile(filename) {
        // Just removes from UI cache. In production-grade editors, this is safe unless unsaved.
        // We will keep it simple: just switch active tab if we close the active one
        if (activeFile === filename) {
            const list = Object.keys(openFiles).filter(f => f !== filename);
            activeFile = list.length > 0 ? list[0] : null;
        }
        delete openFiles[filename];
        renderWorkspace();
    }

    async function deleteFileFromWorkspace() {
        if (!activeFile) return;
        if (!confirm(`Are you sure you want to delete '${activeFile}' from your workspace?`)) return;
        
        try {
            await apiCall(`/api/sessions/${currentSessionId}/snippets/${activeFile}/`, 'DELETE');
            const fileToDelete = activeFile;
            activeFile = null;
            delete openFiles[fileToDelete];
            const list = Object.keys(openFiles);
            if (list.length > 0) activeFile = list[0];
            renderWorkspace();
            showNotification(`File '${fileToDelete}' deleted.`);
        } catch (e) {
            console.error("Error deleting file", e);
        }
    }

    // Auto update line numbers inside the editing view
    function updateLineNumbers() {
        const text = codeEditTextarea.value;
        const lineCount = text.split('\n').length;
        let numbersHTML = '';
        for (let i = 1; i <= lineCount; i++) {
            numbersHTML += `<div>${i}</div>`;
        }
        textareaLineNumbers.innerHTML = numbersHTML;
    }

    // --- Interactive Editing & Suggestion Engine ---

    // Toggle between highlighted view and editable textarea
    editToggleBtn.addEventListener('click', () => {
        const isViewing = !codeViewerWrapper.classList.contains('hidden');
        if (isViewing) {
            // Switch to edit mode
            codeViewerWrapper.classList.add('hidden');
            codeEditorWrapper.classList.remove('hidden');
            editToggleBtn.textContent = 'View Highlights';
            codeEditTextarea.focus();
        } else {
            // Save local modifications and switch to view mode
            const content = codeEditTextarea.value;
            openFiles[activeFile].content = content;
            
            // Save to database
            saveActiveFile(content);

            codeViewerWrapper.classList.remove('hidden');
            codeEditorWrapper.classList.add('hidden');
            editToggleBtn.textContent = 'Edit File';
            renderWorkspace();
        }
    });

    async function saveActiveFile(content) {
        if (!currentSessionId || !activeFile) return;
        saveStatus.textContent = 'Saving...';
        try {
            const lang = getLanguageFromExtension(activeFile);
            await apiCall(`/api/sessions/${currentSessionId}/snippets/`, 'POST', {
                filename: activeFile,
                content: content,
                language: lang
            });
            saveStatus.textContent = 'Saved';
        } catch (e) {
            saveStatus.textContent = 'Save Failed';
            saveStatus.style.color = 'var(--accent-danger)';
        }
    }

    // Listen to changes in textarea
    codeEditTextarea.addEventListener('input', () => {
        updateLineNumbers();
        // Trigger suggestions on specific characters or short timer
        handleAutocompletion();
    });

    // Sync scrolling of textarea and line numbers
    codeEditTextarea.addEventListener('scroll', () => {
        textareaLineNumbers.scrollTop = codeEditTextarea.scrollTop;
    });

    // Handle suggestions on trigger characters or keys
    async function handleAutocompletion() {
        const cursor = codeEditTextarea.selectionStart;
        const text = codeEditTextarea.value;
        const textBeforeCursor = text.substring(0, cursor);
        const lines = textBeforeCursor.split('\n');
        const currentLineNum = lines.length - 1;
        const currentCh = lines[currentLineNum].length;

        // Check trigger tokens (like 'def ', 'const ', 'import ', '<')
        const currentLine = lines[currentLineNum].trim();
        const triggers = ['def', 'const', 'import', 'let', 'class', 'function', '<'];
        const isTrigger = triggers.some(t => currentLine.endsWith(t) || currentLine === t);

        if (isTrigger && currentSessionId && activeFile) {
            try {
                const resp = await apiCall(`/api/sessions/${currentSessionId}/suggest/`, 'POST', {
                    filename: activeFile,
                    content: text,
                    line: currentLineNum,
                    ch: currentCh
                });
                
                if (resp.suggestions && resp.suggestions.length > 0) {
                    showSuggestions(resp.suggestions);
                } else {
                    hideSuggestions();
                }
            } catch (e) {
                hideSuggestions();
            }
        } else {
            hideSuggestions();
        }
    }

    function showSuggestions(list) {
        currentSuggestions = list;
        activeSuggestionIndex = 0;
        
        suggestionsPanel.innerHTML = '';
        list.forEach((item, idx) => {
            const div = document.createElement('div');
            div.className = `suggestion-item ${idx === 0 ? 'active' : ''}`;
            div.textContent = item;
            div.addEventListener('click', () => {
                insertSuggestion(item);
            });
            suggestionsPanel.appendChild(div);
        });

        // Position suggestions panel below cursor
        const caretPos = getCaretCoordinates(codeEditTextarea, codeEditTextarea.selectionStart);
        suggestionsPanel.style.left = `${caretPos.left}px`;
        suggestionsPanel.style.top = `${caretPos.top + 20}px`;
        suggestionsPanel.classList.remove('hidden');
    }

    function hideSuggestions() {
        suggestionsPanel.classList.add('hidden');
        currentSuggestions = [];
        activeSuggestionIndex = -1;
    }

    function insertSuggestion(value) {
        const text = codeEditTextarea.value;
        const cursor = codeEditTextarea.selectionStart;
        
        // Insert suggestion at cursor
        const newText = text.substring(0, cursor) + value + text.substring(cursor);
        codeEditTextarea.value = newText;
        openFiles[activeFile].content = newText;
        
        // Reposition cursor after the inserted text
        const newCursor = cursor + value.length;
        codeEditTextarea.setSelectionRange(newCursor, newCursor);
        
        updateLineNumbers();
        hideSuggestions();
        saveActiveFile(newText);
    }

    // Caret coordinates approximation helper
    function getCaretCoordinates(element, position) {
        // Simple pixel calculator for placing autocomplete boxes
        // In minimal cyber layouts, bounding calculations can be placed safely
        const { offsetLeft, offsetTop } = element;
        // Basic line height & char width estimate
        const textBefore = element.value.substring(0, position);
        const lines = textBefore.split('\n');
        const currentLineNum = lines.length - 1;
        const charsOnLine = lines[currentLineNum].length;
        
        return {
            left: offsetLeft + 20 + (charsOnLine * 7.8), // Approx character width (Fira Code)
            top: offsetTop + 24 + (currentLineNum * 21.6) - element.scrollTop // Approx line height (1.6 * 13.5px)
        };
    }

    // Keyboard bindings for Suggestions navigation & shortcuts
    codeEditTextarea.addEventListener('keydown', (e) => {
        if (!suggestionsPanel.classList.contains('hidden') && currentSuggestions.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                activeSuggestionIndex = (activeSuggestionIndex + 1) % currentSuggestions.length;
                updateActiveSuggestion();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                activeSuggestionIndex = (activeSuggestionIndex - 1 + currentSuggestions.length) % currentSuggestions.length;
                updateActiveSuggestion();
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                insertSuggestion(currentSuggestions[activeSuggestionIndex]);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                hideSuggestions();
            }
        }
        
        // Ctrl+Space to force suggestion request
        if (e.ctrlKey && e.key === ' ') {
            e.preventDefault();
            handleAutocompletion();
        }

        // Tab insertion fallback (standard textarea behavior inserts focus, we want 4 spaces)
        if (e.key === 'Tab' && suggestionsPanel.classList.contains('hidden')) {
            e.preventDefault();
            const start = codeEditTextarea.selectionStart;
            const end = codeEditTextarea.selectionEnd;
            const text = codeEditTextarea.value;
            codeEditTextarea.value = text.substring(0, start) + "    " + text.substring(end);
            codeEditTextarea.selectionStart = codeEditTextarea.selectionEnd = start + 4;
            updateLineNumbers();
        }
    });

    function updateActiveSuggestion() {
        const items = suggestionsPanel.querySelectorAll('.suggestion-item');
        items.forEach((item, idx) => {
            if (idx === activeSuggestionIndex) {
                item.classList.add('active');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.classList.remove('active');
            }
        });
    }

    // --- Action Button Events ---

    // Copy code snippet to clipboard
    copyCodeBtn.addEventListener('click', () => {
        if (!activeFile || !openFiles[activeFile]) return;
        const code = openFiles[activeFile].content;
        navigator.clipboard.writeText(code).then(() => {
            showNotification('Copied code to clipboard.');
        }).catch(err => {
            showNotification('Failed to copy code.', 'error');
        });
    });

    // Download code snippet locally
    downloadFileBtn.addEventListener('click', () => {
        if (!activeFile || !openFiles[activeFile]) return;
        const file = openFiles[activeFile];
        const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    // Delete file
    deleteFileBtn.addEventListener('click', deleteFileFromWorkspace);

    // Architect manual suggestions button
    triggerSuggestBtn.addEventListener('click', async () => {
        if (!currentSessionId || !activeFile) return;
        showNotification('Querying architecture guidelines...');
        try {
            const promptContent = `Analyze the file '${activeFile}' and suggest improvements or highlight potential bugs. Here is the code:\n\n${openFiles[activeFile].content}`;
            
            // We append a custom assistant prompt via messaging API
            appendMessage('user', `Architect Audit: ${activeFile}`);
            
            // Temporary typing indicator
            const loadingBubble = document.createElement('div');
            loadingBubble.className = 'chat-bubble assistant typing-indicator';
            loadingBubble.innerHTML = '<span class="status-dot pulse-glow"></span> Reviewing workspace code...';
            chatMessages.appendChild(loadingBubble);
            scrollToBottom();

            const resp = await apiCall(`/api/sessions/${currentSessionId}/messages/`, 'POST', {
                content: promptContent
            });

            loadingBubble.remove();
            
            // Append real response
            appendMessage('assistant', resp.assistant_message.content, resp.assistant_message.created_at);
            
            // Sync workspace files if LLM outputted code blocks
            if (resp.snippets && resp.snippets.length > 0) {
                resp.snippets.forEach(snip => {
                    openFiles[snip.filename] = {
                        id: snip.id,
                        filename: snip.filename,
                        language: snip.language,
                        content: snip.content
                    };
                });
                renderWorkspace();
            }
            scrollToBottom();
        } catch (e) {
            console.error("Architecture suggest failed", e);
        }
    });

    // --- Chat Submit and Message Pipeline ---
    chatInputForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const content = chatMessageInput.value.trim();
        if (!content || !currentSessionId) return;

        chatMessageInput.value = '';
        chatMessageInput.style.height = 'auto';

        // 1. Render user message in chat immediately
        appendMessage('user', content);
        scrollToBottom();

        // 2. Append writing indicator bubble
        const typingBubble = document.createElement('div');
        typingBubble.className = 'chat-bubble assistant typing-indicator';
        typingBubble.innerHTML = '<span class="status-dot pulse-glow"></span> Processing code guidelines...';
        chatMessages.appendChild(typingBubble);
        scrollToBottom();

        try {
            // 3. Post user message to backend
            const response = await apiCall(`/api/sessions/${currentSessionId}/messages/`, 'POST', { content });
            
            // Remove writing indicator
            typingBubble.remove();

            // 4. Render assistant response
            appendMessage('assistant', response.assistant_message.content, response.assistant_message.created_at);

            // 5. Update workspace with any newly extracted files/snippets
            if (response.snippets && response.snippets.length > 0) {
                let firstNewFile = null;
                response.snippets.forEach(snip => {
                    if (!openFiles[snip.filename]) firstNewFile = snip.filename;
                    openFiles[snip.filename] = {
                        id: snip.id,
                        filename: snip.filename,
                        language: snip.language,
                        content: snip.content
                    };
                });
                if (firstNewFile) activeFile = firstNewFile;
                renderWorkspace();
            }
            
            scrollToBottom();
        } catch (err) {
            typingBubble.remove();
            appendMessage('assistant', `Failed to retrieve recommendations. Reason: ${err.message}`);
            scrollToBottom();
        }
    });

    // Handle Ctrl+Enter to send messages
    chatMessageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            chatInputForm.dispatchEvent(new Event('submit'));
        }
    });

    // Auto-grow textarea height
    chatMessageInput.addEventListener('input', () => {
        chatMessageInput.style.height = 'auto';
        chatMessageInput.style.height = `${chatMessageInput.scrollHeight}px`;
    });

    // --- Modal & Create File Handling ---
    addFileBtn.addEventListener('click', () => {
        if (!currentSessionId) {
            alert('Please select or create an active session first.');
            return;
        }
        newFileModal.classList.remove('hidden');
        newFilenameInput.focus();
    });

    modalCancelBtn.addEventListener('click', () => {
        newFileModal.classList.add('hidden');
        newFileForm.reset();
    });

    newFileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const filename = newFilenameInput.value.trim();
        if (!filename) return;

        // Close modal
        newFileModal.classList.add('hidden');
        newFileForm.reset();

        const lang = getLanguageFromExtension(filename);
        try {
            const snippet = await apiCall(`/api/sessions/${currentSessionId}/snippets/`, 'POST', {
                filename: filename,
                content: `// File: ${filename}\n// Start writing code here...\n`,
                language: lang
            });

            openFiles[filename] = {
                id: snippet.id,
                filename: snippet.filename,
                language: snippet.language,
                content: snippet.content
            };
            activeFile = filename;
            renderWorkspace();
            
            // Automatically switch editor to Edit Mode for new files
            codeViewerWrapper.classList.add('hidden');
            codeEditorWrapper.classList.remove('hidden');
            editToggleBtn.textContent = 'View Highlights';
            codeEditTextarea.focus();
            
        } catch (e) {
            console.error("Failed to create file", e);
        }
    });

    newSessionBtn.addEventListener('click', () => {
        const title = prompt('Enter a name for the architectural session:', `Session #${Date.now().toString().slice(-4)}`);
        if (title !== null) {
            createSession(title.trim() || undefined);
        }
    });

    // --- Mobile Pane Switching and Sidebar Toggle ---
    toggleSidebarBtn.addEventListener('click', () => {
        sidebar.classList.toggle('open');
    });

    // Click outside sidebar on mobile closes it
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768) {
            if (!sidebar.contains(e.target) && !toggleSidebarBtn.contains(e.target) && sidebar.classList.contains('open')) {
                sidebar.classList.remove('open');
            }
        }
    });

    tabChatBtn.addEventListener('click', () => {
        tabChatBtn.classList.add('active');
        tabWorkspaceBtn.classList.remove('active');
        mainWorkspace.classList.remove('workspace-active');
    });

    tabWorkspaceBtn.addEventListener('click', () => {
        tabWorkspaceBtn.classList.add('active');
        tabChatBtn.classList.remove('active');
        mainWorkspace.classList.add('workspace-active');
    });

    // Start App initialization
    (async () => {
        // Load sessions list
        await loadSessions();

        // Check if there is an active session, if not create one or list them
        const firstSession = document.querySelector('#sessions-list li');
        if (firstSession && firstSession.getAttribute('data-id')) {
            selectSession(firstSession.getAttribute('data-id'));
        } else {
            // Auto create first session
            await createSession('Architecture Hub');
        }
    })();
});
