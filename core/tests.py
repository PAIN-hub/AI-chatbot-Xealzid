import json
from django.test import TestCase, Client
from django.urls import reverse
from .models import ChatSession, Message, CodeSnippet

class SecurityHeadersMiddlewareTest(TestCase):
    def test_security_headers_present(self):
        """Verify that security headers (CSP, Frame Options, Referrer Policy) are correctly set by middleware."""
        response = self.client.get(reverse('editor_page'))
        self.assertEqual(response.status_code, 200)
        
        # Verify Content-Security-Policy (CSP)
        self.assertIn('Content-Security-Policy', response.headers)
        csp = response.headers['Content-Security-Policy']
        self.assertIn("default-src 'self'", csp)
        self.assertIn("script-src 'self'", csp)
        
        # Verify clickjacking and mime sniffing protections
        self.assertEqual(response.headers.get('X-Frame-Options'), 'DENY')
        self.assertEqual(response.headers.get('X-Content-Type-Options'), 'nosniff')
        self.assertEqual(response.headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin')

class ChatAPITestCase(TestCase):
    def setUp(self):
        self.client = Client()
        self.session = ChatSession.objects.create(title="Test Session")

    def test_session_list(self):
        """Test listing sessions via REST API."""
        response = self.client.get(reverse('api_sessions'))
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]['title'], "Test Session")

    def test_session_create(self):
        """Test creating a new session via REST API."""
        response = self.client.post(
            reverse('api_sessions'),
            data=json.dumps({'title': 'New API Session'}),
            content_type='application/json'
        )
        self.assertEqual(response.status_code, 210)
        data = response.json()
        self.assertIn('id', data)
        self.assertEqual(data['title'], 'New API Session')
        self.assertTrue(ChatSession.objects.filter(title='New API Session').exists())

    def test_message_post_and_snippet_extraction(self):
        """Test posting a user message and verify code block parsing into CodeSnippet model."""
        # Post a message that requests python code
        response = self.client.post(
            reverse('api_messages', kwargs={'session_id': self.session.id}),
            data=json.dumps({'content': 'Generate a python quick sort script.'}),
            content_type='application/json'
        )
        self.assertEqual(response.status_code, 201)
        data = response.json()
        
        # Verify user and assistant messages exist in database
        self.assertEqual(self.session.messages.count(), 2)
        user_msg = self.session.messages.filter(role='user').first()
        assistant_msg = self.session.messages.filter(role='assistant').first()
        
        self.assertEqual(user_msg.content, 'Generate a python quick sort script.')
        self.assertIn('quicksort', assistant_msg.content)
        
        # Verify that code snippet was successfully extracted from markdown and saved
        self.assertEqual(self.session.snippets.count(), 1)
        snippet = self.session.snippets.first()
        self.assertEqual(snippet.filename, 'quick_sort.py')
        self.assertEqual(snippet.language, 'python')
        self.assertIn('def quicksort(arr):', snippet.content)
        self.assertEqual(snippet.message, assistant_msg)

    def test_snippet_create_or_update(self):
        """Test creating/editing snippets directly via Workspace REST API."""
        # Create snippet
        response = self.client.post(
            reverse('api_snippets', kwargs={'session_id': self.session.id}),
            data=json.dumps({
                'filename': 'main.js',
                'content': 'console.log("hello");',
                'language': 'javascript'
            }),
            content_type='application/json'
        )
        self.assertEqual(response.status_code, 200)
        
        # Verify db entry
        self.assertEqual(self.session.snippets.count(), 1)
        snippet = self.session.snippets.get(filename='main.js')
        self.assertEqual(snippet.content, 'console.log("hello");')

        # Update snippet content (PUT / POST update)
        response_update = self.client.post(
            reverse('api_snippets', kwargs={'session_id': self.session.id}),
            data=json.dumps({
                'filename': 'main.js',
                'content': 'console.log("updated");',
                'language': 'javascript'
            }),
            content_type='application/json'
        )
        self.assertEqual(response_update.status_code, 200)
        snippet.refresh_from_db()
        self.assertEqual(snippet.content, 'console.log("updated");')

    def test_snippet_directory_traversal_prevention(self):
        """Verify that invalid filenames (directory traversal attempts) are rejected by the API."""
        response = self.client.post(
            reverse('api_snippets', kwargs={'session_id': self.session.id}),
            data=json.dumps({
                'filename': '../../hacked.py',
                'content': 'print("XSS")',
                'language': 'python'
            }),
            content_type='application/json'
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('Invalid filename format', response.json()['error'])
        self.assertEqual(self.session.snippets.count(), 0)

    def test_completions_suggest(self):
        """Test that context-aware completions are returned."""
        response = self.client.post(
            reverse('api_suggest', kwargs={'session_id': self.session.id}),
            data=json.dumps({
                'filename': 'script.js',
                'content': 'console.',
                'line': 0,
                'ch': 8
            }),
            content_type='application/json'
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn('suggestions', data)
        self.assertIn('log', data['suggestions'])
