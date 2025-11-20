from django.urls import path
from . import views

urlpatterns = [
    path("auth/dev-login/", views.dev_login),
    path("me/", views.me),
    path("words/", views.WordsView.as_view()),
    path("words/<int:word_id>/miss/", views.mark_miss),
    path("words/<int:word_id>/hit/", views.mark_hit),
    path("practice/next-spec/", views.next_prompt_spec),
    path("llm/generate/", views.llm_generate),  # <— add this
]