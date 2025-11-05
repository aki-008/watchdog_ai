from fastapi import FastAPI
from transformers import AutoTokenizer, AutoModelForTokenClassification
import torch

tokenizer = AutoTokenizer.from_pretrained(
    "Isotonic/distilbert_finetuned_ai4privacy_v2", revision="main"
)  # nosec B615
model = AutoModelForTokenClassification.from_pretrained(
    "Isotonic/distilbert_finetuned_ai4privacy_v2", revision="main"
)  # nosec B615

app = FastAPI()


@app.get("/")
async def root():
    return {"message": "Hello World"}


@app.post("/items/")
async def create_item(item_id: int):
    print(f"Received item data: {item_id}")
    # In a real application, you would save this data to a database
    return {"message": "Item created successfully", "item": item_id}


@app.post("/send_data/")
async def send_data(text: str):
    print(f"Received item data: {text}")
    inputs = tokenizer(text, return_tensors="pt")
    with torch.no_grad():
        logits = model(**inputs).logits
    predictions = torch.argmax(logits, dim=2)
    predicted_token_class = [model.config.id2label[t.item()] for t in predictions[0]]
    result = check_info(predicted_token_class)
    return result


def check_info(pred):
    for i in pred:
        if i != "O":
            return True
    return False
