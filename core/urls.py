from django.urls import path
from . import views

urlpatterns = [
    path('', views.editor_page, name='editor_page'),
    path('api/sessions/', views.api_sessions, name='api_sessions'),
    path('api/sessions/<uuid:session_id>/', views.api_session_detail, name='api_session_detail'),
    path('api/sessions/<uuid:session_id>/messages/', views.api_messages, name='api_messages'),
    path('api/sessions/<uuid:session_id>/snippets/', views.api_snippets, name='api_snippets'),
    path('api/sessions/<uuid:session_id>/snippets/<str:filename>/', views.api_snippet_detail, name='api_snippet_detail'),
    path('api/sessions/<uuid:session_id>/suggest/', views.api_suggest, name='api_suggest'),
]
