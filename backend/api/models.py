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
    text = models.CharField(max_length=128)
    language = models.CharField(max_length=8, default="it")
    pos = models.CharField(max_length=8, choices=POS_CHOICES, default="other")
    features = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("text", "language")

    def __str__(self):
        return f"{self.text} ({self.pos})"

class UserWord(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="user_words")
    word = models.ForeignKey(Word, on_delete=models.CASCADE, related_name="user_links")
    
    # CHANGED: We use a JSON field for stats now
    # Structure: {"presente": {"hits": 5, "misses": 2}, "passato_prossimo": {...}}
    stats = models.JSONField(default=dict, blank=True)
    
    # Keep these for backward compatibility if you want, or ignore them. 
    # We will primarily use 'stats' now.
    miss_count = models.PositiveIntegerField(default=0)
    hit_count = models.PositiveIntegerField(default=0)
    
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "word")