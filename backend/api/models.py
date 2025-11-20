from django.db import models
from django.contrib.auth.models import User

class Word(models.Model):
    POS_CHOICES = [
        ("verb", "Verb"),
        ("noun", "Noun"),
        ("adj", "Adjective"),
        ("adv", "Adverb"),
        ("other", "Other"),
    ]
    text = models.CharField(max_length=128)        # lemma/base form e.g. "dormire"
    language = models.CharField(max_length=8, default="it")
    pos = models.CharField(max_length=8, choices=POS_CHOICES, default="other")
    # For verbs, keep it minimal now; we can store optional features (tenses/persons) here
    features = models.JSONField(default=dict, blank=True)  # {"tenses":["presente","passato prossimo"], "persons":["1s","3s",...]}
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("text", "language")

    def __str__(self):
        return f"{self.text} ({self.pos})"

class UserWord(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="user_words")
    word = models.ForeignKey(Word, on_delete=models.CASCADE, related_name="user_links")
    miss_count = models.PositiveIntegerField(default=0)
    hit_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "word")