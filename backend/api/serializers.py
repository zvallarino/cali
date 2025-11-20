from rest_framework import serializers
from django.contrib.auth.models import User
from .models import Word, UserWord

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username"]

class WordSerializer(serializers.ModelSerializer):
    class Meta:
        model = Word
        fields = ["id", "text", "language", "pos", "features", "created_at"]

class UserWordSerializer(serializers.ModelSerializer):
    word = WordSerializer()
    class Meta:
        model = UserWord
        fields = ["id", "word", "miss_count", "hit_count", "created_at"]

class AddWordSerializer(serializers.Serializer):
    text = serializers.CharField()
    # Optionally accept pos/features from frontend; if omitted, backend/OpenAI can fill later
    pos = serializers.ChoiceField(choices=[c[0] for c in Word.POS_CHOICES], required=False)
    features = serializers.JSONField(required=False)