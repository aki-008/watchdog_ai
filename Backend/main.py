from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware  # ADD THIS
from fastapi.concurrency import run_in_threadpool
from transformers import (
    AutoTokenizer,
    AutoModelForTokenClassification,
    AutoModelForCausalLM,
)
from pydantic import BaseModel
import torch
import json
import re

app = FastAPI(title="Anonymizer API", version="1.0")

# -----------------------------
# ADD CORS MIDDLEWARE - THIS IS CRITICAL!
# -----------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "chrome-extension://*",  # Allow all Chrome extensions
        "http://localhost",
        "http://127.0.0.1",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "*",  # Allow all other origins (for development)
    ],
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods (GET, POST, etc.)
    allow_headers=["*"],  # Allows all headers
)

# -----------------------------
# MODEL LOADING
# -----------------------------
# Load NER model (PII detector)
ner_tokenizer = AutoTokenizer.from_pretrained(
    "Isotonic/distilbert_finetuned_ai4privacy_v2", revision="main"
)  # nosec B615
ner_model = AutoModelForTokenClassification.from_pretrained(
    "Isotonic/distilbert_finetuned_ai4privacy_v2", revision="main"
)  # nosec B615
ner_model.to("cpu")  # keep on CPU to save VRAM

# Load LLM anonymizer
model_name = "eternisai/Anonymizer-0.6B"
slm_tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
slm_model = AutoModelForCausalLM.from_pretrained(
    model_name,
    torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
    device_map="auto",
    trust_remote_code=True,
)


# -----------------------------
# REQUEST MODEL
# -----------------------------
class AnonymizeRequest(BaseModel):
    text: str


# -----------------------------
# TASK PROMPT
# -----------------------------
TASK_INSTRUCTION = """You are an anonymizer. Your task is to identify and replace personally identifiable information (PII) in the given text.
Replace PII entities with semantically equivalent alternatives that preserve the context needed for a good response.
If no PII is found or replacement is not needed, return an empty replacements list.

REPLACEMENT RULES:
• Personal names: Replace private or small-group individuals. Pick same culture + gender + era; keep surnames aligned across family members.
• Companies / organisations: Replace private, niche, employer & partner orgs. Invent a fictitious org in the same industry & size tier; keep legal suffix.
• Locations: Replace street addresses, villages & towns <100k population with similar-level synthetic locations in the same state/country.
• Dates & times: Shift day/month slightly, keeping same year.
• Identifiers (emails, phone #s, URLs): Replace with format-valid dummies.
• Monetary values: Replace personal ones, keep public prices unchanged.
• If nothing needs replacement, return an empty replacements array.
"""

tools = [
    {
        "type": "function",
        "function": {
            "name": "replace_entities",
            "description": "Replace PII entities with anonymized versions",
            "parameters": {
                "type": "object",
                "properties": {
                    "replacements": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "original": {"type": "string"},
                                "replacement": {"type": "string"},
                            },
                            "required": ["original", "replacement"],
                        },
                    }
                },
                "required": ["replacements"],
            },
        },
    }
]


# -----------------------------
# HELPER FUNCTIONS
# -----------------------------
def parse_replacements(response: str):
    """Extract structured replacements JSON from model output."""
    try:
        match = re.search(r"<\|?tool_call\|?>([\s\S]*?)</\|?tool_call\|?>", response)
        if not match:
            return []
        json_str = match.group(1).strip()
        tool_data = json.loads(json_str)
        return tool_data.get("arguments", {}).get("replacements", [])
    except Exception as e:
        print("Parsing error:", e)
        return []


def detect_pii(text: str):
    """Detect if text contains any PII using token classification model."""
    inputs = ner_tokenizer(text, return_tensors="pt")
    with torch.no_grad():
        logits = ner_model(**inputs).logits
    predictions = torch.argmax(logits, dim=2)
    predicted_labels = [ner_model.config.id2label[t.item()] for t in predictions[0]]
    return any(label != "O" for label in predicted_labels)


def run_anonymizer(query: str):
    """Run anonymization with the LLM model."""
    messages = [
        {"role": "system", "content": TASK_INSTRUCTION},
        {"role": "user", "content": query + "\n/no_think"},
    ]

    formatted_prompt = slm_tokenizer.apply_chat_template(
        messages, tools=tools, tokenize=False, add_generation_prompt=True
    )

    inputs = slm_tokenizer(formatted_prompt, return_tensors="pt", truncation=True).to(
        slm_model.device
    )

    with torch.no_grad():
        outputs = slm_model.generate(
            **inputs, max_new_tokens=250, temperature=0.0, do_sample=False
        )

    response = slm_tokenizer.decode(outputs[0], skip_special_tokens=False)
    replacements = parse_replacements(response)

    if not replacements:
        return {"original_text": query, "anonymized_text": query, "replacements": []}

    anonymized_text = query
    for r in replacements:
        pattern = re.escape(r["original"])
        anonymized_text = re.sub(pattern, r["replacement"], anonymized_text)

    return {
        "original_text": query,
        "anonymized_text": anonymized_text,
        "replacements": replacements,
    }


# -----------------------------
# ROUTES
# -----------------------------
@app.get("/")
async def root():
    return {"message": "Anonymizer API is running 🚀"}


@app.post("/detect_pii")
async def detect_endpoint(text: str):
    """Check if any PII is detected in the input."""
    pii_found = await run_in_threadpool(detect_pii, text)
    return {"pii_detected": pii_found}


@app.post("/anonymize")
async def anonymize(req: AnonymizeRequest):
    """Anonymize the given text."""
    pii_found = await run_in_threadpool(detect_pii, req.text)
    if not pii_found:
        return {
            "message": "No PII detected",
            "anonymized_text": req.text,
            "replacements": [],
        }

    result = await run_in_threadpool(run_anonymizer, req.text)
    return result


@app.post("/smart_anonymize")
async def smart_anonymize(req: AnonymizeRequest):
    """Automatically detect & anonymize text with logging."""
    print(f"Received text for anonymization: {req.text[:80]}...")
    return await run_in_threadpool(run_anonymizer, req.text)
