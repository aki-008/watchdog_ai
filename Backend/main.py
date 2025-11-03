from fastapi import FastAPI

app = FastAPI()

@app.get("/")
async def root():
    return {"message": "Hello World"}


@app.post("/items/")
async def create_item(item_id: int):
    print(f"Received item data: {item_id}")
    # In a real application, you would save this data to a database
    return {"message": "Item created successfully", "item": item_id}