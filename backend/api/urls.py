from django.urls import path
from . import views

urlpatterns = [
    path("auth/dev-login/", views.dev_login),
    path("me/", views.me),
    path("words/", views.WordsView.as_view()),
    
    # Updated scoring endpoints
    path("words/<int:word_id>/score/", views.update_score), 
    
    path("words/add-new/", views.add_new_verbs), # New endpoint
    path("words/reset-stats/", views.reset_stats), # New endpoint
    
    path("practice/batch-specs/", views.batch_prompt_specs),
    path("llm/generate/", views.llm_generate),
]