"""The reply, the way Plutto's chat writes it: the same message layout, the same language rule read last, the same length budget, and the
same clean-up of a model's planning that leaks into its first sentence. Copied from Plutto's app/services/features/chat.py, which the engine
under app/ does not include (it is the app's HTTP layer). Keep the two alike: a change to how Plutto's chat replies belongs here too."""
from __future__ import annotations

import re
from typing import Dict, List, Optional

def _voice_rule(intent: Optional[Dict], app_language: Optional[str] = None) -> str:
    """Their language and their register — the LAST thing the reply model reads.

    It sat as one early line ("Respond ENTIRELY in language X") in a system prompt
    thousands of tokens long, under persona and style blocks that describe one
    voice, and the classifier named every language but three "other" — so the
    line read 'Respond ENTIRELY in language "other"'. The in-feature chat suffered
    most: its first message is often short, it opens with no history to set the
    tone, and a reading's English section data sits right above it. So the rule
    is stated in full, by name, at the end, every turn, in both chats."""
    intent = intent or {}
    lang = str(intent.get('language') or '').strip().lower()
    if lang in ('', 'other', 'unknown'):
        lang = ''
    reg = str(intent.get('register') or '').strip()[:120]
    try:
        from app.services.voice import lang_name
        app_lang = lang_name(app_language)          # '' for English / unknown
    except Exception:
        app_lang = ''
    said = f'This message is in {lang}' if lang else 'Read the language off their own words'
    out = ("\n\nTHEIR LANGUAGE, THEIR VIBE — this outranks every line above about how you sound.\n"
           f"* {said}. Reply in the language they are writing in, as a native speaker would say "
           "it — never translated English, never a language they did not use. If they switch, "
           "switch with them.\n"
           "* Hinglish (Hindi or another Indian language in Latin letters, mixed with English) gets "
           "Hinglish back, in Latin letters, mixed the way they mix — not Devanagari, not pure "
           "English. The same for any language they write in another script: answer in THEIR script.\n"
           "* Sound like them. Casual gets casual, a quick line gets a quick answer, playful gets a "
           "little play back, formal gets formal, a worried paragraph gets steady warmth. Use the "
           "words they use for things. Mirror their manner, not their mistakes — and it is still "
           "you underneath: the same truth and depth, in their voice rather than a ceremony.")
    if reg:
        out += f"\n* How they write: {reg}."
    if app_lang:
        out += (f"\n* When a message shows no language of its own (a word, an emoji, a number), "
                f"stay in the language of their earlier messages, or else {app_lang}, the "
                f"language their app is set to.")
    return out


def _build_messages(system_prompt: str, history: Optional[List[Dict]],
                    user_message: str, tail: str = '') -> List[Dict]:
    messages: List[Dict] = [{'role': 'system', 'content': system_prompt + tail}]
    for h in (history or [])[-8:]:
        role = h.get('role', 'user') if isinstance(h, dict) else 'user'
        # The app logs the Oracle's turns as role "oracle". They are the
        # assistant's turns; folding them into "user" made the model read its
        # own earlier answers as things the person had said.
        if role == 'oracle':
            role = 'assistant'
        if role not in ('user', 'assistant'):
            role = 'user'
        content = h.get('content', '') if isinstance(h, dict) else str(h)
        if content:
            messages.append({'role': role, 'content': content})
    messages.append({'role': 'user', 'content': user_message})
    return messages


# Thinking models spend part of max_tokens on reasoning before the first visible
# word; without headroom a reply arrives cut off, or not at all. The prompt still
# governs the visible length.
_THINKING_HEADROOM = 1500

# The model's planning, when it leaks into the reply: it talks about the person in
# the third person ("The user's question is clear: ...") or about what it will do.
_THINK_TAG = re.compile(r'<think>.*?(</think>|$)', re.S | re.I)
_META_SENTENCE = re.compile(
    r"^\s*(?:\W*)(?:"
    r".*\bthe user\b|.*\buser's\b|"
    r"i (?:need|should|will|must|have) to (?:answer|respond|reply|address|explain|give|provide|figure|check|look|tell)|"
    r"(?:ok(?:ay)?|alright|so),? (?:the user|they|let me|i need)|"
    r"the (?:question|request) is (?:clear|simple|about|asking)|"
    r"they (?:want|are asking|asked) (?:to know|about|for|when|what|whether)"
    r")", re.I)


_ANSWER_NOW = '\n\nAnswer them directly, in your own voice. Never describe their question or your plan.'


def _split_lead(text: str):
    """(first sentence, rest) — or (None, text) while the first sentence is unfinished."""
    m = re.search(r'[.!?\u0964](?:["\')\]]*)(?:\s+|$)|\n', text)
    if not m:
        return None, text
    return text[:m.end()], text[m.end():]


def _drop_planning(text: str, log: bool = True) -> str:
    """Remove leaked reasoning from the start of a reply."""
    text = _THINK_TAG.sub('', text or '').lstrip()
    while text:
        lead, rest = _split_lead(text)
        if lead is None:
            return '' if _META_SENTENCE.match(text) else text
        if not _META_SENTENCE.match(lead):
            return text
        if log:
            print(f"[oracle] dropped planning text: {lead.strip()[:120]!r}")
        text = rest.lstrip()
    return text


def _reply_budget(intent: Dict) -> int:
    """A SMART ceiling for the reply, sized to the query (the prompt still governs the
    real length within it). Small talk / off-topic stay tight; focused questions get
    room for a crisp answer; open, sweeping questions can breathe fully."""
    if intent.get('small_talk') or intent.get('off_topic'):
        return 320
    qt = (intent.get('question_type') or 'general').lower()
    primary = (intent.get('primary') or 'general').lower()
    broad = (qt in ('general', 'what_kind', 'how_is', 'why')
             or bool(intent.get('secondary'))
             or primary in ('general', 'personality', 'life', 'spirituality'))
    if broad:
        return 1300          # open / whole-life questions — full, rich reply (trimmed from 1800:
                             # output tokens are the priciest part and a tighter reply reads better)
    return 850               # focused yes-no / timing / should-i — tight and direct
