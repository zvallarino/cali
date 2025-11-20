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

# --- Words Management ---
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
            if pos and word.pos != pos:
                word.pos = pos
            if features:
                word.features = features
            word.save()

        link, _ = UserWord.objects.get_or_create(user=request.user, word=word)
        return Response(UserWordSerializer(link).data, status=status.HTTP_201_CREATED)

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def add_new_verbs(request):
    """
    Asks OpenAI for 5 new verbs that are NOT in the user's current list.
    """
    target_count = 5
    
    # 1. Get user's existing words (so AI doesn't duplicate)
    existing_texts = list(UserWord.objects.filter(user=request.user).values_list("word__text", flat=True))
    
    # 2. Build Prompt
    # We verify the list isn't empty to avoid JSON errors, though list() handles empty fine.
    vocab_context = json.dumps(existing_texts) if existing_texts else "[]"
    
    prompt = (
        f"The user knows these Italian verbs: {vocab_context}. "
        f"Generate {target_count} NEW, common, high-frequency Italian verbs (infinitive) that are NOT in this list. "
        "Return a JSON object with a key 'new_verbs' containing the list of strings."
    )

    try:
        comp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a vocabulary builder. Return ONLY valid JSON."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            temperature=0.5,
        )
        res_json = json.loads(comp.choices[0].message.content)
        candidates = res_json.get("new_verbs", [])
    except Exception as e:
        return Response({"detail": f"AI Error: {str(e)}"}, status=500)

    added_words = []
    
    # 3. Add them to DB
    for text in candidates:
        clean_text = text.strip().lower()
        
        # Double check against DB just in case
        if clean_text in existing_texts:
            continue
            
        word, _ = Word.objects.get_or_create(
            text=clean_text,
            language="it",
            defaults={
                "pos": "verb",
                "features": {
                    "tenses": ["presente", "passato_prossimo", "imperfetto", "futuro"], 
                    "persons": ["1s","2s","3s","1p","2p","3p"]
                }
            }
        )
        UserWord.objects.get_or_create(user=request.user, word=word)
        added_words.append(clean_text)
        
    return Response({"added": len(added_words), "new_words": added_words})
    
# --- Scoring & Stats ---
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def update_score(request, word_id):
    try:
        link = UserWord.objects.select_related("word").get(user=request.user, word_id=word_id)
    except UserWord.DoesNotExist:
        return Response({"detail": "Not found"}, status=404)
    
    tense = request.data.get("tense", "general")
    is_correct = request.data.get("correct", False)
    
    if tense not in link.stats:
        link.stats[tense] = {"hits": 0, "misses": 0}
    
    if is_correct:
        link.stats[tense]["hits"] += 1
    else:
        link.stats[tense]["misses"] += 1
        
    link.save()
    return Response({"ok": True, "stats": link.stats})

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def reset_stats(request):
    UserWord.objects.filter(user=request.user).update(stats={}, miss_count=0, hit_count=0)
    return Response({"ok": True})

# --- Legacy counters (optional, kept for safety) ---
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def mark_miss(request, word_id):
    return update_score(request._request, word_id)

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def mark_hit(request, word_id):
    return update_score(request._request, word_id)

# --- Practice Logic ---

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def batch_prompt_specs(request):
    """
    Returns a list of 20 random prompt specs.
    Query Params: ?tenses=presente,passato_prossimo
    """
    # 1. READ THE FILTER
    requested_tenses = request.query_params.get("tenses", "presente").split(",")
    print(f"DEBUG: User requested tenses: {requested_tenses}")

    links = list(UserWord.objects.filter(user=request.user).select_related("word"))
    if not links:
        return Response({"detail": "no words yet"}, status=400)

    batch_size = 20
    specs = []
    
    for _ in range(batch_size):
        random.shuffle(links)
        selected_link = None
        selected_tense = "presente"
        
        # 2. FIND A MATCHING WORD
        for link in links:
            w = link.word
            if w.pos == "verb":
                word_tenses = w.features.get("tenses", ["presente"])
                # THE FIX: Only pick tenses that are in BOTH lists
                possible_tenses = [t for t in requested_tenses if t in word_tenses]
                
                if possible_tenses:
                    selected_link = link
                    selected_tense = random.choice(possible_tenses)
                    break
            else:
                selected_link = link
                break
        
        if not selected_link:
            selected_link = random.choice(links)
            selected_tense = "presente"

        w = selected_link.word
        spec = {"id": w.id, "lemma": w.text, "pos": w.pos}
        
        if w.pos == "verb":
            persons = w.features.get("persons", ["1s","2s","3s","1p","2p","3p"])
            spec["person"] = random.choice(persons)
            spec["tense"] = selected_tense 
            
        specs.append(spec)

    return Response(specs)

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def llm_generate(request):
    data = request.data or {}
    
    if "specs" in data:
        specs = data["specs"]
        prompt_lines = [
            "Generate a JSON object with a key 'sentences' containing a list of objects.",
            "Each object must have 'id' (from input), 'it', and 'en'.",
            "IMPORTANT: Keep sentences at A1/A2 beginner level. Simple Subject-Verb-Object structure. Common vocabulary."
        ]
        
        for s in specs:
            details = f"Lemma: {s['lemma']} ({s['pos']})"
            if 'person' in s:
                details += f", Person: {s['person']}, Tense: {s['tense']}"
            prompt_lines.append(f"ID {s['id']}: {details}")
            
        messages = [
            {"role": "system", "content": "You are a helpful Italian tutor for beginners. Create simple, clear sentences. Output ONLY valid JSON."},
            {"role": "user", "content": "\n".join(prompt_lines)}
        ]
    elif "spec" in data:
        # Legacy single item support
        spec = data["spec"]
        lemma = spec.get("lemma")
        pos = spec.get("pos", "other")
        person = spec.get("person", "3s")
        tense = spec.get("tense", "presente")
        prompt = (
            f'Produce a simple Italian sentence using lemma "{lemma}" ({pos}). '
            f'Conjugate for {person} in {tense}. '
            'Return ONLY valid JSON with keys "it" and "en".'
        )
        messages = [
            {"role": "system", "content": "You are a concise Italian tutor. Always answer in JSON."},
            {"role": "user", "content": prompt},
        ]
    else:
        return Response({"detail": "Provide 'spec' or 'specs'."}, status=400)

    try:
        comp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            response_format={"type": "json_object"},
            temperature=0.2,
        )
        text = comp.choices[0].message.content or ""
        parsed = json.loads(text)
        
        return Response({
            "sent": {"model": "gpt-4o-mini", "messages": messages},
            "response": text,
            "json": parsed,
            "usage": getattr(comp, "usage", None) and comp.usage.model_dump(),
        })
    except Exception as e:
        return Response({"detail": str(e)}, status=500)