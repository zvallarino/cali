from django.contrib.auth.models import User
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework import status
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from django.db import transaction
from .models import Word, UserWord
from .serializers import UserSerializer, WordSerializer, UserWordSerializer, AddWordSerializer
import random
import os, json
from openai import OpenAI

client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def llm_generate(request):
    """
    Body can be either:
      - {"prompt": "...free text..."}   (will be sent as-is)
      - {"spec": {"lemma":"andare","pos":"verb","person":"3s","tense":"presente"}}
    Returns: {"sent":<what we sent>, "response":<model text>, "json":<parsed or None>, "usage":{...}}
    """
    data = request.data or {}
    prompt = data.get("prompt")
    spec = data.get("spec")

    if not prompt and not spec:
        return Response({"detail": "Provide 'prompt' or 'spec'."}, status=400)

    if not prompt:
        lemma = spec.get("lemma")
        pos = spec.get("pos","other")
        person = spec.get("person","3s")
        tense = spec.get("tense","presente")
        prompt = (
            f'Produce a simple Italian sentence using lemma "{lemma}" ({pos}). '
            f'Conjugate for {person} in {tense}. '
            'Return ONLY valid JSON with keys "it" and "en".'
        )

    # Build the chat messages (very simple)
    messages = [
        {"role": "system", "content": "You are a concise Italian tutor. Always answer in JSON."},
        {"role": "user", "content": prompt},
    ]

    try:
        comp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            response_format={"type": "json_object"},
            temperature=0.2,
        )
        text = comp.choices[0].message.content or ""
        parsed = None
        try:
            parsed = json.loads(text)
        except Exception:
            parsed = None

        return Response({
            "sent": {"model":"gpt-4o-mini", "messages": messages},
            "response": text,
            "json": parsed,
            "usage": getattr(comp, "usage", None) and comp.usage.model_dump(),
        })
    except Exception as e:
        return Response({"detail": str(e)}, status=500)

# --- Auth (dev) ---
@api_view(["POST"])
@permission_classes([AllowAny])
def dev_login(request):
    """
    DEV ONLY: No password. Body: {"username":"zack"} or {"username":"mary"}
    Creates user if missing and returns JWT.
    """
    username = (request.data.get("username") or "").strip().lower()
    if not username:
        return Response({"detail": "username required"}, status=400)
    user, _ = User.objects.get_or_create(username=username)
    refresh = RefreshToken.for_user(user)
    return Response({
        "user": UserSerializer(user).data,
        "access": str(refresh.access_token),
        "refresh": str(refresh),
    })

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    return Response({"user": UserSerializer(request.user).data})

# --- Words ---
class WordsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        links = UserWord.objects.filter(user=request.user).select_related("word").order_by("-id")
        return Response(UserWordSerializer(links, many=True).data)

    @transaction.atomic
    def post(self, request):
        serializer = AddWordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        text = serializer.validated_data["text"].strip().lower()
        pos = serializer.validated_data.get("pos")
        features = serializer.validated_data.get("features", {})

        word, created = Word.objects.get_or_create(
            text=text, language="it",
            defaults={"pos": pos or "other", "features": features}
        )
        if not created:
            # update pos/features if provided
            if pos and word.pos != pos:
                word.pos = pos
            if features:
                word.features = features
            word.save()

        link, _ = UserWord.objects.get_or_create(user=request.user, word=word)
        return Response(UserWordSerializer(link).data, status=status.HTTP_201_CREATED)

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def mark_miss(request, word_id):
    try:
        link = UserWord.objects.select_related("word").get(user=request.user, word_id=word_id)
    except UserWord.DoesNotExist:
        return Response({"detail": "Not found"}, status=404)
    link.miss_count += 1
    link.save(update_fields=["miss_count"])
    return Response({"ok": True, "miss_count": link.miss_count})

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def mark_hit(request, word_id):
    try:
        link = UserWord.objects.select_related("word").get(user=request.user, word_id=word_id)
    except UserWord.DoesNotExist:
        return Response({"detail": "Not found"}, status=404)
    link.hit_count += 1
    link.save(update_fields=["hit_count"])
    return Response({"ok": True, "hit_count": link.hit_count})

# --- Practice seed/next (no OpenAI call yet; just chooses a word + simple spec) ---
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def next_prompt_spec(request):
    """
    Picks a random word from the user's list.
    If verb, pick a random person/tense from features (if available), else just return the word.
    Frontend will send this spec to OpenAI and show the request+response.
    """
    links = list(UserWord.objects.filter(user=request.user).select_related("word"))
    if not links:
        return Response({"detail": "no words yet"}, status=400)

    link = random.choice(links)
    w = link.word
    spec = {"lemma": w.text, "pos": w.pos}
    if w.pos == "verb":
        persons = w.features.get("persons", ["1s","2s","3s","1p","2p","3p"])
        tenses = w.features.get("tenses", ["presente"])
        spec["person"] = random.choice(persons)
        spec["tense"] = random.choice(tenses)
    return Response(spec)