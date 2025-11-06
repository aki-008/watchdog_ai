from fastapi import FastAPI
from pydantic import BaseModel
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
    return {"message": "AI Monitoring Backend Running"}


class Item(BaseModel):
    item_id: int


@app.post("/items/")
async def create_item(item: Item):
    print(f"Received item data: {item.item_id}")
    # In a real application, you would save this data to a database
    return {"message": "Item created successfully", "item": item.item_id}


class TextData(BaseModel):
    text: str


@app.post("/send_data/")
async def send_data(data: TextData):
    text = data.text
    print(f"Received text for analysis: {text}")
    inputs = tokenizer(text, return_tensors="pt")
    with torch.no_grad():
        logits = model(**inputs).logits
    predictions = torch.argmax(logits, dim=2)
    predicted_token_class = [model.config.id2label[t.item()] for t in predictions[0]]
    result_bool = check_info(predicted_token_class)
    return {"sensitive": result_bool, "labels": predicted_token_class}


def check_info(pred):
    for i in pred:
        if i != "O":
            return True
    return False